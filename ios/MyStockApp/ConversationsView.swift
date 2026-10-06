import SwiftUI

/// 從個股頁帶過來、待開啟的新對話(股票代碼 + 已產生的報告)。
struct PendingNewChat: Equatable {
    let symbol: String
    let briefing: String
    var autoPrompt: String = ""   // 有值時:開對話後自動送出這句問題
}

/// 「對話」分頁:主區是聊天,左上角可開合左側欄(顯示歷史對話,點下去繼續)。
struct ConversationsView: View {
    let theme: AppTheme
    let isZh: Bool
    /// 由個股頁「問 AI 問題」帶入:有值時自動開該股新對話。
    @Binding var pending: PendingNewChat?
    /// 使用者的 watchlist 代碼,供 AI 做股票池健康分析。
    var watchlistSymbols: [String] = []

    private let apiService = StockAPIService()
    private var langCode: String { isZh ? "zh" : "en" }

    @StateObject private var store = ChatStore.shared
    @State private var current: SavedChat?
    @State private var messages: [AIChatMessage] = []
    @State private var input: String = ""
    @FocusState private var inputFocused: Bool
    @State private var isSending = false
    @State private var showSidebar = false
    @State private var searchText = ""
    @State private var showMsgSearch = false
    @State private var msgSearch = ""
    @State private var chatToDelete: SavedChat?
    @State private var showVoice = false
    @State private var reviewTrigger = 0   // 第 2 次收到 AI 回覆後請使用者評分

    private let sidebarWidth: CGFloat = 290

    var body: some View {
        ZStack(alignment: .leading) {
            chatPane
                .zIndex(0)

            if showSidebar {
                Color.black.opacity(0.35)
                    .ignoresSafeArea()
                    .onTapGesture { withAnimation(.easeInOut(duration: 0.22)) { showSidebar = false } }
                    .zIndex(1)
                sidebar
                    .frame(width: sidebarWidth)
                    .transition(.move(edge: .leading))
                    .zIndex(2)
            }

            if let target = chatToDelete {
                deleteConfirm(target)
                    .zIndex(3)
            }
        }
        .onAppear { consumePendingOrLoadLatest() }
        .onChange(of: pending) { _, _ in consumePendingOrLoadLatest() }
        .reviewPrompt(trigger: $reviewTrigger)
        .fullScreenCover(isPresented: $showVoice) {
            VoiceChatView(
                theme: theme, isZh: isZh,
                symbol: current?.symbol ?? "",
                history: messages,
                watchlist: watchlistSymbols,
                onExchange: { user, reply in
                    messages.append(AIChatMessage(role: "user", content: user))
                    messages.append(AIChatMessage(role: "assistant", content: reply))
                    save()
                    _ = ReviewPrompter.shouldPrompt(after: .aiReplied)   // 語音模式不跳(會打斷對話),只計數
                },
                onClose: { showVoice = false }
            )
        }
    }

