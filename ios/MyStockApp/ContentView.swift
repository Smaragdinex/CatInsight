import SwiftUI
import Charts
import UIKit

struct PeriodOption: Identifiable, Hashable {
    let id = UUID()
    let title: String
    let value: String
}

enum AppTheme: String, CaseIterable, Identifiable {
    case dark = "dark"
    case light = "light"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dark: return "Dark 灰底・白字"
        case .light: return "白底・黑字"
        }
    }

    var colorScheme: ColorScheme {
        switch self {
        case .dark: return .dark
        case .light: return .light
        }
    }

    var appBackground: Color {
        switch self {
        case .dark: return Color(red: 0.10, green: 0.10, blue: 0.12)
        case .light: return Color(red: 0.96, green: 0.97, blue: 0.98)
        }
    }

    var cardBackground: Color {
        switch self {
        case .dark: return Color(red: 0.105, green: 0.105, blue: 0.12)
        case .light: return .white
        }
    }

    var chipBackground: Color {
        switch self {
        case .dark: return Color(red: 0.12, green: 0.12, blue: 0.14)
        case .light: return Color(red: 0.96, green: 0.97, blue: 0.98)
        }
    }

    var primaryText: Color {
        switch self {
        case .dark: return .white
        case .light: return .black
        }
    }

    var secondaryText: Color {
        switch self {
        case .dark: return .white.opacity(0.72)
        case .light: return .black.opacity(0.62)
        }
    }

    var divider: Color {
        switch self {
        case .dark: return .white.opacity(0.06)
        case .light: return .black.opacity(0.08)
        }
    }

    var chartAxis: Color {
        switch self {
        case .dark: return .white.opacity(0.78)
        case .light: return .black.opacity(0.72)
        }
    }
}

enum AppLanguage: String, CaseIterable, Identifiable {
    case zh
    case en

    var id: String { rawValue }

    var title: String {
        switch self {
        case .zh: return "中文"
        case .en: return "English"
        }
    }
}

enum MarketColorMode: String, CaseIterable, Identifiable {
    case taiwan
    case us

    var id: String { rawValue }
}

struct AppThemeOption {
    let title: String
    let subtitle: String
}

struct MarketColorOption {
    let title: String
    let subtitle: String
}

struct CopySet {
    let searchPlaceholder: String
    let searchButton: String
    let loadingText: String
    let emptyPrompt: String
    let fetchFailedPrefix: String
    let noDataText: String
    let notFoundText: String
    let latestPrice: String
    let preMarketPrice: String
    let postMarketPrice: String
    let useHistoricalFallback: String
    let maLabel: String
    let openLabel: String
    let todayHighLabel: String
    let todayLowLabel: String
    let marketCapLabel: String
    let fiftyTwoWeekHighLabel: String
    let fiftyTwoWeekLowLabel: String
    let epsLabel: String
    let peRatioLabel: String
    let dividendYieldLabel: String
    let historyTitle: String
    let newsTitle: String
    let newsEmptyText: String
    let moreButton: String
    let lessButton: String
    let listsTitle: String
    let emptyListsText: String
    let closeButton: String
    let backToListButton: String
    let languageTitle: String
    let languageSubtitle: String
    let themeTitle: String
    let themeSubtitle: String
    let darkThemeTitle: String
    let darkThemeSubtitle: String
    let lightThemeTitle: String
    let lightThemeSubtitle: String
    let preBadge: String
    let postBadge: String
    let regularBadge: String
    let rsiLabel: String
    let mfiLabel: String
    let signalLabel: String
    let strongLabel: String
    let distributionLabel: String
    let neutralLabel: String
}

struct ContentView: View {
    @StateObject private var viewModel = DashboardViewModel()

    enum ScreenMode {
        case search
        case watchlist
        case detail
        case conversations
    }

    enum SettingsSection: Identifiable {
        case language
        case theme
        case marketColors
        case voice
        case disclaimer

        var id: String {
            switch self {
            case .language: return "language"
            case .theme: return "theme"
            case .marketColors: return "marketColors"
            case .voice: return "voice"
            case .disclaimer: return "disclaimer"
            }
        }
    }

    @AppStorage("selectedTheme") private var selectedThemeRaw = AppTheme.dark.rawValue
    @AppStorage("selectedLanguage") private var selectedLanguageRaw = AppLanguage.zh.rawValue
    @AppStorage("marketColorMode") private var marketColorModeRaw = MarketColorMode.taiwan.rawValue

                                @State private var showSettings = false
                @State private var isHistoryExpanded = false
    @State private var llmLoadingPhase = 0
    @State private var llmLoadingTask: Task<Void, Never>?
            @State private var isNewsExpanded = false
    @State private var screenMode: ScreenMode = .search
    @State private var watchlist: [WatchlistItem] = UserDefaults.standard.codableArray(forKey: "watchlist.items", as: WatchlistItem.self)
    @State private var marketIndexQuotes: [String: WatchlistQuote] = [:]
    @State private var rankingItems: [RankingItem] = []
    @State private var rankingAsOf: String?
    @State private var gainerItems: [GainerItem] = []
    @State private var gainersAsOf: String?
    @State private var gainerWindow: String = "1y"   // "1y" 近一年(預設) / "ytd" 今年
    /// 舊版「猜明天漲跌」卡片已停用,改用 AIChatView(報告+問答)。設 true 可重新顯示舊卡。
    private let showLegacyAIPrediction = false
    @State private var pendingChat: PendingNewChat?
    @State private var showAlertSheet = false
    @State private var reviewTrigger = 0   // +1 就會跳評分請求(見 ReviewPrompter)
    @State private var detailScrollTarget: String?   // 個股頁捲到指定卡片(測試用)
    @StateObject private var alertCenter = AlertCenter.shared
    @AppStorage("chart.candle") private var showCandle = false
                                @State private var activeSettingsSection: SettingsSection?

    private let apiBaseURL = "https://api.example.com"   // 部署時改成自己的後端網址
    private let apiService = StockAPIService()
    private let liveDotColor: Color = .blue
    // 上排:最重要的大盤指數;下排:其餘。兩排各自獨立左右滑動。
    private let marketIndicesTop: [MarketIndexItem] = [
        .init(symbol: "^GSPC", name: "S&P 500"),
        .init(symbol: "^IXIC", name: "NASDAQ"),
        .init(symbol: "^NDX", name: "NASDAQ 100"),
        .init(symbol: "^DJI", name: "Dow Jones"),
        .init(symbol: "^RUT", name: "Russell 2000")
    ]
    private let marketIndicesBottom: [MarketIndexItem] = [
        .init(symbol: "BTC-USD", name: "Bitcoin"),
        .init(symbol: "CL=F", name: "Crude Oil"),
        .init(symbol: "GC=F", name: "Gold"),
        .init(symbol: "DX-Y.NYB", name: "US Dollar"),
        .init(symbol: "^VIX", name: "VIX"),
        .init(symbol: "^SOX", name: "PHLX SOX"),
        .init(symbol: "^TNX", name: "TNX")
    ]
    private var marketIndices: [MarketIndexItem] { marketIndicesTop + marketIndicesBottom }

    private var selectedTheme: AppTheme { AppTheme(rawValue: selectedThemeRaw) ?? .dark }
    private var selectedLanguage: AppLanguage { AppLanguage(rawValue: selectedLanguageRaw) ?? .zh }
    private var marketColorMode: MarketColorMode { MarketColorMode(rawValue: marketColorModeRaw) ?? .taiwan }
    private let contentInnerHorizontalPadding: CGFloat = 12

    private var text: CopySet {
        switch selectedLanguage {
        case .zh:
            return CopySet(
                searchPlaceholder: "輸入股票代號或公司名，例如 NVDA、NVIDIA、台積電",
                searchButton: "查詢",
                loadingText: "資料載入中...",
                emptyPrompt: "請輸入股票代號後查詢",
                fetchFailedPrefix: "抓取失敗：",
                noDataText: "沒有收到資料",
                notFoundText: "找不到股票代號，請從下方候選結果選擇。",
                latestPrice: "最新價格",
                preMarketPrice: "盤前價格",
                postMarketPrice: "盤後價格",
                useHistoricalFallback: "使用歷史資料最新一筆",
                maLabel: "5MA",
                openLabel: "開盤價",
                todayHighLabel: "今日高點",
                todayLowLabel: "今日低點",
                marketCapLabel: "市值",
                fiftyTwoWeekHighLabel: "52週高點",
                fiftyTwoWeekLowLabel: "52週低點",
                epsLabel: "EPS",
                peRatioLabel: "本益比",
                dividendYieldLabel: "殖利率",
                historyTitle: "歷史明細",
                newsTitle: "新聞",
                newsEmptyText: "目前沒有相關新聞",
                moreButton: "展開",
                lessButton: "收起",
                listsTitle: "清單",
                emptyListsText: "還沒有加入任何股票",
                closeButton: "關閉",
                backToListButton: "回到股票list",
                languageTitle: "語言切換",
                languageSubtitle: "選擇你想要的顯示語言",
                themeTitle: "主題切換",
                themeSubtitle: "選擇你想要的介面風格",
                darkThemeTitle: "深色模式",
                darkThemeSubtitle: "深色背景與淺色文字",
                lightThemeTitle: "淺色模式",
                lightThemeSubtitle: "淺色背景與深色文字",
                preBadge: "盤前",
                postBadge: "盤後",
                regularBadge: "正常盤",
                rsiLabel: "RSI",
                mfiLabel: "MFI",
                signalLabel: "判斷",
                strongLabel: "強勢",
                distributionLabel: "主力出貨",
                neutralLabel: "中性"
            )
        case .en:
            return CopySet(
                searchPlaceholder: "Enter symbol or company name, e.g. NVDA, NVIDIA, TSMC",
                searchButton: "Search",
                loadingText: "Loading...",
                emptyPrompt: "Enter a stock symbol to begin",
                fetchFailedPrefix: "Fetch failed: ",
                noDataText: "No data received",
                notFoundText: "Symbol not found. Please choose from suggestions below.",
                latestPrice: "Latest Price",
                preMarketPrice: "Pre-Market Price",
                postMarketPrice: "After-Hours Price",
                useHistoricalFallback: "Using latest historical datapoint",
                maLabel: "5MA",
                openLabel: "Open",
                todayHighLabel: "Today's High",
                todayLowLabel: "Today's Low",
                marketCapLabel: "Market Cap",
                fiftyTwoWeekHighLabel: "52W High",
                fiftyTwoWeekLowLabel: "52W Low",
                epsLabel: "EPS",
                peRatioLabel: "P/E Ratio",
                dividendYieldLabel: "Dividend Yield",
                historyTitle: "Historical Details",
                newsTitle: "News",
                newsEmptyText: "No related news at the moment",
                moreButton: "More",
                lessButton: "Less",
                listsTitle: "Lists",
                emptyListsText: "No stocks in your list yet",
                closeButton: "Close",
                backToListButton: "Back to stock list",
                languageTitle: "Language",
                languageSubtitle: "Choose display language",
                themeTitle: "Theme",
                themeSubtitle: "Choose your interface style",
                darkThemeTitle: "Dark Mode",
                darkThemeSubtitle: "Dark background with light text",
                lightThemeTitle: "Light Mode",
                lightThemeSubtitle: "Light background with dark text",
                preBadge: "PRE",
                postBadge: "POST",
                regularBadge: "REGULAR",
                rsiLabel: "RSI",
                mfiLabel: "MFI",
                signalLabel: "Signal",
                strongLabel: "Strong",
                distributionLabel: "Distribution",
                neutralLabel: "Neutral"
            )
        }
    }

