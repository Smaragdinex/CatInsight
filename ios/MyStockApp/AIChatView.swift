import SwiftUI

/// 詳情頁上的精簡入口卡:直接讓使用者問 AI(不再產生簡報)。
struct AIAssistantCard: View {
    let symbol: String
    let theme: AppTheme
    let isZh: Bool
    /// 按「問 AI 問題」時呼叫:(股票代碼) → 由外層切到「對話」分頁開新對話。
    let onAsk: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Image(systemName: "sparkles").foregroundColor(.blue)
                Text(isZh ? "AI 研究助理" : "AI Research Assistant")
                    .font(.headline).foregroundColor(theme.primaryText)
                Spacer()
            }

            Text(isZh ? "對 \(symbol) 有任何問題,直接問 AI。" : "Ask AI anything about \(symbol).")
                .font(.subheadline).foregroundColor(theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)

            Button {
                onAsk(symbol)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "bubble.left.and.bubble.right.fill")
                    Text(isZh ? "問 AI 問題" : "Ask AI a question")
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption)
                }
                .font(.subheadline.weight(.semibold))
                .foregroundColor(.white)
                .padding(.horizontal, 14).padding(.vertical, 11)
                .background(Color.blue)
                .cornerRadius(12)
            }
        }
        .padding(16)
        .background(theme.cardBackground)
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(theme.divider, lineWidth: 1))
        .cornerRadius(16)
    }
}

/// 全螢幕聊天(像 ChatGPT/Claude):訊息可捲動,輸入框固定底部。
struct AIChatSheet: View {
    let symbol: String
    let theme: AppTheme
    let isZh: Bool
    let briefing: String

    private let apiService = StockAPIService()
    private var langCode: String { isZh ? "zh" : "en" }

    @Environment(\.dismiss) private var dismiss
    @StateObject private var store = ChatStore.shared
    @State private var messages: [AIChatMessage] = []
    @State private var input: String = ""
    @State private var isSending = false
    @State private var chatID = UUID()

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(messages) { msg in
                            bubble(role: msg.role, text: msg.content).id(msg.id)
                        }
                        if isSending {
                            HStack(spacing: 8) {
                                ProgressView().tint(theme.primaryText)
                                Text(isZh ? "思考中…" : "Thinking…")
                                    .font(.caption).foregroundColor(theme.secondaryText)
                            }
                            .id("thinking")
                        }
                    }
                    .padding(16)
                }
                .onChange(of: messages.count) { _, _ in scrollToEnd(proxy) }
                .onChange(of: isSending) { _, _ in scrollToEnd(proxy) }
            }
            .background(theme.appBackground)
            .navigationTitle("AI · \(symbol)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(isZh ? "完成" : "Done") { dismiss() }
                }
            }
            .safeAreaInset(edge: .bottom) { inputBar }
        }
        .onAppear {
            // 把報告當作第一則訊息,讓這段對話完整存進紀錄(從「對話」分頁點回來也看得到報告)
            if messages.isEmpty && !briefing.isEmpty {
                messages = [AIChatMessage(role: "assistant", content: briefing)]
            }
        }
    }

    /// 對話有內容時自動存(以 chatID 為準,持續更新同一筆)。
    private func autosave() {
        guard !messages.isEmpty else { return }
        let title = messages.first(where: { $0.role == "user" })?.content ?? symbol
        store.upsert(SavedChat(id: chatID, symbol: symbol, date: Date(),
                               title: String(title.prefix(60)), messages: messages))
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
            TextField(isZh ? "問問題…" : "Ask a question…", text: $input, axis: .vertical)
                .lineLimit(1...5)
                .font(.subheadline)
                .foregroundColor(theme.primaryText)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(theme.cardBackground)
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(theme.divider, lineWidth: 1))
                .cornerRadius(18)

            Button { send() } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 32))
                    .foregroundColor(canSend ? .blue : theme.secondaryText.opacity(0.4))
            }
            .disabled(!canSend)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(.ultraThinMaterial)
    }

    private var canSend: Bool {
        !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSending
    }

    private func scrollToEnd(_ proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.2)) {
            if isSending { proxy.scrollTo("thinking", anchor: .bottom) }
            else if let last = messages.last { proxy.scrollTo(last.id, anchor: .bottom) }
        }
    }

    private func send() {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        messages.append(AIChatMessage(role: "user", content: text))
        input = ""
        isSending = true
        let payloadMessages = messages
        Task {
            defer { Task { @MainActor in isSending = false } }
            do {
                let resp = try await apiService.sendAIChat(symbol: symbol, languageCode: langCode, messages: payloadMessages)
                await MainActor.run {
                    messages.append(AIChatMessage(role: "assistant", content: resp.reply.isEmpty
                        ? (isZh ? "(沒有回應)" : "(no response)") : resp.reply))
                    autosave()
                }
            } catch {
                await MainActor.run {
                    messages.append(AIChatMessage(role: "assistant", content: isZh ? "回覆失敗,請再試一次。" : "Reply failed, please try again."))
                }
            }
        }
    }
}

/// 已存對話清單(本機)。點一筆載入、左滑刪除。
struct ChatHistoryView: View {
    let theme: AppTheme
    let isZh: Bool
    @ObservedObject var store: ChatStore
    let onSelect: (SavedChat) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if store.chats.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: "bubble.left.and.bubble.right")
                            .font(.system(size: 40)).foregroundColor(theme.secondaryText.opacity(0.5))
                        Text(isZh ? "還沒有儲存的對話" : "No saved conversations yet")
                            .font(.subheadline).foregroundColor(theme.secondaryText)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        ForEach(store.chats) { chat in
                            Button {
                                onSelect(chat)
                                dismiss()
                            } label: {
                                HStack(spacing: 12) {
                                    Text(chat.symbol)
                                        .font(.caption.weight(.bold))
                                        .foregroundColor(.white)
                                        .padding(.horizontal, 8).padding(.vertical, 5)
                                        .background(Color.blue)
                                        .clipShape(RoundedRectangle(cornerRadius: 7))
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(chat.title)
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundColor(theme.primaryText)
                                            .lineLimit(1)
                                        Text(Self.relative(chat.date, isZh: isZh)
                                             + " · " + (isZh ? "\(chat.messages.count) 則" : "\(chat.messages.count) msgs"))
                                            .font(.caption2).foregroundColor(theme.secondaryText)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption2).foregroundColor(theme.secondaryText)
                                }
                                .contentShape(Rectangle())
                            }
                            .listRowBackground(theme.cardBackground)
                        }
                        .onDelete { store.delete(at: $0) }
                    }
                    .listStyle(.plain)
                }
            }
            .background(theme.appBackground)
            .navigationTitle(isZh ? "對話紀錄" : "Chat History")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(isZh ? "完成" : "Done") { dismiss() }
                }
            }
        }
    }

    private static func relative(_ date: Date, isZh: Bool) -> String {
        let f = RelativeDateTimeFormatter()
        f.locale = Locale(identifier: isZh ? "zh_TW" : "en_US")
        return f.localizedString(for: date, relativeTo: Date())
    }
}