    private func deleteConfirm(_ target: SavedChat) -> some View {
        ZStack {
            Color.black.opacity(0.45).ignoresSafeArea()
                .onTapGesture { chatToDelete = nil }
            VStack(spacing: 16) {
                Text(isZh ? "確定刪除嗎?" : "Delete this conversation?")
                    .font(.headline).foregroundColor(theme.primaryText)
                Text(isZh ? "將刪除「\(target.symbol)」的對話,無法復原。"
                          : "This will delete the \(target.symbol) conversation.")
                    .font(.subheadline).foregroundColor(theme.secondaryText)
                    .multilineTextAlignment(.center)
                HStack(spacing: 12) {
                    Button {
                        store.delete(target)
                        if current?.id == target.id { clear() }
                        chatToDelete = nil
                    } label: {
                        Text(isZh ? "刪除" : "Delete")
                            .font(.subheadline.weight(.semibold)).foregroundColor(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, 11)
                            .background(Color.red).cornerRadius(12)
                    }
                    Button {
                        chatToDelete = nil
                    } label: {
                        Text(isZh ? "取消" : "Cancel")
                            .font(.subheadline.weight(.semibold)).foregroundColor(theme.primaryText)
                            .frame(maxWidth: .infinity).padding(.vertical, 11)
                            .background(theme.cardBackground)
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.divider, lineWidth: 1))
                            .cornerRadius(12)
                    }
                }
            }
            .padding(20)
            .background(theme.appBackground)
            .cornerRadius(18)
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(theme.divider, lineWidth: 1))
            .frame(maxWidth: 300)
            .padding(40)
        }
    }

    private func consumePendingOrLoadLatest() {
        if let p = pending {
            pending = nil
            if !p.autoPrompt.isEmpty {
                startAndSend(symbol: p.symbol, title: isZh ? "Watchlist 健康" : "Watchlist health", prompt: p.autoPrompt)
            } else {
                startNew(symbol: p.symbol, briefing: p.briefing)
                #if DEBUG
                if ProcessInfo.processInfo.environment["AUTO_VOICE_TEXT"] != nil { showVoice = true }
                #endif
            }
        } else if current == nil, let latest = store.chats.first {
            load(latest)
        }
    }

    /// 開一段新對話並立刻送出 prompt(快捷用,如 watchlist 健康報告)。
    private func startAndSend(symbol: String, title: String, prompt: String) {
        let sym = symbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        current = SavedChat(id: UUID(), symbol: sym, date: Date(), title: title, messages: [])
        messages = []
        input = prompt
        withAnimation(.easeInOut(duration: 0.22)) { showSidebar = false }
        send()
    }

    /// ➕ 直接開一個空白新對話(不指定股票),AI 先打招呼,使用者可問任何股票。
    private func startGeneralChat() {
        let greet = isZh ? "你好!想問哪支股票都可以,也可以請我分析你的 watchlist 股票池健康狀況。"
                         : "Hi! Ask about any stock, or ask me to analyze your watchlist's health."
        let seed = [AIChatMessage(role: "assistant", content: greet)]
        current = SavedChat(id: UUID(), symbol: "", date: Date(),
                            title: isZh ? "新對話" : "New chat", messages: seed)
        messages = seed
        input = ""
        withAnimation(.easeInOut(duration: 0.22)) { showSidebar = false }
    }

    private func startNew(symbol: String, briefing: String) {
        let sym = symbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !sym.isEmpty else { return }
        // 同一支股票就是同一個對話框:已有該股對話則接續,沒有才新建
        if let existing = store.chats.first(where: { $0.symbol == sym }) {
            load(existing)
            withAnimation(.easeInOut(duration: 0.22)) { showSidebar = false }
            return
        }
        let seed = briefing.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? [] : [AIChatMessage(role: "assistant", content: briefing)]
        current = SavedChat(id: UUID(), symbol: sym, date: Date(),
                            title: sym, messages: seed)
        messages = seed
        input = ""
        withAnimation(.easeInOut(duration: 0.22)) { showSidebar = false }
    }

    // MARK: - 主聊天區

    private var chatPane: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Button { withAnimation(.easeInOut(duration: 0.22)) { showSidebar.toggle() } } label: {
                    Image(systemName: "sidebar.left").font(.title3).foregroundColor(theme.primaryText)
                }
                Text(current.map { displayName($0) } ?? (isZh ? "對話" : "Conversations"))
                    .font(.headline).foregroundColor(theme.primaryText).lineLimit(1)
                Spacer()
                if current != nil {
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            showMsgSearch.toggle()
                            if !showMsgSearch { msgSearch = "" }
                        }
                    } label: {
                        Image(systemName: showMsgSearch ? "magnifyingglass.circle.fill" : "magnifyingglass")
                            .font(.title3).foregroundColor(showMsgSearch ? .blue : theme.primaryText)
                    }
                }
            }
            .padding(.horizontal).padding(.vertical, 10)

            // 對話內搜尋:在這段對話找含關鍵字的訊息(例:eps)
            if showMsgSearch, current != nil {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").font(.caption).foregroundColor(theme.secondaryText)
                    TextField(isZh ? "在這段對話搜尋…" : "Search in this chat…", text: $msgSearch)
                        .font(.subheadline).foregroundColor(theme.primaryText).autocorrectionDisabled()
                    if !msgSearch.isEmpty {
                        Text("\(displayedMessages.count)")
                            .font(.caption2).foregroundColor(theme.secondaryText)
                        Button { msgSearch = "" } label: {
                            Image(systemName: "xmark.circle.fill").font(.caption).foregroundColor(theme.secondaryText)
                        }
                    }
                }
                .padding(.horizontal, 10).padding(.vertical, 8)
                .background(theme.cardBackground)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.divider, lineWidth: 1))
                .cornerRadius(10)
                .padding(.horizontal, 12).padding(.bottom, 6)
            }

            Divider().overlay(theme.divider)

            if current == nil {
                emptyState
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            ForEach(displayedMessages) { msg in
                                bubble(role: msg.role, text: msg.content).id(msg.id)
                            }
                            if isSending {
                                HStack(spacing: 8) {
                                    ProgressView().tint(theme.primaryText)
                                    Text(isZh ? "思考中…" : "Thinking…")
                                        .font(.caption).foregroundColor(theme.secondaryText)
                                }.id("thinking")
                            }
                        }
                        .padding(16)
                    }
                    .scrollDismissesKeyboard(.interactively)   // 捲動訊息收鍵盤
                    .onChange(of: messages.count) { _, _ in scrollEnd(proxy) }
                    .onChange(of: isSending) { _, _ in scrollEnd(proxy) }
                    .onTapGesture { inputFocused = false }      // 點訊息區空白收鍵盤
                }
                inputBar
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 44)).foregroundColor(theme.secondaryText.opacity(0.5))
            Text(isZh ? "從左側選擇一段對話繼續" : "Pick a conversation from the sidebar")
                .font(.subheadline).foregroundColor(theme.secondaryText)
            Text(isZh ? "或在個股頁用「AI 研究助理」開始新對話" : "or start one from a stock's AI assistant")
                .font(.caption).foregroundColor(theme.secondaryText.opacity(0.8))
                .multilineTextAlignment(.center)
            Button { withAnimation(.easeInOut(duration: 0.22)) { showSidebar = true } } label: {
                Text(isZh ? "開啟對話紀錄" : "Open history")
                    .font(.subheadline.weight(.semibold)).foregroundColor(.white)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Color.blue).cornerRadius(12)
            }
            .padding(.top, 4)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    // MARK: - 左側欄

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Text(isZh ? "對話紀錄" : "History")
                    .font(.headline).foregroundColor(theme.primaryText)
                Spacer()
                Button { startGeneralChat() } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.title3).foregroundColor(.blue)
                }
                Button { withAnimation(.easeInOut(duration: 0.22)) { showSidebar = false } } label: {
                    Image(systemName: "chevron.left").foregroundColor(theme.secondaryText)
                }
            }
            .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 8)

            // 搜尋框:快速找對話(代碼或標題)
            if !store.chats.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass")
                        .font(.caption).foregroundColor(theme.secondaryText)
                    TextField(isZh ? "搜尋對話…" : "Search…", text: $searchText)
                        .font(.subheadline).foregroundColor(theme.primaryText)
                        .autocorrectionDisabled()
                    if !searchText.isEmpty {
                        Button { searchText = "" } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.caption).foregroundColor(theme.secondaryText)
                        }
                    }
                }
                .padding(.horizontal, 10).padding(.vertical, 8)
                .background(theme.appBackground)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.divider, lineWidth: 1))
                .cornerRadius(10)
                .padding(.horizontal, 12).padding(.bottom, 8)
            }

            if store.chats.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "tray").font(.title2).foregroundColor(theme.secondaryText.opacity(0.5))
                    Text(isZh ? "還沒有對話" : "No conversations")
                        .font(.caption).foregroundColor(theme.secondaryText)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if filteredChats.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").font(.title2).foregroundColor(theme.secondaryText.opacity(0.5))
                    Text(isZh ? "找不到符合的對話" : "No matches")
                        .font(.caption).foregroundColor(theme.secondaryText)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(filteredChats) { chat in
                            sidebarRow(chat)
                        }
                    }
                    .padding(.horizontal, 12).padding(.top, 4)
                }
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(theme.cardBackground.ignoresSafeArea())
    }

    private func sidebarRow(_ chat: SavedChat) -> some View {
        let isActive = current?.id == chat.id
        return HStack(spacing: 8) {
            Button {
                load(chat)
                withAnimation(.easeInOut(duration: 0.22)) { showSidebar = false }
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(displayName(chat)).font(.subheadline.weight(.bold)).foregroundColor(theme.primaryText).lineLimit(1)
                    Text(lastPreview(chat) + " · " + Self.relative(chat.date, isZh: isZh))
                        .font(.caption2).foregroundColor(theme.secondaryText).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            // 個別刪除:先確認再刪
            Button {
                chatToDelete = chat
            } label: {
                Image(systemName: "trash").font(.subheadline).foregroundColor(.red)
            }
            .buttonStyle(.plain)
        }
        .padding(10)
        .background(isActive ? Color.blue.opacity(0.15) : Color.clear)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.divider, lineWidth: 1))
        .cornerRadius(10)
    }

    // MARK: - 邏輯

    /// 對話內搜尋:有關鍵字時只顯示含關鍵字的訊息。
    private var displayedMessages: [AIChatMessage] {
        let q = msgSearch.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard showMsgSearch, !q.isEmpty else { return messages }
        return messages.filter { $0.content.lowercased().contains(q) }
    }

    private var filteredChats: [SavedChat] {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return store.chats }
        return store.chats.filter {
            $0.symbol.lowercased().contains(q) || $0.title.lowercased().contains(q)
        }
    }

    private func load(_ chat: SavedChat) {
        current = chat
        messages = chat.messages
        input = ""
    }

    private func clear() {
        current = nil; messages = []; input = ""
    }

    private var canSend: Bool {
        current != nil && !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSending
    }

    private func scrollEnd(_ proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.2)) {
            if isSending { proxy.scrollTo("thinking", anchor: .bottom) }
            else if let last = messages.last { proxy.scrollTo(last.id, anchor: .bottom) }
        }
    }

    private func bubble(role: String, text: String) -> some View {
        let isUser = role == "user"
        return HStack {
            if isUser { Spacer(minLength: 40) }
            Text(text)
                .font(.subheadline)
                .foregroundColor(isUser ? .white : theme.primaryText)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 13).padding(.vertical, 10)
                .background(isUser ? Color.blue : theme.cardBackground)
                .overlay(RoundedRectangle(cornerRadius: 16)
                    .stroke(isUser ? Color.clear : theme.divider, lineWidth: 1))
                .cornerRadius(16)
            if !isUser { Spacer(minLength: 40) }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
    }

    private var inputBar: some View {
        HStack(spacing: 8) {
            TextField(isZh ? "繼續問…" : "Continue…", text: $input, axis: .vertical)
                .focused($inputFocused)
                .lineLimit(1...5).font(.subheadline).foregroundColor(theme.primaryText)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(theme.cardBackground)
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(theme.divider, lineWidth: 1))
                .cornerRadius(18)
            if input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                // 語音對話(像 ChatGPT 的語音模式)
                Button {
                    inputFocused = false
                    showVoice = true
                } label: {
                    Image(systemName: "waveform.circle.fill").font(.system(size: 32))
                        .foregroundColor(isSending ? theme.secondaryText.opacity(0.4) : .blue)
                }
                .disabled(isSending)
            } else {
                Button { send() } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.system(size: 32))
                        .foregroundColor(canSend ? .blue : theme.secondaryText.opacity(0.4))
                }
                .disabled(!canSend)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(.ultraThinMaterial)
    }

    private func send() {
        guard let chat = current else { return }
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        messages.append(AIChatMessage(role: "user", content: text))
        input = ""
        inputFocused = false   // 發送後收起鍵盤
        isSending = true
        let payload = messages
        let symbol = chat.symbol
        Task {
            defer { Task { @MainActor in isSending = false } }
            do {
                let resp = try await apiService.sendAIChat(symbol: symbol, languageCode: langCode, messages: payload, watchlist: watchlistSymbols)
                await MainActor.run {
                    messages.append(AIChatMessage(role: "assistant", content: resp.reply.isEmpty
                        ? (isZh ? "(沒有回應)" : "(no response)") : resp.reply))
                    save()
                    if !resp.reply.isEmpty, ReviewPrompter.shouldPrompt(after: .aiReplied) { reviewTrigger += 1 }
                }
            } catch {
                await MainActor.run {
                    messages.append(AIChatMessage(role: "assistant", content: isZh ? "回覆失敗,請再試一次。" : "Reply failed, please try again."))
                }
            }
        }
    }

    private func save() {
        guard let chat = current, !messages.isEmpty else { return }
        // 有股票就用代碼當標題(資料夾);一般對話用第一個問題當標題
        let title: String
        if !chat.symbol.isEmpty {
            title = chat.symbol
        } else {
            title = messages.first(where: { $0.role == "user" }).map { String($0.content.prefix(40)) }
                ?? (isZh ? "新對話" : "New chat")
        }
        let updated = SavedChat(id: chat.id, symbol: chat.symbol, date: Date(),
                                title: title, messages: messages)
        store.upsert(updated)
        current = updated
    }

    private func displayName(_ chat: SavedChat) -> String {
        if !chat.symbol.isEmpty { return chat.symbol }
        if let u = chat.messages.first(where: { $0.role == "user" })?.content, !u.isEmpty {
            return String(u.prefix(20))
        }
        return isZh ? "新對話" : "New chat"
    }

    private func lastPreview(_ chat: SavedChat) -> String {
        if let lastUser = chat.messages.last(where: { $0.role == "user" })?.content, !lastUser.isEmpty {
            return String(lastUser.prefix(24))
        }
        return isZh ? "\(chat.messages.count) 則訊息" : "\(chat.messages.count) msgs"
    }

    private static func relative(_ date: Date, isZh: Bool) -> String {
        let f = RelativeDateTimeFormatter()
        f.locale = Locale(identifier: isZh ? "zh_TW" : "en_US")
        return f.localizedString(for: date, relativeTo: Date())
    }
}