    // 對齊 Robinhood:1D / 1W / 1M / 3M / YTD / 1Y(後端 1W 對應 period=5d)
    let periodOptions: [PeriodOption] = [
        .init(title: "1D", value: "1d"),
        .init(title: "1W", value: "5d"),
        .init(title: "1M", value: "1mo"),
        .init(title: "3M", value: "3mo"),
        .init(title: "YTD", value: "ytd"),
        .init(title: "1Y", value: "1y")
    ]

    var body: some View {
        NavigationStack {
            ZStack {
                selectedTheme.appBackground.ignoresSafeArea()

                VStack(spacing: 12) {
                    if screenMode == .search {
                        searchBar
                    }
                    contentView
                    bottomBar
                }
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 20, coordinateSpace: .local)
                        .onEnded { value in
                            guard showsBackToListButton else { return }
                            let isHorizontalSwipe = abs(value.translation.width) > abs(value.translation.height)
                            let isSwipeRight = value.translation.width > 70
                            guard isHorizontalSwipe && isSwipeRight else { return }
                            withAnimation(.easeInOut(duration: 0.2)) {
                                screenMode = .watchlist
                            }
                        }
                )
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(screenMode == .detail ? .visible : .hidden, for: .navigationBar)
            .onAppear {
                ReviewPrompter.noteFirstLaunchIfNeeded()
                #if DEBUG
                // 測試用:用環境變數直接開指定股票(xcrun simctl launch 時帶 SIMCTL_CHILD_AUTO_OPEN_SYMBOL=NVDA)
                let env = ProcessInfo.processInfo.environment
                if env["AUTO_SETTINGS"] == "voice" { activeSettingsSection = .voice; showSettings = true }
                if let sym = env["AUTO_OPEN_SYMBOL"], !sym.isEmpty {
                    if let period = env["AUTO_PERIOD"], !period.isEmpty { viewModel.selectedPeriod = period }
                    if env["AUTO_CANDLE"] == "1" { showCandle = true }
                    if env["AUTO_DIGEST"] == "1" {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
                            Task { await viewModel.fetchNewsDigest(languageCode: selectedLanguage == .zh ? "zh" : "en") }
                            detailScrollTarget = "newsCard"
                        }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 14) { detailScrollTarget = "newsCard" }
                    }
                    if env["AUTO_VOICE_TEXT"] != nil {
                        // 直接開該股對話並進語音模式(VoiceChatView 會把 AUTO_VOICE_TEXT 當成使用者說的話)
                        pendingChat = PendingNewChat(symbol: sym, briefing: "")
                        screenMode = .conversations
                    } else {
                        screenMode = .detail
                        viewModel.symbol = sym
                        viewModel.refreshAllData(symbolOverride: sym, languageCode: selectedLanguage == .zh ? "zh" : "en")
                    }
                }
                #endif
                viewModel.refreshWatchlistQuotes(symbols: watchlist.map(\.symbol))
                viewModel.startWatchlistAutoRefresh(symbols: watchlist.map(\.symbol))
                refreshMarketIndices()
                loadRanking()
                loadTopGainers()
                evaluateAllAlerts()
            }
            .onDisappear {
                viewModel.stopQuoteAutoRefresh()
                viewModel.stopWatchlistAutoRefresh()
                                stopLLMLoadingAnimation()
            }
            .onChange(of: selectedLanguageRaw) { _, _ in
                let currentSymbol = viewModel.normalizedSymbolInput(viewModel.symbol)
                guard !currentSymbol.isEmpty else { return }
                viewModel.llmTomorrow = nil
                viewModel.aiAnalysis = nil
                viewModel.isLLMTomorrowLoading = true
                startLLMLoadingAnimation()
                Task {
                    await viewModel.fetchLLMTomorrow(using: currentSymbol, languageCode: selectedLanguage == .zh ? "zh" : "en", forceRefresh: true)
                    await viewModel.fetchAIAnalysis(using: currentSymbol, languageCode: selectedLanguage == .zh ? "zh" : "en", forceRefresh: true)
                    stopLLMLoadingAnimation()
                }
            }
            .onReceive(PushSync.shared.$pendingSymbol) { sym in
                // 點推播通知進來 → 直接打開該股
                guard let sym, !sym.isEmpty else { return }
                PushSync.shared.pendingSymbol = nil
                screenMode = .detail
                viewModel.symbol = sym
                viewModel.refreshAllData(symbolOverride: sym, languageCode: selectedLanguage == .zh ? "zh" : "en")
            }
            .onChange(of: screenMode) { _, mode in
                if mode == .detail, ReviewPrompter.shouldPrompt(after: .detailOpened) { reviewTrigger += 1 }
            }
            .onChange(of: viewModel.isLLMTomorrowLoading) { _, isLoading in
                if isLoading {
                    startLLMLoadingAnimation()
                } else {
                    stopLLMLoadingAnimation()
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if showsBackToListButton {
                        Button {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                screenMode = .watchlist
                            }
                        } label: {
                            Image(systemName: "chevron.left")
                                .font(.headline)
                        }
                        .tint(selectedTheme.primaryText)
                    }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    if screenMode == .detail && (viewModel.stockInfo != nil || viewModel.liveQuote != nil) {
                        Button {
                            showAlertSheet = true
                        } label: {
                            Image(systemName: alertCenter.hasAlerts(for: viewModel.normalizedSymbolInput(viewModel.symbol)) ? "bell.fill" : "bell")
                        }
                        .tint(alertCenter.hasAlerts(for: viewModel.normalizedSymbolInput(viewModel.symbol)) ? .blue : selectedTheme.primaryText)
                    }
                }

                if #available(iOS 26.0, *) {
                    ToolbarSpacer(.fixed, placement: .topBarTrailing)
                }

                ToolbarItem(placement: .topBarTrailing) {
                    if screenMode == .detail && (viewModel.stockInfo != nil || viewModel.liveQuote != nil) {
                        Button {
                            toggleWatchlistForCurrentStock()
                        } label: {
                            Image(systemName: isCurrentStockInWatchlist ? "checkmark.circle" : "plus")
                        }
                        .tint(isCurrentStockInWatchlist ? .green : selectedTheme.primaryText)
                    }
                }
            }
            .sheet(isPresented: $showAlertSheet) {
                AlertSheet(symbol: viewModel.normalizedSymbolInput(viewModel.symbol),
                           theme: selectedTheme, isZh: selectedLanguage == .zh,
                           upColor: risingColor(), downColor: fallingColor())
            }
            .sheet(isPresented: $showSettings) {
                SettingsSheetView(
                    showSettings: $showSettings,
                    activeSettingsSection: $activeSettingsSection,
                    selectedThemeRaw: $selectedThemeRaw,
                    selectedLanguageRaw: $selectedLanguageRaw,
                    marketColorModeRaw: $marketColorModeRaw,
                    selectedTheme: selectedTheme,
                    text: text,
                    selectedLanguage: selectedLanguage
                )
            }
        }
        .preferredColorScheme(selectedTheme.colorScheme)
        .reviewPrompt(trigger: $reviewTrigger)
    }

    private var showsBackToListButton: Bool {
        screenMode == .detail && (viewModel.stockInfo != nil || viewModel.liveQuote != nil)
    }

    private var bottomBar: some View {
        HStack {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    screenMode = .watchlist
                }
            } label: {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.title3)
                    .foregroundColor(screenMode == .watchlist ? .blue : selectedTheme.primaryText)
                    .frame(maxWidth: .infinity)
                    .frame(height: 28)
            }

            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    screenMode = .search
                }
            } label: {
                Image(systemName: "magnifyingglass")
                    .font(.title3)
                    .foregroundColor(screenMode == .search ? .blue : selectedTheme.primaryText)
                    .frame(maxWidth: .infinity)
                    .frame(height: 28)
            }

            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    screenMode = .conversations
                }
            } label: {
                Image(systemName: "bubble.left.and.bubble.right")
                    .font(.title3)
                    .foregroundColor(screenMode == .conversations ? .blue : selectedTheme.primaryText)
                    .frame(maxWidth: .infinity)
                    .frame(height: 28)
            }

            Button {
                showSettings = true
            } label: {
                Image(systemName: "gearshape")
                    .font(.title3)
                    .foregroundColor(selectedTheme.primaryText)
                    .frame(maxWidth: .infinity)
                    .frame(height: 28)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 12)
        .background(selectedTheme.appBackground)
    }

    private var watchlistView: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(text.listsTitle)
                    .font(.title3)
                    .fontWeight(.bold)
                    .foregroundColor(selectedTheme.primaryText)

                Spacer()

                if !watchlist.isEmpty {
                    Button {
                        let prompt = selectedLanguage == .zh
                            ? "幫我分析我的 watchlist 股票池健康狀況:集中度、動能與超買/超賣、估值 vs 分析師目標,以及最強/最弱的持股。"
                            : "Analyze my watchlist's health: concentration, momentum & overbought/oversold, valuation vs analyst targets, and strongest/weakest holdings."
                        pendingChat = PendingNewChat(symbol: "", briefing: "", autoPrompt: prompt)
                        withAnimation(.easeInOut(duration: 0.2)) { screenMode = .conversations }
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "sparkles")
                            Text(selectedLanguage == .zh ? "分析" : "Analyze")
                        }
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(Color.blue)
                        .cornerRadius(10)
                    }
                }
            }
            .padding(.horizontal)

            if watchlist.isEmpty {
                Spacer()
                Text(text.emptyListsText)
                    .foregroundColor(selectedTheme.secondaryText)
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
                Spacer()
            } else {
                List {
                    ForEach(watchlist) { item in
                        let quote = viewModel.watchlistQuotes[item.symbol]
                        let upColor = marketColorMode == .us ? Color.green : Color.red
                        let downColor = marketColorMode == .us ? Color.red : Color.green
                        let sparkline = quote?.sparkline ?? []
                        let firstPoint = sparkline.first
                        let lastPoint = sparkline.last
                        let moveColor: Color = {
                            guard let firstPoint, let lastPoint else { return selectedTheme.secondaryText }
                            if lastPoint > firstPoint { return upColor }
                            if lastPoint < firstPoint { return downColor }
                            return selectedTheme.secondaryText
                        }()

                        Button {
                            screenMode = .detail
                            viewModel.symbol = item.symbol
                            viewModel.refreshAllData(symbolOverride: item.symbol, languageCode: selectedLanguage == .zh ? "zh" : "en")
                        } label: {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(item.symbol)
                                        .font(.headline)
                                        .foregroundColor(selectedTheme.primaryText)
                                    Text(item.name)
                                        .font(.caption)
                                        .foregroundColor(selectedTheme.secondaryText)
                                        .lineLimit(1)
                                        .truncationMode(.tail)
                                }
                                .frame(width: 110, alignment: .leading)

                                MiniSparklineView(values: quote?.sparkline ?? [], color: moveColor)
                                    .frame(maxWidth: .infinity)

                                Text(formattedListPrice(quote?.price))
                                    .font(.subheadline)
                                    .fontWeight(.bold)
                                    .foregroundColor(.white)
                                    .minimumScaleFactor(0.5)
                                    .frame(minWidth: 85)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 8)
                                    .background(moveColor)
                                    .cornerRadius(10)
                            }
                            .padding(.vertical, 6)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button {
                                removeWatchlistItem(symbol: item.symbol)
                            } label: {
                                Image(systemName: "trash.fill")
                            }
                            .tint(.red)
                        }
                        .listRowBackground(selectedTheme.appBackground)
                        .listRowSeparatorTint(selectedTheme.divider)
                    }
                    .onMove(perform: moveWatchlistItems)
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .background(selectedTheme.appBackground)
            }
        }
        .padding(.top, 10)
    }

    private var isCurrentStockInWatchlist: Bool {
        guard let currentSymbol = (viewModel.liveQuote?.stock ?? viewModel.stockInfo?.stock), !currentSymbol.isEmpty else { return false }
        return watchlist.contains(where: { $0.symbol == currentSymbol })
    }

    private func toggleWatchlistForCurrentStock() {
        let currentSymbol = (viewModel.liveQuote?.stock ?? viewModel.stockInfo?.stock ?? viewModel.symbol).trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !currentSymbol.isEmpty else { return }
        let currentName = viewModel.liveQuote?.companyName ?? viewModel.stockInfo?.stock ?? currentSymbol

        if let idx = watchlist.firstIndex(where: { $0.symbol == currentSymbol }) {
            watchlist.remove(at: idx)
            viewModel.watchlistQuotes.removeValue(forKey: currentSymbol)
        } else {
            watchlist.append(WatchlistItem(symbol: currentSymbol, name: currentName))
            if ReviewPrompter.shouldPrompt(after: .watchlistAdded(count: watchlist.count)) { reviewTrigger += 1 }
        }

        UserDefaults.standard.setCodableArray(watchlist, forKey: "watchlist.items")
        PushSync.shared.syncAlerts()
        viewModel.refreshWatchlistQuotes(symbols: watchlist.map(\.symbol), force: true)
        viewModel.startWatchlistAutoRefresh(symbols: watchlist.map(\.symbol))
    }

    private func moveWatchlistItems(from source: IndexSet, to destination: Int) {
        watchlist.move(fromOffsets: source, toOffset: destination)
        UserDefaults.standard.setCodableArray(watchlist, forKey: "watchlist.items")
        PushSync.shared.syncAlerts()
    }

    private func removeWatchlistItem(symbol: String) {
        guard let index = watchlist.firstIndex(where: { $0.symbol == symbol }) else { return }
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.prepare()
        watchlist.remove(at: index)
        viewModel.watchlistQuotes.removeValue(forKey: symbol)
        UserDefaults.standard.setCodableArray(watchlist, forKey: "watchlist.items")
        PushSync.shared.syncAlerts()
        generator.impactOccurred()
    }

    private var searchBar: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                TextField(text.searchPlaceholder, text: $viewModel.searchQuery)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(selectedTheme.cardBackground)
                    .foregroundColor(selectedTheme.primaryText)
                    .cornerRadius(14)
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(selectedTheme.divider, lineWidth: 1)
                    )
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.characters)
                    .onSubmit {
                        let trimmed = viewModel.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
                        let normalized = trimmed.uppercased()

                        if containsChinese(trimmed) {
                            if let first = viewModel.searchResults.first {
                                selectSearchResult(first)
                            }
                            return
                        }

                        if let exact = viewModel.searchResults.first(where: { $0.symbol.uppercased() == normalized }) {
                            selectSearchResult(exact)
                        }
                    }

                Button(text.searchButton) {
                    let trimmed = viewModel.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
                    let normalized = trimmed.uppercased()

                    if containsChinese(trimmed) {
                        if let first = viewModel.searchResults.first {
                            selectSearchResult(first)
                        }
                    } else if let exact = viewModel.searchResults.first(where: { $0.symbol.uppercased() == normalized }) {
                        selectSearchResult(exact)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(.blue)
                .disabled(viewModel.isLoading)
            }

            if !viewModel.searchResults.isEmpty {
                VStack(spacing: 0) {
                    ForEach(viewModel.searchResults.prefix(5)) { result in
                        Button {
                            selectSearchResult(result)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("\(result.symbol) · \(result.name)")
                                        .foregroundColor(selectedTheme.primaryText)
                                        .font(.subheadline)
                                        .multilineTextAlignment(.leading)

                                    if let exchange = result.exchange, !exchange.isEmpty {
                                        Text(exchange)
                                            .font(.caption)
                                            .foregroundColor(selectedTheme.secondaryText)
                                    }
                                }

                                Spacer()
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                        }

                        Divider().overlay(selectedTheme.divider)
                    }
                }
                .background(selectedTheme.cardBackground)
                .cornerRadius(14)
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(selectedTheme.divider, lineWidth: 1)
                )
            }
        }
        .padding(.horizontal)
        .padding(.top, 8)
    }

    @ViewBuilder
    private var rankingSection: some View {
        if !rankingItems.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline) {
                    Text(selectedLanguage == .zh ? "AI 精選排名" : "AI Top Picks")
                        .font(.headline)
                        .foregroundColor(selectedTheme.primaryText)
                    Spacer()
                    if let asOf = rankingAsOf {
                        Text(asOf)
                            .font(.caption)
                            .foregroundColor(selectedTheme.secondaryText)
                    }
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(rankingItems) { item in
                            Button {
                                openRankingSymbol(item.symbol)
                            } label: {
                                rankingCard(for: item)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(.horizontal)
        }
    }

    private func rankingCard(for item: RankingItem) -> some View {
        let priceText = item.price.map { String(format: "%.2f", $0) } ?? "--"
        let upside = item.analystUpside ?? 0
        let upsideText = String(format: "%+.0f%%", upside * 100)
        let upsideColor = upside >= 0 ? risingColor() : fallingColor()
        let rsiText = item.rsi.map { String(format: "RSI %.0f", $0) } ?? "RSI --"

        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text("#\(item.rank)")
                    .font(.caption2.weight(.bold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Color.blue)
                    .cornerRadius(6)
                Spacer()
                if item.isNewStock == true {
                    Image(systemName: "sparkles")
                        .font(.caption2)
                        .foregroundColor(.yellow)
                }
            }

            Text(item.symbol)
                .font(.title3.weight(.bold))
                .foregroundColor(selectedTheme.primaryText)

            Text(priceText)
                .font(.subheadline.weight(.semibold))
                .foregroundColor(selectedTheme.primaryText)

            HStack(spacing: 6) {
                Text(selectedLanguage == .zh ? "分析師" : "Upside")
                    .font(.caption2)
                    .foregroundColor(selectedTheme.secondaryText)
                Text(upsideText)
                    .font(.caption.weight(.semibold))
                    .foregroundColor(upsideColor)
            }

            Text(rsiText)
                .font(.caption2)
                .foregroundColor(selectedTheme.secondaryText)
        }
        .padding(12)
        .frame(width: 124, alignment: .leading)
        .background(selectedTheme.cardBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(selectedTheme.divider, lineWidth: 1)
        )
        .cornerRadius(14)
    }

    @ViewBuilder
    private var topGainersSection: some View {
        if !gainerItems.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .center, spacing: 6) {
                    Image(systemName: "flame.fill")
                        .foregroundColor(.orange)
                    Text(selectedLanguage == .zh ? "漲幅榜" : "Top Gainers")
                        .font(.headline)
                        .foregroundColor(selectedTheme.primaryText)
                    Spacer()
                    gainerWindowToggle
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(gainerItems) { item in
                            Button {
                                openRankingSymbol(item.symbol)
                            } label: {
                                gainerCard(for: item)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(.horizontal)
        }
    }

    private var gainerWindowToggle: some View {
        let options: [(key: String, label: String)] = [
            ("1y", selectedLanguage == .zh ? "近1年" : "1Y"),
            ("ytd", selectedLanguage == .zh ? "今年" : "YTD"),
        ]
        return HStack(spacing: 0) {
            ForEach(options, id: \.key) { opt in
                let selected = gainerWindow == opt.key
                Button {
                    guard gainerWindow != opt.key else { return }
                    gainerWindow = opt.key
                    loadTopGainers()   // 保留舊內容直到新資料到,避免整區閃爍/版面跳動
                } label: {
                    Text(opt.label)
                        .font(.caption.weight(.semibold))
                        .foregroundColor(selected ? .white : selectedTheme.secondaryText)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(selected ? Color.orange : Color.clear)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(selectedTheme.chipBackground)
        .clipShape(Capsule())
    }

    private func gainerCard(for item: GainerItem) -> some View {
        let priceText = item.price.map { String(format: "%.2f", $0) } ?? "--"
        let pct = item.changePct ?? 0
        let pctText = String(format: "%+.0f%%", pct * 100)

        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text("#\(item.rank)")
                    .font(.caption2.weight(.bold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Color.orange)
                    .cornerRadius(6)
                Spacer()
            }

            Text(item.symbol)
                .font(.title3.weight(.bold))
                .foregroundColor(selectedTheme.primaryText)

            Text(pctText)
                .font(.title3.weight(.heavy))
                .foregroundColor(risingColor())

            Text(priceText)
                .font(.caption.weight(.semibold))
                .foregroundColor(selectedTheme.secondaryText)
        }
        .padding(12)
        .frame(width: 124, alignment: .leading)
        .background(selectedTheme.cardBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(selectedTheme.divider, lineWidth: 1)
        )
        .cornerRadius(14)
    }

    private var marketIndexSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Image(systemName: "globe.americas.fill")
                    .font(.subheadline)
                    .foregroundColor(.blue)
                Text(selectedLanguage == .zh ? "市場指標" : "Market Indices")
                    .font(.headline)
                    .foregroundColor(selectedTheme.primaryText)
            }

            marketIndexRow(marketIndicesTop)
            marketIndexRow(marketIndicesBottom)
        }
        .padding(.horizontal)
    }

    private func marketIndexRow(_ items: [MarketIndexItem]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(items) { item in
                    Button {
                        openMarketIndex(item)
                    } label: {
                        marketIndexCard(for: item)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func marketIndexCard(for item: MarketIndexItem) -> some View {
        let quote = marketIndexQuotes[item.symbol]
        let sparkline = quote?.sparkline ?? []
        let change = quote?.change ?? 0
        let moveColor = change >= 0 ? risingColor() : fallingColor()
        let priceText = quote?.price.map { String(format: "%.2f", $0) } ?? "--"
        let changeText = quote?.change.map { String(format: "%+.2f", $0) } ?? "--"
        let changePercentText: String = {
            guard let change = quote?.change,
                  let previousClose = quote?.previousClose,
                  previousClose != 0 else { return "--" }
            let percent = (change / previousClose) * 100
            return String(format: "(%+.2f%%)", percent)
        }()

        let hasData = quote?.change != nil
        let arrowIcon = change >= 0 ? "arrow.up.right" : "arrow.down.right"

        return HStack(spacing: 0) {
            // 方向色彩的側邊強調條
            RoundedRectangle(cornerRadius: 2)
                .fill(hasData ? moveColor : selectedTheme.divider)
                .frame(width: 3)
                .padding(.vertical, 4)

            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    Text(item.name)
                        .font(.subheadline.weight(.bold))
                        .foregroundColor(selectedTheme.primaryText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)

                    Spacer(minLength: 4)

                    Text(item.symbol.replacingOccurrences(of: "^", with: ""))
                        .font(.caption2.weight(.semibold))
                        .foregroundColor(selectedTheme.secondaryText)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(selectedTheme.chipBackground)
                        .clipShape(Capsule())
                }

                MiniSparklineView(values: sparkline, color: moveColor, baseline: quote?.previousClose)
                    .frame(maxWidth: .infinity, minHeight: 34, alignment: .leading)

                HStack(alignment: .center, spacing: 6) {
                    Text(priceText)
                        .font(.title3.weight(.bold))
                        .foregroundColor(selectedTheme.primaryText)
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                        .layoutPriority(0)

                    Spacer(minLength: 4)

                    if hasData {
                        HStack(spacing: 3) {
                            Image(systemName: arrowIcon)
                                .font(.system(size: 9, weight: .bold))
                            Text(changePercentText.replacingOccurrences(of: "(", with: "").replacingOccurrences(of: ")", with: ""))
                                .font(.caption2.weight(.bold))
                                .lineLimit(1)
                        }
                        .foregroundColor(moveColor)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(moveColor.opacity(0.14))
                        .clipShape(Capsule())
                        .fixedSize(horizontal: true, vertical: false)
                        .layoutPriority(1)
                    }
                }

                if hasData {
                    Text(changeText)
                        .font(.caption2)
                        .foregroundColor(selectedTheme.secondaryText)
                }
            }
            .padding(.leading, 10)
            .padding(.trailing, 12)
            .padding(.vertical, 12)
        }
        .frame(width: 168, height: 138, alignment: .topLeading)
        .background(selectedTheme.cardBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(hasData ? moveColor.opacity(0.18) : selectedTheme.divider, lineWidth: 1)
        )
        .cornerRadius(16)
        .shadow(color: .black.opacity(selectedTheme == .dark ? 0.25 : 0.06), radius: 5, x: 0, y: 2)
    }

    @ViewBuilder
    private var contentView: some View {
        switch screenMode {
        case .conversations:
            ConversationsView(theme: selectedTheme, isZh: selectedLanguage == .zh, pending: $pendingChat,
                              watchlistSymbols: watchlist.map(\.symbol))
        case .watchlist:
            watchlistView
        case .search:
            ScrollView {
                VStack(spacing: 16) {
                    rankingSection
                    topGainersSection
                    marketIndexSection
                }
                .padding(.bottom, 16)
            }
        case .detail:
            if viewModel.isLoading {
                Spacer()
                ProgressView(text.loadingText)
                    .tint(selectedTheme.primaryText)
                    .foregroundColor(selectedTheme.primaryText)
                Spacer()
            } else if let errorMessage = viewModel.errorMessage {
                Spacer()
                Text(errorMessage)
                    .foregroundColor(.red)
                    .padding()
                    .background(selectedTheme.cardBackground)
                    .cornerRadius(14)
                Spacer()
            } else if let info = viewModel.stockInfo {
                ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 16) {
                        summaryCard(info: info)
                        if let health = viewModel.health, health.available, !(health.factors ?? []).isEmpty {
                            HealthRadarCard(health: health, theme: selectedTheme, isZh: selectedLanguage == .zh)
                        }
                        AIAssistantCard(symbol: viewModel.normalizedSymbolInput(viewModel.symbol),
                                        theme: selectedTheme,
                                        isZh: selectedLanguage == .zh,
                                        onAsk: { sym in
                                            pendingChat = PendingNewChat(symbol: sym, briefing: "")
                                            withAnimation(.easeInOut(duration: 0.2)) { screenMode = .conversations }
                                        })
                        chartSection(info: info)
                        metricsSection
                        indicatorCard(info: info)
                        historyListCard(info: info)
                        newsCard.id("newsCard")
                        ratingsCard
                        valuationCard
                        earningsCard
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 16)
                }
                .refreshable {
                    viewModel.refreshAllData(languageCode: selectedLanguage == .zh ? "zh" : "en")
                }
                .onChange(of: detailScrollTarget) { _, target in
                    guard let target else { return }
                    withAnimation { proxy.scrollTo(target, anchor: .top) }
                    detailScrollTarget = nil
                }
                }
            } else {
                Spacer()
                Text(text.emptyPrompt)
                    .foregroundColor(selectedTheme.secondaryText)
                Spacer()
            }
        }
    }

    private var currentResolvedSymbol: String {
        (viewModel.liveQuote?.stock ?? viewModel.stockInfo?.stock ?? viewModel.symbol).uppercased()
    }

    private var isTaiwanSymbol: Bool {
        currentResolvedSymbol.hasSuffix(".TW") || currentResolvedSymbol.hasSuffix(".TWO")
    }

    private var latestHistoryPrice: Double? {
        viewModel.stockInfo?.data.last?.price
    }

    private var syncedDisplayPrice: Double? {
        if let latestHistoryPrice {
            return latestHistoryPrice
        }

        if isTaiwanSymbol {
            return viewModel.liveQuote?.displayPrice ?? viewModel.liveQuote?.regularPrice ?? viewModel.liveQuote?.price
        }

        if let listPrice = viewModel.watchlistQuotes[currentResolvedSymbol]?.price {
            return listPrice
        }
        return preferredLivePrice
    }

    private func summaryCard(info: StockResponse) -> some View {
        let latestPrice = syncedDisplayPrice ?? 0
        let changeTextValue: String?
        let changeColorValue: Color?

        if let syncedChangeMetrics {
            changeTextValue = changeText(change: syncedChangeMetrics.change, percent: syncedChangeMetrics.percent)
            changeColorValue = changeColor(syncedChangeMetrics.change)
        } else if let change = viewModel.liveQuote?.change,
                  let changePercent = viewModel.liveQuote?.changePercent {
            changeTextValue = changeText(change: change, percent: changePercent)
            changeColorValue = changeColor(change)
        } else {
            changeTextValue = nil
            changeColorValue = nil
        }

        return SummaryCardView(
            stock: info.stock,
            companyName: viewModel.liveQuote?.companyName ?? info.stock,
            quoteLoading: viewModel.quoteLoading,
            priceLabel: priceLabel,
            latestPriceText: "$\(String(format: "%.2f", latestPrice))",
            priceColor: quotePriceColor(info: info),
            changeText: changeTextValue,
            changeColor: changeColorValue,
            fallbackText: text.useHistoricalFallback,
            maLabel: text.maLabel,
            maText: info.data.last?.ma5.map { String(format: "%.2f", $0) } ?? "-",
            sessionText: (!isTaiwanSymbol ? viewModel.liveQuote?.session.map(sessionText) : nil),
            sessionColor: (!isTaiwanSymbol ? viewModel.liveQuote?.session.map(sessionBadgeColor) : nil),
            theme: selectedTheme
        )
    }

    private func indicatorCard(info: StockResponse) -> some View {
        AdaptiveMetricRowView(spacing: 12) {
            MetricCardView(title: text.rsiLabel, value: formattedNumber(info.rsi), primaryText: selectedTheme.primaryText, secondaryText: selectedTheme.secondaryText)
            MetricCardView(title: text.mfiLabel, value: formattedNumber(info.mfi), primaryText: selectedTheme.primaryText, secondaryText: selectedTheme.secondaryText)
            MetricCardView(title: text.signalLabel, value: localizedSignal(info.signal), primaryText: selectedTheme.primaryText, secondaryText: selectedTheme.secondaryText)
        }
        .padding(.horizontal, contentInnerHorizontalPadding)
    }

    private func chartSection(info: StockResponse) -> some View {
        VStack(spacing: 12) {
            HStack {
                Spacer()
                Picker("", selection: $showCandle) {
                    Image(systemName: "chart.xyaxis.line").tag(false)
                    Image(systemName: "chart.bar.fill").tag(true)
                }
                .pickerStyle(.segmented)
                .frame(width: 110)
            }
            .padding(.horizontal, contentInnerHorizontalPadding)
            chartCard(info: info)
            periodButtons
        }
    }

    private var metricsSection: some View {
        VStack(spacing: 12) {
            AdaptiveMetricRowView(spacing: 12) {
                MetricCardView(title: text.openLabel, value: formattedNumber(viewModel.liveQuote?.openPrice), primaryText: selectedTheme.primaryText, secondaryText: selectedTheme.secondaryText)
                MetricCardView(title: text.todayHighLabel, value: formattedNumber(viewModel.liveQuote?.dayHigh), primaryText: selectedTheme.primaryText, secondaryText: selectedTheme.secondaryText)
                MetricCardView(title: text.todayLowLabel, value: formattedNumber(viewModel.liveQuote?.dayLow), primaryText: selectedTheme.primaryText, secondaryText: selectedTheme.secondaryText)
            }

            AdaptiveMetricRowView(spacing: 12) {
                MetricCardView(title: text.marketCapLabel, value: formattedMarketCap(viewModel.liveQuote?.marketCap), primaryText: selectedTheme.primaryText, secondaryText: selectedTheme.secondaryText)
                MetricCardView(title: text.fiftyTwoWeekHighLabel, value: formattedNumber(viewModel.liveQuote?.fiftyTwoWeekHigh), primaryText: selectedTheme.primaryText, secondaryText: selectedTheme.secondaryText)
                MetricCardView(title: text.fiftyTwoWeekLowLabel, value: formattedNumber(viewModel.liveQuote?.fiftyTwoWeekLow), primaryText: selectedTheme.primaryText, secondaryText: selectedTheme.secondaryText)
            }

            AdaptiveMetricRowView(spacing: 12) {
                MetricCardView(title: text.epsLabel, value: formattedEPS(viewModel.liveQuote?.eps), primaryText: selectedTheme.primaryText, secondaryText: selectedTheme.secondaryText)
                MetricCardView(title: text.peRatioLabel, value: formattedNumber(viewModel.liveQuote?.peRatio), primaryText: selectedTheme.primaryText, secondaryText: selectedTheme.secondaryText)
                MetricCardView(title: text.dividendYieldLabel, value: formattedPercent(viewModel.liveQuote?.dividendYield), primaryText: selectedTheme.primaryText, secondaryText: selectedTheme.secondaryText)
            }
        }
        .padding(.horizontal, contentInnerHorizontalPadding)
    }

    private var periodButtons: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(periodOptions) { option in
                    Button(option.title) {
                        viewModel.selectedPeriod = option.value
                        if viewModel.stockInfo != nil {
                            viewModel.refreshAllData(symbolOverride: nil, languageCode: selectedLanguage == .zh ? "zh" : "en")
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(viewModel.selectedPeriod == option.value ? Color.blue : selectedTheme.appBackground)
                    .foregroundColor(viewModel.selectedPeriod == option.value ? .white : selectedTheme.primaryText.opacity(0.9))
                    .cornerRadius(12)
                    .fontWeight(viewModel.selectedPeriod == option.value ? .bold : .regular)
                }
            }
            .padding(.horizontal, contentInnerHorizontalPadding)
        }
    }

    private var priceLabel: String {
        if isTaiwanSymbol {
            return text.latestPrice
        }

        switch viewModel.liveQuote?.session {
        case "pre": return text.preMarketPrice
        case "post": return text.postMarketPrice
        case "regular": return text.latestPrice
        default: return text.latestPrice
        }
    }

    private func chartTrendColor(for info: StockResponse) -> Color {
        if viewModel.selectedPeriod == "1d" {
            if let syncedChangeMetrics {
                return changeColor(syncedChangeMetrics.change)
            }
            if let change = viewModel.liveQuote?.change {
                return changeColor(change)
            }
            return .green
        }

        let sortedData = info.data.sorted { $0.parsedDate < $1.parsedDate }
        if let first = sortedData.first?.price,
           let last = sortedData.last?.price {
            return changeColor(last - first)
        }

        return .green
    }

    private func chartCard(info: StockResponse) -> some View {
        // 圖表優先用 /chart 的細間隔序列(需為同一股票、同一期間),還沒到就先畫 /stock 的每日資料
        let source: StockResponse = {
            if let c = viewModel.chartInfo, c.period == viewModel.selectedPeriod, c.stock.uppercased() == info.stock.uppercased() { return c }
            return info
        }()
        let chartPoints = mergedChartPoints(from: source)
        let trendColor = chartTrendColor(for: source)
        let isOneDay = viewModel.selectedPeriod == "1d"

        // 蠟燭資料(OHLC)
        let candles: [ChartCandle] = source.data.sorted { $0.parsedDate < $1.parsedDate }.enumerated().map { idx, d in
            ChartCandle(date: d.parsedDate,
                        label: d.chartLabel ?? String(idx),
                        open: d.open ?? d.price,
                        high: d.high ?? d.price,
                        low: d.low ?? d.price,
                        close: d.price,
                        volume: d.volume ?? 0)
        }

        // 基準虛線:1D 用昨收,其他期間用期初第一筆
        let baseline: Double? = isOneDay
            ? (viewModel.liveQuote?.previousClose ?? chartPoints.first?.price)
            : chartPoints.first?.price

        // x 軸格數:1D 固定整段交易時段(美股 78 根 5 分鐘、台股 54 根),其餘按資料筆數
        let dataCount = max(chartPoints.count, candles.count)
        let sessionSlots = isTaiwanSymbol ? 54 : 78
        let slotCount = isOneDay ? max(sessionSlots, dataCount) : dataCount

        // y 範圍:蠟燭用高低點,線圖用收盤(+基準線),上下各留 8%
        let lows = showCandle ? candles.map(\.low) : chartPoints.map(\.price)
        let highs = showCandle ? candles.map(\.high) : chartPoints.map(\.price)
        var allValues = lows + highs
        if !showCandle, let baseline { allValues.append(baseline) }
        let minValue = allValues.min() ?? 0
        let maxValue = allValues.max() ?? 1
        let padding = max((maxValue - minValue) * 0.08, 0.01)
        let yMin = max(0, minValue - padding)
        let yMax = maxValue + padding
        let livePoint = chartPoints.last(where: \.isLivePoint)

        return ChartCardView(
            chartPoints: chartPoints,
            selectedPeriod: viewModel.selectedPeriod,
            trendColor: trendColor,
            yMin: yMin,
            yMax: yMax,
            livePoint: livePoint,
            baseline: baseline,
            slotCount: slotCount,
            dividerColor: selectedTheme.divider,
            axisColor: selectedTheme.chartAxis,
            primaryColor: selectedTheme.primaryText,
            secondaryColor: selectedTheme.secondaryText,
            themeBackground: selectedTheme.appBackground,
            axisLabel: axisLabel(for:),
            tooltipLabel: tooltipLabel(for:),
            candles: candles,
            isCandle: showCandle,
            upColor: risingColor(),
            downColor: fallingColor()
        )
    }

    /// 十字線資訊列的日期格式(比軸標籤完整)。
    private func tooltipLabel(for date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = selectedLanguage == .zh ? Locale(identifier: "zh_TW") : Locale(identifier: "en_US")
        switch viewModel.selectedPeriod {
        case "1d": formatter.dateFormat = "HH:mm"
        case "5d": formatter.dateFormat = "M/d HH:mm"
        default: formatter.dateFormat = "yyyy/M/d"
        }
        return formatter.string(from: date)
    }

    private func mergedChartPoints(from info: StockResponse) -> [ChartPoint] {
        let sortedData = info.data.sorted { $0.parsedDate < $1.parsedDate }
        var points = sortedData.map {
            ChartPoint(
                date: $0.parsedDate,
                price: $0.price,
                ma5: $0.ma5,
                isLivePoint: false
            )
        }

        if isTaiwanSymbol {
            return points
        }

        guard let livePrice = preferredLivePrice,
              let lastPoint = points.last else {
            return points
        }

        let liveDate = liveDate(after: lastPoint.date)
        let lastMA5 = points.suffix(4).map(\.price)
        let liveMA5Base = lastMA5 + [livePrice]
        let liveMA5 = liveMA5Base.count >= 5 ? liveMA5Base.suffix(5).reduce(0, +) / 5 : nil

        if abs(lastPoint.price - livePrice) < 0.0001 {
            points[points.count - 1] = ChartPoint(
                date: lastPoint.date,
                price: livePrice,
                ma5: lastPoint.ma5,
                isLivePoint: true
            )
            return points
        }

        points.append(
            ChartPoint(
                date: liveDate,
                price: livePrice,
                ma5: liveMA5,
                isLivePoint: true
            )
        )

        return points
    }

    private func liveDate(after lastDate: Date) -> Date {
        switch viewModel.liveQuote?.session {
        case "pre", "post", "regular":
            return Date()
        default:
            switch viewModel.selectedPeriod {
            case "1d": return lastDate.addingTimeInterval(60 * 5)
            case "5d": return lastDate.addingTimeInterval(60 * 30)
            case "5y": return lastDate.addingTimeInterval(60 * 60 * 24 * 7)
            default: return lastDate.addingTimeInterval(60 * 60 * 24)
            }
        }
    }

    private func historyListCard(info: StockResponse) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isHistoryExpanded.toggle()
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: isHistoryExpanded ? "chevron.down" : "chevron.right")
                        .foregroundColor(selectedTheme.secondaryText)

                    Text(text.historyTitle)
                        .font(.headline)
                        .foregroundColor(selectedTheme.primaryText)

                    Spacer()
                }
            }

            if isHistoryExpanded {
                LazyVStack(spacing: 0) {
                    ForEach(Array(info.data.dropLast()).reversed()) { item in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(shortDate(item.date))
                                    .font(.headline)
                                    .foregroundColor(selectedTheme.primaryText)

                                if let ma = item.ma5 {
                                    Text("\(text.maLabel): \(String(format: "%.2f", ma))")
                                        .font(.caption)
                                        .foregroundColor(selectedTheme.secondaryText)
                                } else {
                                    Text("\(text.maLabel): -")
                                        .font(.caption)
                                        .foregroundColor(selectedTheme.secondaryText)
                                }
                            }

                            Spacer()

                            Text("$\(String(format: "%.2f", item.price))")
                                .font(.title3)
                                .fontWeight(.bold)
                                .foregroundColor(priceColor(for: item))
                        }
                        .padding(.vertical, 14)

                        Divider().overlay(selectedTheme.divider)
                    }
                }
            }
        }
        .padding()
        .background(selectedTheme.appBackground)
    }

    private var newsCard: some View {
        NewsCardView(
            title: text.newsTitle,
            isLoading: viewModel.newsLoading,
            emptyText: text.newsEmptyText,
            items: viewModel.newsItems,
            isExpanded: isNewsExpanded,
            moreButton: text.moreButton,
            lessButton: text.lessButton,
            theme: selectedTheme,
            newsDateText: newsDateText,
            onToggleExpanded: {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isNewsExpanded.toggle()
                }
            },
            isZh: selectedLanguage == .zh,
            digest: viewModel.newsDigest,
            digestLoading: viewModel.newsDigestLoading,
            onDigest: {
                Task { await viewModel.fetchNewsDigest(languageCode: selectedLanguage == .zh ? "zh" : "en") }
            }
        )
    }

    private var ratingsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(selectedLanguage == .zh ? "分析師評等" : "Analyst Ratings")
                .font(.headline)
                .foregroundColor(selectedTheme.primaryText)

            if let ratings = viewModel.ratings, ratings.total > 0 {
                let buyTotal = ratings.strongBuy + ratings.buy
                let holdTotal = ratings.hold
                let sellTotal = ratings.sell + ratings.strongSell
                let buyPct = Int(round((Double(buyTotal) / Double(ratings.total)) * 100))
                let holdPct = Int(round((Double(holdTotal) / Double(ratings.total)) * 100))
                let sellPct = Int(round((Double(sellTotal) / Double(ratings.total)) * 100))

                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .center, spacing: 18) {
                        ZStack {
                            Circle()
                                .stroke(selectedTheme.divider, lineWidth: 12)
                                .frame(width: 92, height: 92)

                            Circle()
                                .trim(from: 0, to: CGFloat(buyPct) / 100)
                                .stroke(Color.green, style: StrokeStyle(lineWidth: 12, lineCap: .round))
                                .rotationEffect(.degrees(-90))
                                .frame(width: 92, height: 92)

                            VStack(spacing: 2) {
                                Text("\(buyPct)%")
                                    .font(.title3)
                                    .fontWeight(.bold)
                                    .foregroundColor(selectedTheme.primaryText)
                                    .minimumScaleFactor(0.5)
                                Text(selectedLanguage == .zh ? "買進" : "Buy")
                                    .font(.caption)
                                    .foregroundColor(selectedTheme.secondaryText)
                            }
                        }

                        VStack(alignment: .leading, spacing: 12) {
                            RatingBarView(label: selectedLanguage == .zh ? "買進" : "Buy", percent: buyPct, color: .green, primaryText: selectedTheme.primaryText, secondaryText: selectedTheme.secondaryText, divider: selectedTheme.divider)
                            RatingBarView(label: selectedLanguage == .zh ? "持有" : "Hold", percent: holdPct, color: .orange, primaryText: selectedTheme.primaryText, secondaryText: selectedTheme.secondaryText, divider: selectedTheme.divider)
                            RatingBarView(label: selectedLanguage == .zh ? "賣出" : "Sell", percent: sellPct, color: .red, primaryText: selectedTheme.primaryText, secondaryText: selectedTheme.secondaryText, divider: selectedTheme.divider)
                        }
                    }

                    VStack(alignment: .leading, spacing: 16) {
                        ZStack {
                            Circle()
                                .stroke(selectedTheme.divider, lineWidth: 12)
                                .frame(width: 92, height: 92)

                            Circle()
                                .trim(from: 0, to: CGFloat(buyPct) / 100)
                                .stroke(Color.green, style: StrokeStyle(lineWidth: 12, lineCap: .round))
                                .rotationEffect(.degrees(-90))
                                .frame(width: 92, height: 92)

                            VStack(spacing: 2) {
                                Text("\(buyPct)%")
                                    .font(.title3)
                                    .fontWeight(.bold)
                                    .foregroundColor(selectedTheme.primaryText)
                                    .minimumScaleFactor(0.5)
                                Text(selectedLanguage == .zh ? "買進" : "Buy")
                                    .font(.caption)
                                    .foregroundColor(selectedTheme.secondaryText)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .center)

                        VStack(alignment: .leading, spacing: 12) {
                            RatingBarView(label: selectedLanguage == .zh ? "買進" : "Buy", percent: buyPct, color: .green, primaryText: selectedTheme.primaryText, secondaryText: selectedTheme.secondaryText, divider: selectedTheme.divider)
                            RatingBarView(label: selectedLanguage == .zh ? "持有" : "Hold", percent: holdPct, color: .orange, primaryText: selectedTheme.primaryText, secondaryText: selectedTheme.secondaryText, divider: selectedTheme.divider)
                            RatingBarView(label: selectedLanguage == .zh ? "賣出" : "Sell", percent: sellPct, color: .red, primaryText: selectedTheme.primaryText, secondaryText: selectedTheme.secondaryText, divider: selectedTheme.divider)
                        }
                    }
                }

                Text("\(ratings.total) \(selectedLanguage == .zh ? "位分析師" : "analysts")")
                    .font(.caption)
                    .foregroundColor(selectedTheme.secondaryText)
            } else {
                Text(selectedLanguage == .zh ? "目前沒有分析師評等資料" : "No analyst viewModel.ratings available")
                    .font(.subheadline)
                    .foregroundColor(selectedTheme.secondaryText)
            }
        }
        .padding()
        .background(selectedTheme.appBackground)
    }

    private var valuationCard: some View {
        let valuation = viewModel.valuation
        return ValuationCardView(
            title: selectedLanguage == .zh ? "估值模型" : "Valuation Model",
            theme: selectedTheme,
            selectedLanguage: selectedLanguage,
            valuation: valuation,
            currentPrice: syncedDisplayPrice ?? valuation?.currentPrice ?? 0,
            selectedScenarioId: viewModel.selectedValuationScenario,
            onScenarioChange: { viewModel.selectedValuationScenario = $0 },
            formattedCompactNumber: formattedCompactNumber,
            currencyPrice: currencyPrice,
            percentText: percentText,
            multipleText: multipleText,
            industryBucketText: industryBucketText,
            expectedReturnColor: expectedReturnColor
        )
    }

    private func shortDate(_ date: String) -> String {
        guard let parsedDate = StockDateParser.parse(date) else { return date }
        return axisLabel(for: parsedDate)
    }


    private func newsDateText(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = selectedLanguage == .zh ? Locale(identifier: "zh_TW") : Locale(identifier: "en_US")
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }


    private func axisLabel(for date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = selectedLanguage == .zh ? Locale(identifier: "zh_TW") : Locale(identifier: "en_US")

        switch viewModel.selectedPeriod {
        case "1d":
            formatter.dateFormat = "HH:mm"
        case "5d":
            formatter.dateFormat = "M/d"
        case "1mo", "3mo", "6mo", "ytd":
            formatter.dateFormat = "M/d"
        case "1y", "5y":
            formatter.dateFormat = "yy/M"
        default:
            formatter.dateFormat = "M/d"
        }

        return formatter.string(from: date)
    }


    private func formattedNumber(_ value: Double?) -> String {
        guard let value else { return "-" }
        return String(format: "%.2f", value)
    }

    private func formattedEPS(_ value: Double?) -> String {
        guard let value else { return "-" }
        if abs(value) >= 100 {
            return String(format: "%.1f", value)
        }
        if abs(value) >= 10 {
            return String(format: "%.2f", value)
        }
        if abs(value) >= 1 {
            return String(format: "%.3f", value)
        }
        return String(format: "%.4f", value)
    }


    private func formattedPercent(_ value: Double?) -> String {
        guard let value else { return "-" }
        return String(format: "%.2f%%", value)
    }


    private func formattedSurprise(_ value: Double?) -> String {
        guard let value else { return "-" }
        let sign = value >= 0 ? "+" : ""
        return "\(sign)\(String(format: "%.2f", value))%"
    }


    private func surpriseColor(_ value: Double?) -> Color {
        guard let value else { return selectedTheme.secondaryText }
        if value > 0 { return .green }
        if value < 0 { return .red }
        return selectedTheme.secondaryText
    }


    private func yOffset(for value: Double, min: Double, range: Double) -> CGFloat {
        let normalized = (value - min) / range
        return CGFloat((1 - normalized) * 64 - 32)
    }


    private var earningsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(selectedLanguage == .zh ? "財報" : "Earnings")
                .font(.headline)
                .foregroundColor(selectedTheme.primaryText)

            if viewModel.earningsItems.isEmpty {
                Text(selectedLanguage == .zh ? "目前沒有 EPS 資料" : "No EPS data available")
                    .font(.subheadline)
                    .foregroundColor(selectedTheme.secondaryText)
            } else {
                let values = viewModel.earningsItems.flatMap { [$0.estimate, $0.actual].compactMap { $0 } }
                let minValue = values.min() ?? 0
                let maxValue = values.max() ?? 1
                let range = max(maxValue - minValue, 0.01)

                HStack(alignment: .bottom, spacing: 20) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(String(format: "%.2f", maxValue))
                            .font(.caption2)
                            .foregroundColor(selectedTheme.secondaryText)
                            .frame(height: 24, alignment: .top)

                        Text(String(format: "%.2f", minValue + (range / 2)))
                            .font(.caption2)
                            .foregroundColor(selectedTheme.secondaryText)
                            .frame(maxHeight: .infinity)

                        Text(String(format: "%.2f", minValue))
                            .font(.caption2)
                            .foregroundColor(selectedTheme.secondaryText)
                            .frame(height: 24, alignment: .bottom)
                    }
                    .frame(width: 30, height: 120, alignment: .leading)

                    Spacer()
                        .frame(width: 0)

                    HStack(alignment: .bottom, spacing: 0) {
                        ForEach(Array(viewModel.earningsItems.reversed()), id: \.id) { item in
                            VStack(spacing: 8) {
                                ZStack {
                                    if let estimate = item.estimate {
                                        Circle()
                                            .fill(Color.green.opacity(0.28))
                                            .frame(width: 16, height: 16)
                                            .offset(y: yOffset(for: estimate, min: minValue, range: range))
                                    }
                                    if let actual = item.actual {
                                        Circle()
                                            .fill(Color.green)
                                            .frame(width: 16, height: 16)
                                            .offset(y: yOffset(for: actual, min: minValue, range: range))
                                    }
                                }
                                .frame(width: 26, height: 96)

                                VStack(spacing: 1) {
                                    Text(item.quarter)
                                        .font(.caption)
                                        .foregroundColor(selectedTheme.primaryText)
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.85)
                                    if let fiscalYear = item.fiscalYear {
                                        Text(fiscalYear)
                                            .font(.caption2)
                                            .foregroundColor(selectedTheme.secondaryText)
                                            .lineLimit(1)
                                            .minimumScaleFactor(0.85)
                                    }
                                }
                                .frame(maxWidth: .infinity)
                            }
                            .frame(maxWidth: .infinity)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 16) {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 6) {
                                Text(selectedLanguage == .zh ? "預估 EPS" : "Estimated EPS")
                                    .font(.caption)
                                    .foregroundColor(selectedTheme.secondaryText)
                                    .fixedSize(horizontal: false, vertical: true)
                                Circle()
                                    .fill(Color.green.opacity(0.28))
                                    .frame(width: 12, height: 12)
                            }
                            Text(formattedNumber(viewModel.earningsItems.first?.estimate ?? viewModel.earningsItems.last?.estimate))
                                .font(.title3)
                                .fontWeight(.bold)
                                .foregroundColor(selectedTheme.primaryText)
                                .minimumScaleFactor(0.5)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)

                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 6) {
                                Text(selectedLanguage == .zh ? "實際 EPS / 下次財報" : "Actual EPS / Next Earnings")
                                    .font(.caption)
                                    .foregroundColor(selectedTheme.secondaryText)
                                    .fixedSize(horizontal: false, vertical: true)
                                Circle()
                                    .fill(Color.green)
                                    .frame(width: 12, height: 12)
                            }
                            if let nextEarningsDateText = viewModel.nextEarningsDateText {
                                Text(nextEarningsDisplayText(nextEarningsDateText))
                                    .font(.body)
                                    .fontWeight(.semibold)
                                    .foregroundColor(selectedTheme.primaryText)
                                    .fixedSize(horizontal: false, vertical: true)
                                if let nextEarningsTiming = viewModel.nextEarningsTiming {
                                    Text(localizedEarningsTiming(nextEarningsTiming))
                                        .font(.caption)
                                        .foregroundColor(selectedTheme.secondaryText)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            } else {
                                Text(formattedNumber(viewModel.earningsItems.last?.actual))
                                    .font(.title3)
                                    .fontWeight(.bold)
                                    .foregroundColor(selectedTheme.primaryText)
                                    .minimumScaleFactor(0.5)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 6) {
                                Text(selectedLanguage == .zh ? "預估 EPS" : "Estimated EPS")
                                    .font(.caption)
                                    .foregroundColor(selectedTheme.secondaryText)
                                    .fixedSize(horizontal: false, vertical: true)
                                Circle()
                                    .fill(Color.green.opacity(0.28))
                                    .frame(width: 12, height: 12)
                            }
                            Text(formattedNumber(viewModel.earningsItems.first?.estimate ?? viewModel.earningsItems.last?.estimate))
                                .font(.title3)
                                .fontWeight(.bold)
                                .foregroundColor(selectedTheme.primaryText)
                                .minimumScaleFactor(0.5)
                        }

                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 6) {
                                Text(selectedLanguage == .zh ? "實際 EPS / 下次財報" : "Actual EPS / Next Earnings")
                                    .font(.caption)
                                    .foregroundColor(selectedTheme.secondaryText)
                                    .fixedSize(horizontal: false, vertical: true)
                                Circle()
                                    .fill(Color.green)
                                    .frame(width: 12, height: 12)
                            }
                            if let nextEarningsDateText = viewModel.nextEarningsDateText {
                                Text(nextEarningsDisplayText(nextEarningsDateText))
                                    .font(.body)
                                    .fontWeight(.semibold)
                                    .foregroundColor(selectedTheme.primaryText)
                                    .fixedSize(horizontal: false, vertical: true)
                                if let nextEarningsTiming = viewModel.nextEarningsTiming {
                                    Text(localizedEarningsTiming(nextEarningsTiming))
                                        .font(.caption)
                                        .foregroundColor(selectedTheme.secondaryText)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            } else {
                                Text(formattedNumber(viewModel.earningsItems.last?.actual))
                                    .font(.title3)
                                    .fontWeight(.bold)
                                    .foregroundColor(selectedTheme.primaryText)
                                    .minimumScaleFactor(0.5)
                            }
                        }
                    }
                }

                if showLegacyAIPrediction && (viewModel.llmTomorrow != nil || viewModel.aiAnalysis != nil || viewModel.isLLMTomorrowLoading) {
                    Divider().overlay(selectedTheme.divider)
                        .padding(.top, 4)

                    VStack(alignment: .leading, spacing: 12) {
                        if let llmTomorrow = viewModel.llmTomorrow,
                           llmTomorrow.stock.uppercased() == currentResolvedSymbol.uppercased() {
                            aiComprehensiveAnalysisCard(llmTomorrow: llmTomorrow, aiAnalysis: viewModel.aiAnalysis)
                        } else if let aiAnalysis = viewModel.aiAnalysis {
                            aiAnalysisOnlyCard(aiAnalysis)
                        } else if viewModel.isLLMTomorrowLoading {
                            Text(llmLoadingText)
                                .font(.subheadline)
                                .foregroundColor(.blue)
                        }
                    }
                }
            }
        }
        .padding()
        .background(selectedTheme.appBackground)
    }


    private func aiComprehensiveAnalysisCard(llmTomorrow: LLMTomorrowResponse, aiAnalysis: AIAnalysisResponse?) -> some View {
        let technicalItems = aiTechnicalItems(from: aiAnalysis) ?? technicalHighlights(from: llmTomorrow)
        let sentimentItems = aiAnalysis?.sentiment.items ?? sentimentHighlights(from: llmTomorrow)
        let watchItems = aiAnalysis?.watchPoints ?? watchHighlights(from: llmTomorrow)
        let lowTarget = aiAnalysis?.predictedLow ?? llmTomorrow.predictedLow
        let highTarget = aiAnalysis?.predictedHigh ?? llmTomorrow.predictedHigh
        let lowPriceText = currencyPrice(lowTarget)
        let highPriceText = currencyPrice(highTarget)
        let sentimentKey = aiAnalysis?.sentiment.label ?? llmTomorrow.newsImpact
        let sentimentLabel = plainSentimentLabel(sentimentKey)
        let sentimentIndicatorColor = newsImpactColor(sentimentKey)
        let displayedBias = aiAnalysis?.action ?? llmTomorrow.bias
        let biasText = plainBiasText(displayedBias)
        let lowPercent = projectedMoveText(target: lowTarget)
        let highPercent = projectedMoveText(target: highTarget)
        let rangeProgress = rangeProgress(low: lowTarget, high: highTarget)
        let currentPriceText = currencyPrice(syncedDisplayPrice ?? viewModel.liveQuote?.regularPrice ?? viewModel.liveQuote?.displayPrice ?? viewModel.liveQuote?.price)
        let isOutOfRange = isOutOfRange(low: lowTarget, high: highTarget)
        let confidence = aiAnalysis?.confidence ?? llmTomorrow.confidence

        return AIComprehensiveAnalysisView(
            title: selectedLanguage == .zh ? "AI 智能判斷" : "AI Analysis",
            isEnglish: selectedLanguage == .en,
            bullishColor: risingColor(),
            bearishColor: fallingColor(),
            confidence: confidence.capitalized,
            confidenceSegments: llmConfidenceSegments(confidence),
            lowPriceText: lowPriceText,
            lowPercentText: lowPercent,
            lowPercentColor: projectedMoveColor(target: lowTarget),
            highPriceText: highPriceText,
            highPercentText: highPercent,
            highPercentColor: projectedMoveColor(target: highTarget),
            rangeProgress: rangeProgress,
            currentPriceText: currentPriceText,
            isOutOfRange: isOutOfRange,
            biasText: biasText,
            biasColor: llmBiasColor(displayedBias),
            technicalItems: technicalItems,
            sentimentLabel: sentimentLabel,
            sentimentIndicatorColor: sentimentIndicatorColor,
            sentimentItems: sentimentItems,
            watchItems: watchItems,
            theme: selectedTheme
        )
    }

    private func aiAnalysisOnlyCard(_ aiAnalysis: AIAnalysisResponse) -> some View {
        let lowTarget = aiAnalysis.predictedLow
        let highTarget = aiAnalysis.predictedHigh
        let lowPriceText = currencyPrice(lowTarget)
        let highPriceText = currencyPrice(highTarget)
        let sentimentLabel = plainSentimentLabel(aiAnalysis.sentiment.label)
        let sentimentIndicatorColor = newsImpactColor(aiAnalysis.sentiment.label)
        let biasText = plainBiasText(aiAnalysis.action)
        let rangeProgress = rangeProgress(low: lowTarget, high: highTarget)
        let currentPriceText = currencyPrice(syncedDisplayPrice ?? viewModel.liveQuote?.regularPrice ?? viewModel.liveQuote?.displayPrice ?? viewModel.liveQuote?.price)
        let isOutOfRange = isOutOfRange(low: lowTarget, high: highTarget)
        let lowPercent = projectedMoveText(target: lowTarget)
        let highPercent = projectedMoveText(target: highTarget)

        return AIComprehensiveAnalysisView(
            title: selectedLanguage == .zh ? "AI 智能判斷" : "AI Analysis",
            isEnglish: selectedLanguage == .en,
            bullishColor: risingColor(),
            bearishColor: fallingColor(),
            confidence: aiAnalysis.confidence.capitalized,
            confidenceSegments: llmConfidenceSegments(aiAnalysis.confidence),
            lowPriceText: lowPriceText,
            lowPercentText: lowPercent,
            lowPercentColor: projectedMoveColor(target: lowTarget),
            highPriceText: highPriceText,
            highPercentText: highPercent,
            highPercentColor: projectedMoveColor(target: highTarget),
            rangeProgress: rangeProgress,
            currentPriceText: currentPriceText,
            isOutOfRange: isOutOfRange,
            biasText: biasText,
            biasColor: llmBiasColor(aiAnalysis.action),
            technicalItems: aiTechnicalItems(from: aiAnalysis) ?? aiAnalysis.technical,
            sentimentLabel: sentimentLabel,
            sentimentIndicatorColor: sentimentIndicatorColor,
            sentimentItems: aiAnalysis.sentiment.items,
            watchItems: aiAnalysis.watchPoints,
            theme: selectedTheme
        )
    }

    private func aiTechnicalItems(from aiAnalysis: AIAnalysisResponse?) -> [String]? {
        guard let aiAnalysis else { return nil }
        return Array(aiAnalysis.technical.prefix(4))
    }

    private func aiAction(from llmTomorrow: LLMTomorrowResponse) -> String {
        let bias = llmTomorrow.bias.lowercased()
        let news = llmTomorrow.newsImpact.lowercased()
        let confidence = llmTomorrow.confidence.lowercased()

        if bias.contains("up") || bias.contains("bull") || news.contains("positive") {
            return confidence == "high" ? "Buy" : "NotBuy"
        }
        return "NotBuy"
    }

    private func aiSummary(from llmTomorrow: LLMTomorrowResponse, action: String) -> String {
        switch action {
        case "Buy":
            return selectedLanguage == .zh ? "模型判斷達到 Buy 條件，屬於建議買進訊號。" : "The model detects a Buy setup and marks it as a buy recommendation."
        default:
            return selectedLanguage == .zh ? "模型尚未判斷達到 Buy 條件，歸類為觀望。" : "The model does not detect a Buy setup yet, so it is classified as NotBuy."
        }
    }

    private func technicalHighlights(from llmTomorrow: LLMTomorrowResponse) -> [String] {
        let base = llmTomorrow.summary.lowercased()
        var items: [String] = []
        if base.contains("rsi") { items.append(selectedLanguage == .zh ? "RSI 顯示短線動能有壓力" : "RSI suggests short-term momentum pressure") }
        if base.contains("mfi") || base.contains("flow") { items.append(selectedLanguage == .zh ? "資金動能變弱或有流出跡象" : "Money flow looks weaker or shows outflow signs") }
        if base.contains("weak") || base.contains("轉弱") { items.append(selectedLanguage == .zh ? "短線動能轉弱" : "Short-term momentum is weakening") }
        if items.isEmpty {
            let fallback = sanitizeLLMText(llmTomorrow.summary)
            if !fallback.isEmpty { items.append(fallback) }
        }
        if items.isEmpty {
            items.append(selectedLanguage == .zh ? "技術面暫無明確補充訊號" : "No additional technical highlight available")
        }
        return Array(items.prefix(3))
    }

    private func sentimentHighlights(from llmTomorrow: LLMTomorrowResponse) -> [String] {
        let parts = llmTomorrow.newsSummary
            .split(whereSeparator: { ".。；;\n".contains($0) })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .map(sanitizeLLMText)
            .filter { !$0.isEmpty }
        if parts.isEmpty {
            return [selectedLanguage == .zh ? "目前新聞面沒有明顯額外優勢" : "No strong additional edge from news right now"]
        }
        return Array(parts.prefix(2))
    }

    private func watchHighlights(from llmTomorrow: LLMTomorrowResponse) -> [String] {
        if aiAction(from: llmTomorrow) == "NotBuy" {
            return selectedLanguage == .zh
                ? ["是否站回 5MA / VWAP", "量能是否回升", "族群是否止跌轉強"]
                : ["Whether price reclaims 5MA / VWAP", "Whether volume recovers", "Whether the sector stabilizes"]
        }
        return selectedLanguage == .zh
            ? ["是否突破預測區間上緣", "量價是否同步放大", "新聞情緒是否延續"]
            : ["Whether price breaks above the projected range", "Whether price and volume expand together", "Whether news sentiment continues"]
    }

    private func sanitizeLLMText(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        let lower = trimmed.lowercased()
        let currentSymbol = currentResolvedSymbol.lowercased()
        let companyName = (viewModel.liveQuote?.companyName ?? "").lowercased()

        if currentSymbol.contains("mrvl") || companyName.contains("marvell") {
            let forbidden = ["美信", "美信科技", "美信集成電路", "maxim", "mxim"]
            if forbidden.contains(where: { lower.contains($0) }) {
                return ""
            }
        }

        let foreignReferences: [(tokens: [String], matchCurrent: Bool)] = [
            (["micron", "美光", "mu"], currentSymbol.contains("mu") || companyName.contains("micron") || companyName.contains("美光")),
            (["maxim", "mxim", "美信", "美信科技", "美信集成電路"], currentSymbol.contains("mxim") || companyName.contains("maxim") || companyName.contains("美信")),
            (["nvidia", "輝達", "nvda"], currentSymbol.contains("nvda") || companyName.contains("nvidia") || companyName.contains("輝達")),
            (["marvell", "mrvl"], currentSymbol.contains("mrvl") || companyName.contains("marvell")),
            (["broadcom", "博通", "avgo"], currentSymbol.contains("avgo") || companyName.contains("broadcom") || companyName.contains("博通")),
            (["amd", "超微"], currentSymbol == "amd" || companyName.contains("amd") || companyName.contains("超微")),
            (["intel", "英特爾", "intc"], currentSymbol.contains("intc") || companyName.contains("intel") || companyName.contains("英特爾"))
        ]

        for entry in foreignReferences where !entry.matchCurrent {
            if entry.tokens.contains(where: { lower.contains($0) }) {
                return ""
            }
        }
        return trimmed
    }

    private func llmBiasColor(_ bias: String) -> Color {
        switch bias.lowercased() {
        case "up", "bullish", "positive", "buy":
            return risingColor()
        case "down", "bearish", "negative":
            return fallingColor()
        case "avoid", "sell", "wait", "notbuy", "not_buy", "not buy":
            return .yellow
        default:
            return selectedTheme.primaryText.opacity(0.9)
        }
    }

    private func newsImpactColor(_ impact: String) -> Color {
        switch impact.lowercased() {
        case "positive", "bullish":
            return Color(red: 0.42, green: 1.0, blue: 0.62)
        case "negative", "bearish":
            return Color(red: 1.0, green: 0.36, blue: 0.46)
        default:
            return .yellow
        }
    }

    private func newsImpactDisplayText(_ impact: String) -> String {
        switch impact.lowercased() {
        case "positive", "bullish":
            return selectedLanguage == .zh ? "🟢 偏多" : "🟢 Positive"
        case "negative", "bearish":
            return selectedLanguage == .zh ? "🔴 偏空" : "🔴 Negative"
        default:
            return selectedLanguage == .zh ? "⚪ 中性" : "⚪ Neutral"
        }
    }

    private func llmBiasDisplayText(_ bias: String) -> String {
        switch bias.lowercased() {
        case "up", "bullish", "positive", "buy":
            return selectedLanguage == .zh ? "建議買" : "Buy"
        case "down", "bearish", "negative", "avoid", "sell", "wait", "notbuy", "not_buy", "not buy":
            return selectedLanguage == .zh ? "觀望" : "NotBuy"
        default:
            return selectedLanguage == .zh ? "觀望" : "NotBuy"
        }
    }

    private func plainBiasText(_ bias: String) -> String {
        switch bias.lowercased() {
        case "up", "bullish", "positive", "buy":
            return selectedLanguage == .zh ? "建議買" : "Buy"
        case "down", "bearish", "negative", "avoid", "sell", "wait", "notbuy", "not_buy", "not buy":
            return selectedLanguage == .zh ? "觀望" : "NotBuy"
        default:
            return selectedLanguage == .zh ? "觀望" : "NotBuy"
        }
    }

    private func plainSentimentLabel(_ impact: String) -> String {
        switch impact.lowercased() {
        case "positive", "bullish":
            return selectedLanguage == .zh ? "偏多" : "Positive"
        case "negative", "bearish":
            return selectedLanguage == .zh ? "偏空" : "Negative"
        default:
            return selectedLanguage == .zh ? "中性" : "Neutral"
        }
    }

    private func projectedMoveText(target: Double?) -> String? {
        guard let target,
              let ref = syncedDisplayPrice ?? viewModel.liveQuote?.regularPrice ?? viewModel.liveQuote?.displayPrice ?? viewModel.liveQuote?.price,
              ref != 0 else { return nil }
        let pct = ((target - ref) / ref) * 100
        return String(format: "%+.1f%%", pct)
    }

    private func projectedMoveColor(target: Double?) -> Color {
        guard let target,
              let ref = syncedDisplayPrice ?? viewModel.liveQuote?.regularPrice ?? viewModel.liveQuote?.displayPrice ?? viewModel.liveQuote?.price else {
            return selectedTheme.secondaryText
        }
        return changeColor(target - ref)
    }

    private func rangeProgress(low: Double?, high: Double?) -> Double? {
        guard let low,
              let high,
              high > low,
              let ref = syncedDisplayPrice ?? viewModel.liveQuote?.regularPrice ?? viewModel.liveQuote?.displayPrice ?? viewModel.liveQuote?.price else {
            return nil
        }
        return min(max((ref - low) / (high - low), 0), 1)
    }

    private func isOutOfRange(low: Double?, high: Double?) -> Bool {
        guard let low,
              let high,
              let ref = syncedDisplayPrice ?? viewModel.liveQuote?.regularPrice ?? viewModel.liveQuote?.displayPrice ?? viewModel.liveQuote?.price else {
            return false
        }
        return ref < low || ref > high
    }

    private func llmConfidenceSegments(_ confidence: String) -> Int {
        switch confidence.lowercased() {
        case "high": return 3
        case "medium": return 2
        default: return 1
        }
    }

    private func llmConfidenceBar(_ confidence: String) -> some View {
        let active = llmConfidenceSegments(confidence)
        return HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { index in
                RoundedRectangle(cornerRadius: 3)
                    .fill(index < active ? Color.blue : selectedTheme.divider.opacity(0.8))
                    .frame(height: 6)
            }
        }
    }

    private func relativeMoveText(target: Double?, reference: Double?) -> String {
        guard let target, let reference, reference != 0 else { return "--" }
        let pct = ((target - reference) / reference) * 100
        return String(format: "%+.1f%%", pct)
    }

    private func llmAccentColor(_ base: Color, emphasis: String) -> Color {
        if selectedTheme == .dark {
            if emphasis == "up" {
                return Color(red: 0.42, green: 1.0, blue: 0.62)
            }
            if emphasis == "down" {
                return Color(red: 1.0, green: 0.36, blue: 0.46)
            }
        }
        return base
    }

    private func llmRangeMetricCard(title: String, value: String, percentText: String, accent: Color, emphasis: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption2)
                .foregroundColor(selectedTheme.secondaryText)
            Text(value)
                .font(.subheadline)
                .fontWeight(.semibold)
                .foregroundColor(selectedTheme.primaryText)
            Text(percentText)
                .font(.caption2)
                .foregroundColor(llmAccentColor(accent, emphasis: emphasis))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .background(selectedTheme.divider.opacity(0.65))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func nextEarningsDisplayText(_ raw: String) -> String {
        if let date = StockDateParser.parse(raw) {
            let formatter = DateFormatter()
            formatter.locale = selectedLanguage == .zh ? Locale(identifier: "zh_TW") : Locale(identifier: "en_US")
            formatter.dateFormat = selectedLanguage == .zh ? "M/d" : "M/d"
            return selectedLanguage == .zh ? "預計於 \(formatter.string(from: date))" : "Expected on \(formatter.string(from: date))"
        }
        return raw
    }

    private func localizedEarningsTiming(_ value: String) -> String {
        switch value {
        case "after-hours":
            return selectedLanguage == .zh ? "盤後公布" : "After-hours"
        case "before-open":
            return selectedLanguage == .zh ? "開盤前公布" : "Before open"
        default:
            return value
        }
    }

    private func formattedMarketCap(_ value: Double?) -> String {
        guard let value else { return "-" }

        let trillion = 1_000_000_000_000.0
        let billion = 1_000_000_000.0
        let million = 1_000_000.0

        if value >= trillion { return String(format: "%.2fT", value / trillion) }
        if value >= billion { return String(format: "%.2fB", value / billion) }
        if value >= million { return String(format: "%.2fM", value / million) }

        return String(format: "%.0f", value)
    }

    private var isUSStyleMarket: Bool {
        marketColorMode == .us
    }

    private func risingColor() -> Color { isUSStyleMarket ? .green : .red }
    private func fallingColor() -> Color { isUSStyleMarket ? .red : .green }
    private func changeColor(_ change: Double) -> Color { change >= 0 ? risingColor() : fallingColor() }

    private func priceColor(for item: StockData) -> Color {
        if let previousClose = viewModel.liveQuote?.previousClose {
            let delta = item.price - previousClose
            if delta > 0 { return risingColor() }
            if delta < 0 { return fallingColor() }
        }
        return selectedTheme.primaryText
    }

    private var preferredLivePrice: Double? {
        switch viewModel.liveQuote?.session {
        case "pre", "post":
            return viewModel.liveQuote?.extendedPrice ?? viewModel.liveQuote?.displayPrice ?? viewModel.liveQuote?.price
        case "regular":
            return viewModel.liveQuote?.regularPrice ?? viewModel.liveQuote?.displayPrice ?? viewModel.liveQuote?.price
        default:
            return viewModel.liveQuote?.displayPrice ?? viewModel.liveQuote?.extendedPrice ?? viewModel.liveQuote?.regularPrice ?? viewModel.liveQuote?.price
        }
    }

    private var syncedChangeMetrics: (change: Double, percent: Double)? {
        guard let latestPrice = syncedDisplayPrice,
              let previousClose = viewModel.liveQuote?.previousClose,
              previousClose != 0 else {
            return nil
        }

        let change = latestPrice - previousClose
        let percent = (change / previousClose) * 100
        return (change, percent)
    }

    private func quotePriceColor(info: StockResponse) -> Color {
        if let syncedChangeMetrics { return changeColor(syncedChangeMetrics.change) }
        if let change = viewModel.liveQuote?.change { return changeColor(change) }
        if let lastHistory = info.data.last { return priceColor(for: lastHistory) }
        return selectedTheme.primaryText
    }

    private func changeText(change: Double, percent: Double) -> String {
        let sign = change >= 0 ? "+" : ""
        return "\(sign)\(String(format: "%.2f", change)) (\(sign)\(String(format: "%.2f", percent))%)"
    }

    private func currencyPrice(_ value: Double?) -> String {
        guard let value else { return "-" }
        return "$\(String(format: "%.2f", value))"
    }

    private func percentText(_ value: Double?) -> String {
        guard let value else { return "-" }
        return "\(String(format: "%+.1f", value * 100))%"
    }

    private func expectedReturnColor(_ value: Double?) -> Color {
        guard let value else { return selectedTheme.secondaryText }
        return changeColor(value)
    }

    private func formattedCompactNumber(_ value: Double?) -> String {
        guard let value else { return "-" }
        if abs(value) >= 100 {
            return String(format: "%.0f", value)
        }
        if abs(value) >= 10 {
            return String(format: "%.1f", value)
        }
        return String(format: "%.2f", value)
    }

    private func multipleText(_ value: Double?) -> String {
        guard let value else { return "-" }
        return "\(String(format: "%.0f", value))x"
    }

    private func industryBucketText(_ value: String?) -> String {
        switch value {
        case "food": return selectedLanguage == .zh ? "食品" : "Food"
        case "high_end_pcb": return selectedLanguage == .zh ? "衛星通訊" : "Satellite Comms"
        case "electronic_components": return selectedLanguage == .zh ? "電子零組件" : "Electronic Components"
        case "semiconductors": return selectedLanguage == .zh ? "半導體" : "Semiconductors"
        case "shipping": return selectedLanguage == .zh ? "航運" : "Shipping"
        case "building_materials": return selectedLanguage == .zh ? "建材玻璃" : "Building Materials"
        case "chemicals_materials": return selectedLanguage == .zh ? "塑化原物料" : "Chemicals & Materials"
        case "financials": return selectedLanguage == .zh ? "金融保險" : "Financials"
        case "default": return selectedLanguage == .zh ? "一般產業" : "General"
        default: return value ?? "-"
        }
    }

    private func localizedSignal(_ value: String?) -> String {
        guard let value else { return "-" }
        switch value {
        case "強勢", "Strong": return text.strongLabel
        case "主力出貨", "Distribution": return text.distributionLabel
        case "中性", "Neutral": return text.neutralLabel
        default: return value
        }
    }

    private func sessionText(_ session: String) -> String {
        switch session {
        case "pre": return text.preBadge
        case "post": return text.postBadge
        case "regular": return text.regularBadge
        default: return session.uppercased()
        }
    }

    private func sessionBadgeColor(_ session: String) -> Color {
        switch session {
        case "pre": return .orange
        case "post": return .purple
        case "regular": return .green
        default: return .blue
        }
    }

    private func containsChinese(_ text: String) -> Bool {
        text.unicodeScalars.contains { scalar in
            CharacterSet(charactersIn: "\u{4E00}"..."\u{9FFF}").contains(scalar)
        }
    }

    private func selectSearchResult(_ result: SearchResult) {
        let pickedSymbol = result.symbol
        viewModel.symbol = pickedSymbol
        viewModel.searchQuery = ""
        viewModel.searchResults = []
        viewModel.errorMessage = nil
        screenMode = .detail
        viewModel.refreshAllData(symbolOverride: pickedSymbol, languageCode: selectedLanguage == .zh ? "zh" : "en")
    }

    private func openMarketIndex(_ item: MarketIndexItem) {
        viewModel.symbol = item.symbol
        viewModel.searchResults = []
        viewModel.errorMessage = nil
        screenMode = .detail
        viewModel.refreshAllData(symbolOverride: item.symbol, languageCode: selectedLanguage == .zh ? "zh" : "en")
    }

    private func refreshMarketIndices() {
        Task {
            do {
                let response = try await apiService.fetchWatchlist(symbols: marketIndices.map(\.symbol))
                var quotes: [String: WatchlistQuote] = [:]

                if let basicItems = response.basicItems {
                    for item in basicItems {
                        quotes[item.symbol] = WatchlistQuote(
                            id: item.symbol,
                            symbol: item.symbol,
                            name: item.name,
                            price: item.price,
                            previousClose: item.previousClose,
                            change: item.change,
                            sparkline: []
                        )
                    }
                }

                for item in response.items {
                    quotes[item.symbol] = WatchlistQuote(
                        id: item.symbol,
                        symbol: item.symbol,
                        name: item.name,
                        price: item.price,
                        previousClose: item.previousClose,
                        change: item.change,
                        sparkline: item.sparkline
                    )
                }

                await MainActor.run {
                    marketIndexQuotes = quotes
                }
            } catch {
            }
        }
    }

    private func evaluateAllAlerts() {
        let symbols = Set(alertCenter.alerts.filter { $0.enabled }.map { $0.symbol })
        let isZh = selectedLanguage == .zh
        for sym in symbols { alertCenter.evaluate(symbol: sym, isZh: isZh) }
    }

    private func loadRanking() {
        Task {
            do {
                let response = try await apiService.fetchRanking(top: 20)
                await MainActor.run {
                    rankingItems = response.items
                    rankingAsOf = response.asOf
                }
            } catch {
            }
        }
    }

    private func loadTopGainers() {
        let window = gainerWindow
        Task {
            do {
                let response = try await apiService.fetchTopGainers(top: 20, window: window)
                await MainActor.run {
                    gainerItems = response.items
                    gainersAsOf = response.asOf
                }
            } catch {
            }
        }
    }

    private func openRankingSymbol(_ symbol: String) {
        viewModel.errorMessage = nil
        viewModel.symbol = symbol
        screenMode = .detail
        viewModel.refreshAllData(symbolOverride: symbol, languageCode: selectedLanguage == .zh ? "zh" : "en")
    }

    private var llmLoadingText: String {
        let dots = String(repeating: ".", count: (llmLoadingPhase % 3) + 1)
        return selectedLanguage == .zh ? "AI 分析生成中\(dots)" : "Generating AI outlook\(dots)"
    }

    private func startLLMLoadingAnimation() {
        llmLoadingTask?.cancel()
        llmLoadingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(450))
                if Task.isCancelled { break }
                await MainActor.run {
                    llmLoadingPhase = (llmLoadingPhase + 1) % 3
                }
            }
        }
    }

    private func stopLLMLoadingAnimation() {
        llmLoadingTask?.cancel()
        llmLoadingTask = nil
        llmLoadingPhase = 0
    }

    private func formattedListPrice(_ value: Double?) -> String {
        guard let value else { return "--" }
        return String(format: "$%.2f", value)
    }
}


