import Foundation
import Combine

@MainActor
final class DashboardViewModel: ObservableObject {
    @Published var stockInfo: StockResponse?
    /// 圖表專用序列(來自 /chart,較細的 K 線間隔);指標與歷史明細仍用 stockInfo
    @Published var chartInfo: StockResponse?
    @Published var liveQuote: QuoteResponse?
    @Published var isLoading = false
    @Published var quoteLoading = false
    @Published var errorMessage: String?
    @Published var symbol: String = ""
    @Published var searchQuery: String = ""
    @Published var selectedPeriod: String = "1mo"
    @Published var searchResults: [SearchResult] = []
    @Published var newsItems: [NewsItem] = []
    @Published var newsLoading = false
    @Published var newsDigest: NewsDigestResponse?
    @Published var newsDigestLoading = false
    private var newsDigestCache: [String: (Date, NewsDigestResponse)] = [:]
    @Published var ratings: RatingsResponse?
    @Published var earningsItems: [EarningsItem] = []
    @Published var nextEarningsDateText: String?
    @Published var nextEarningsTiming: String?
    @Published var llmTomorrow: LLMTomorrowResponse?
    @Published var isLLMTomorrowLoading = false
    @Published var valuation: ValuationResponse?
    @Published var selectedValuationScenario = "base"
    @Published var watchlistQuotes: [String: WatchlistQuote] = [:]

    private let watchlistCacheKey = "watchlist.quotes.cache"
    @Published var aiAnalysis: AIAnalysisResponse?
    @Published var health: HealthResponse?

    private let apiService: StockAPIService
    private var aiRefreshTask: Task<Void, Never>?
    private var quoteRefreshTask: Task<Void, Never>?
    private var watchlistRefreshTask: Task<Void, Never>?
    private var searchCache: [String: [SearchResult]] = [:]
    private var ratingsCache: [String: (Date, RatingsResponse)] = [:]
    private var valuationCache: [String: (Date, ValuationResponse)] = [:]
    private var earningsCache: [String: (Date, EarningsResponse)] = [:]
    private var newsCache: [String: (Date, [NewsItem])] = [:]
    private var llmTomorrowCache: [String: (Date, LLMTomorrowResponse)] = [:]
    private var watchlistLastLoadedAt: Date?
    private var cancellables = Set<AnyCancellable>()

    init(apiService: StockAPIService? = nil) {
        self.apiService = apiService ?? StockAPIService()
        restoreCachedWatchlistQuotes()
        bindSearchDebounce()
    }

    deinit {
        quoteRefreshTask?.cancel()
        watchlistRefreshTask?.cancel()
        aiRefreshTask?.cancel()
    }

    func bindSearchDebounce() {
        $searchQuery
            .removeDuplicates()
            .debounce(for: .milliseconds(120), scheduler: RunLoop.main)
            .sink { [weak self] newValue in
                guard let self else { return }
                Task { await self.performSearch(query: newValue) }
            }
            .store(in: &cancellables)
    }

    func normalizedSymbolInput(_ raw: String) -> String {
        raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }

    func performSearch(query: String) async {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedQuery.isEmpty {
            searchResults = []
            return
        }

        let cacheKey = trimmedQuery.uppercased()
        if let cached = searchCache[cacheKey] {
            searchResults = cached
            return
        }

        do {
            let decoded = try await apiService.search(query: trimmedQuery, limit: 8)
            searchResults = decoded.results
            searchCache[cacheKey] = decoded.results

            if searchCache.count > 50,
               let firstKey = searchCache.keys.first {
                searchCache.removeValue(forKey: firstKey)
            }
        } catch {
            searchResults = []
        }
    }

    func refreshAllData(symbolOverride: String? = nil, languageCode: String) {
        let targetSymbol = normalizedSymbolInput(symbolOverride ?? symbol)
        guard !targetSymbol.isEmpty else {
            errorMessage = languageCode == "zh" ? "請輸入股票代號" : "Please enter a stock symbol"
            stockInfo = nil
            liveQuote = nil
            return
        }

        symbol = targetSymbol
        isLoading = true
        errorMessage = nil
        searchResults = []
        ratings = nil
        valuation = nil
        earningsItems = []
        nextEarningsDateText = nil
        nextEarningsTiming = nil
        newsItems = []
        newsLoading = false
        newsDigest = nil
        newsDigestLoading = false
        aiAnalysis = nil
        health = nil
        if chartInfo?.stock.uppercased() != targetSymbol { chartInfo = nil }

        aiRefreshTask?.cancel()

        Task {
            async let stockTask = apiService.fetchStock(symbol: targetSymbol, period: selectedPeriod)
            async let quoteTask = apiService.fetchQuote(symbol: targetSymbol)

            do {
                let stock = try await stockTask
                let quote = try await quoteTask
                stockInfo = stock
                liveQuote = quote
                symbol = stock.stock
                isLoading = false
                startQuoteAutoRefresh(for: targetSymbol)
                Task { await fetchChart(using: targetSymbol) }
            } catch {
                isLoading = false
                errorMessage = error.localizedDescription
                stockInfo = nil
                return
            }

            Task {
                async let ratingsTask: Void = fetchRatings(using: targetSymbol)
                async let valuationTask: Void = fetchValuation(using: targetSymbol)
                async let earningsTask: Void = fetchEarnings(using: targetSymbol)
                async let newsTask: Void = fetchNews(using: targetSymbol)
                async let healthTask: Void = fetchHealth(using: targetSymbol)
                _ = await (ratingsTask, valuationTask, earningsTask, newsTask, healthTask)
            }

            aiRefreshTask = Task { [weak self] in
                guard let self else { return }
                self.llmTomorrow = nil
                self.aiAnalysis = nil
                self.isLLMTomorrowLoading = true
                await self.fetchLLMTomorrow(using: targetSymbol, languageCode: languageCode)
                if Task.isCancelled { return }
                await self.fetchAIAnalysis(using: targetSymbol, languageCode: languageCode)
            }
        }
    }

    func fetchChart(using rawSymbol: String? = nil) async {
        let cleanSymbol = normalizedSymbolInput(rawSymbol ?? symbol)
        guard !cleanSymbol.isEmpty else { chartInfo = nil; return }
        let period = selectedPeriod
        if let decoded = try? await apiService.fetchChart(symbol: cleanSymbol, period: period),
           period == selectedPeriod {
            chartInfo = decoded
        }
    }

    func fetchHealth(using rawSymbol: String? = nil) async {
        let cleanSymbol = normalizedSymbolInput(rawSymbol ?? symbol)
        guard !cleanSymbol.isEmpty else {
            health = nil
            return
        }
        do {
            health = try await apiService.fetchHealth(symbol: cleanSymbol)
        } catch {
            health = nil
        }
    }

    func fetchRatings(using rawSymbol: String? = nil) async {
        let cleanSymbol = normalizedSymbolInput(rawSymbol ?? symbol)
        guard !cleanSymbol.isEmpty else {
            ratings = nil
            return
        }

        if let cached = ratingsCache[cleanSymbol], Date().timeIntervalSince(cached.0) < 300 {
            ratings = cached.1
            return
        }

        do {
            let decoded = try await apiService.fetchRatings(symbol: cleanSymbol)
            ratings = decoded
            ratingsCache[cleanSymbol] = (Date(), decoded)
        } catch {
        }
    }

    func fetchValuation(using rawSymbol: String? = nil) async {
        let cleanSymbol = normalizedSymbolInput(rawSymbol ?? symbol)
        guard !cleanSymbol.isEmpty else {
            valuation = nil
            return
        }

        if let cached = valuationCache[cleanSymbol], Date().timeIntervalSince(cached.0) < 300 {
            valuation = cached.1
            if cached.1.scenarios.contains(where: { $0.id == selectedValuationScenario }) == false,
               let firstScenario = cached.1.scenarios.first {
                selectedValuationScenario = firstScenario.id
            }
            return
        }

        do {
            let decoded = try await apiService.fetchValuation(symbol: cleanSymbol)
            valuation = decoded
            valuationCache[cleanSymbol] = (Date(), decoded)
            if decoded.scenarios.contains(where: { $0.id == selectedValuationScenario }) == false,
               let firstScenario = decoded.scenarios.first {
                selectedValuationScenario = firstScenario.id
            }
        } catch {
        }
    }

    func fetchEarnings(using rawSymbol: String? = nil) async {
        let cleanSymbol = normalizedSymbolInput(rawSymbol ?? symbol)
        guard !cleanSymbol.isEmpty else {
            earningsItems = []
            nextEarningsDateText = nil
            nextEarningsTiming = nil
            return
        }

        if let cached = earningsCache[cleanSymbol], Date().timeIntervalSince(cached.0) < 300 {
            earningsItems = cached.1.items
            nextEarningsDateText = cached.1.nextEarningsDate
            nextEarningsTiming = cached.1.earningsTiming
            return
        }

        do {
            let decoded = try await apiService.fetchEarnings(symbol: cleanSymbol, limit: 5)
            earningsItems = decoded.items
            nextEarningsDateText = decoded.nextEarningsDate
            nextEarningsTiming = decoded.earningsTiming
            earningsCache[cleanSymbol] = (Date(), decoded)
        } catch {
        }
    }

    func fetchNews(using rawSymbol: String? = nil) async {
        let cleanSymbol = normalizedSymbolInput(rawSymbol ?? symbol)
        guard !cleanSymbol.isEmpty else {
            newsItems = []
            return
        }

        if let cached = newsCache[cleanSymbol], Date().timeIntervalSince(cached.0) < 300 {
            newsItems = cached.1
            newsLoading = false
            return
        }

        newsLoading = true
        defer { newsLoading = false }

        do {
            let response = try await apiService.fetchNews(symbol: cleanSymbol, limit: 12)
            let validItems = response.items
                .filter { !$0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            let sortedItems = validItems.sorted {
                ($0.publishedDate ?? .distantPast) > ($1.publishedDate ?? .distantPast)
            }
            let companyName = liveQuote?.companyName ?? stockInfo?.stock ?? cleanSymbol
            let filteredItems = sortedItems.filter { isRelevantNewsItem($0, symbol: cleanSymbol, companyName: companyName) }

            let finalItems: [NewsItem]
            if filteredItems.isEmpty {
                finalItems = sortedItems
            } else if filteredItems.count >= 3 {
                finalItems = filteredItems
            } else {
                var mergedItems = filteredItems
                let existingIDs = Set(filteredItems.map(\.id))
                let fallbackItems = sortedItems.filter { !existingIDs.contains($0.id) }
                mergedItems.append(contentsOf: fallbackItems)
                finalItems = mergedItems
            }

            newsItems = finalItems
            newsCache[cleanSymbol] = (Date(), finalItems)
        } catch {
            newsItems = []
        }
    }

    /// AI 幫你讀新聞(使用者按了才抓;30 分鐘內同股同語言不重抓)
    func fetchNewsDigest(languageCode: String) async {
        let clean = normalizedSymbolInput(symbol)
        guard !clean.isEmpty, !newsDigestLoading else { return }
        let key = "\(clean)|\(languageCode)"
        if let cached = newsDigestCache[key], Date().timeIntervalSince(cached.0) < 1800 {
            newsDigest = cached.1
            return
        }
        newsDigestLoading = true
        defer { newsDigestLoading = false }
        do {
            let d = try await apiService.fetchNewsDigest(symbol: clean, languageCode: languageCode)
            guard normalizedSymbolInput(symbol) == clean else { return }
            newsDigest = d
            if !d.summary.isEmpty { newsDigestCache[key] = (Date(), d) }
        } catch {
            newsDigest = NewsDigestResponse(symbol: clean, sentiment: "neutral", summary: "", count: 0, asOf: nil, error: error.localizedDescription)
        }
    }

    func fetchLLMTomorrow(using rawSymbol: String? = nil, languageCode: String, forceRefresh: Bool = false) async {
        let cleanSymbol = normalizedSymbolInput(rawSymbol ?? symbol)
        let cacheKey = "\(cleanSymbol)|\(languageCode)"

        guard !cleanSymbol.isEmpty else {
            llmTomorrow = nil
            isLLMTomorrowLoading = false
            return
        }

        if !forceRefresh,
           let cached = llmTomorrowCache[cacheKey], Date().timeIntervalSince(cached.0) < 300 {
            llmTomorrow = cached.1
            isLLMTomorrowLoading = false
            return
        }

        if llmTomorrow?.stock.uppercased() != cleanSymbol {
            llmTomorrow = nil
        }
        isLLMTomorrowLoading = true
        defer { isLLMTomorrowLoading = false }

        do {
            let decoded = try await apiService.fetchLLMTomorrow(symbol: cleanSymbol, languageCode: languageCode)
            llmTomorrow = decoded
            llmTomorrowCache[cacheKey] = (Date(), decoded)
        } catch {
        }
    }

    private func isRelevantNewsItem(_ item: NewsItem, symbol: String, companyName: String) -> Bool {
        let haystack = [item.title, item.summary ?? ""]
            .joined(separator: " ")
            .lowercased()
        let tokens = newsMatchTokens(symbol: symbol, companyName: companyName)
        let blocked = newsBlockedTokens(symbol: symbol)

        let positiveScore = tokens.reduce(0) { partial, token in
            guard !token.isEmpty else { return partial }
            return partial + (haystack.contains(token) ? (token == symbol.lowercased() ? 3 : 2) : 0)
        }
        let negativeScore = blocked.reduce(0) { partial, token in
            partial + (haystack.contains(token) ? 3 : 0)
        }

        return positiveScore > 0 && positiveScore >= negativeScore
    }

    private func newsMatchTokens(symbol: String, companyName: String) -> [String] {
        let lowerSymbol = symbol.lowercased()
        let lowerName = companyName.lowercased()
        var tokens = Set<String>()
        tokens.insert(lowerSymbol)
        tokens.insert(lowerName)

        let parts = lowerName
            .replacingOccurrences(of: ",", with: " ")
            .replacingOccurrences(of: ".", with: " ")
            .split(separator: " ")
            .map(String.init)
            .filter { $0.count >= 4 && !["inc", "corp", "ltd", "technology", "holdings", "group", "class"].contains($0) }
        parts.forEach { tokens.insert($0) }

        let symbolSpecificTokens: [String: [String]] = [
            "nvda": ["nvidia", "jensen huang", "blackwell", "gpu"]
        ]
        symbolSpecificTokens[lowerSymbol, default: []].forEach { tokens.insert($0) }

        return Array(tokens)
    }

    private func newsBlockedTokens(symbol: String) -> [String] {
        let current = symbol.lowercased()
        let map: [String: [String]] = [
            "alab": ["marvell", "mrvl", "micron", "mu", "nvidia", "nvda", "broadcom", "avgo"],
            "mrvl": ["micron", "mu", "maxim", "mxim", "美信"],
            "mu": ["marvell", "mrvl", "maxim", "mxim"],
        ]
        return map[current] ?? []
    }

    func fetchAIAnalysis(using rawSymbol: String? = nil, languageCode: String, forceRefresh: Bool = false) async {
        let cleanSymbol = normalizedSymbolInput(rawSymbol ?? symbol)
        guard !cleanSymbol.isEmpty else {
            aiAnalysis = nil
            return
        }

        let companyName = liveQuote?.companyName ?? stockInfo?.stock ?? cleanSymbol
        let currentPrice = liveQuote?.regularPrice ?? liveQuote?.displayPrice ?? liveQuote?.price ?? stockInfo?.data.last?.price
        let sequence: [[String: Any]] = stockInfo?.data.suffix(20).enumerated().map { index, item in
            let prevClose = index > 0 ? stockInfo?.data.suffix(20)[stockInfo!.data.suffix(20).index(stockInfo!.data.suffix(20).startIndex, offsetBy: index - 1)].price : nil
            let return1d: Double? = {
                guard let prevClose, prevClose > 0 else { return nil }
                return (item.price / prevClose) - 1.0
            }()
            let prices = Array(stockInfo?.data.suffix(20) ?? [])
            let start = max(0, index - 4)
            let window = prices[start...index].map { $0.price }
            let ma5 = window.isEmpty ? nil : window.reduce(0, +) / Double(window.count)
            let volatility5d: Double? = {
                guard window.count >= 3 else { return nil }
                let base = Array(prices[max(0, index - 5)..<index]).map { $0.price }
                let combined = base + [item.price]
                let returns = zip(combined.dropFirst(), combined).map { curr, prev in (curr / prev) - 1.0 }
                guard !returns.isEmpty else { return nil }
                let mean = returns.reduce(0, +) / Double(returns.count)
                let variance = returns.map { pow($0 - mean, 2) }.reduce(0, +) / Double(returns.count)
                return sqrt(variance)
            }()
            return [
                "date": item.date,
                "close": item.price,
                "high": item.high as Any,
                "low": item.low as Any,
                "volume": item.volume as Any,
                "ma5": ma5 as Any,
                "return1d": return1d as Any,
                "volatility5d": volatility5d as Any,
            ]
        } ?? []

        let payload: [String: Any] = [
            "symbol": cleanSymbol,
            "companyName": companyName,
            "language": languageCode == "zh" ? "zh-TW" : "en-US",
            "currentPrice": currentPrice ?? NSNull(),
            "predictedLow": llmTomorrow?.predictedLow ?? NSNull(),
            "predictedHigh": llmTomorrow?.predictedHigh ?? NSNull(),
            "bias": llmTomorrow?.bias ?? NSNull(),
            "confidence": llmTomorrow?.confidence ?? NSNull(),
            "technicalSummary": llmTomorrow?.summary ?? NSNull(),
            "newsImpact": llmTomorrow?.newsImpact ?? NSNull(),
            "newsSummary": llmTomorrow?.newsSummary ?? NSNull(),
            "indicators": [
                "rsi": stockInfo?.rsi.map { $0 as Any } ?? NSNull(),
                "mfi": stockInfo?.mfi.map { $0 as Any } ?? NSNull(),
                "signal": stockInfo?.signal.map { $0 as Any } ?? NSNull(),
            ],
            "sequence": sequence,
            "marketContext": ""
        ]

        do {
            let response = try await apiService.fetchAIAnalysis(payload: payload)
            aiAnalysis = response
        } catch {
            aiAnalysis = nil
        }
    }

    private func restoreCachedWatchlistQuotes() {
        if let cached = UserDefaults.standard.codableValue(forKey: watchlistCacheKey, as: [String: WatchlistQuote].self) {
            watchlistQuotes = cached
        }
    }

    private func persistWatchlistQuotes() {
        UserDefaults.standard.setCodableValue(watchlistQuotes, forKey: watchlistCacheKey)
    }

    func refreshWatchlistQuotes(symbols: [String], force: Bool = false) {
        guard !symbols.isEmpty else {
            watchlistQuotes = [:]
            watchlistLastLoadedAt = nil
            UserDefaults.standard.setCodableValue(watchlistQuotes, forKey: watchlistCacheKey)
            return
        }

        if !force,
           let lastLoadedAt = watchlistLastLoadedAt,
           Date().timeIntervalSince(lastLoadedAt) < 30,
           !watchlistQuotes.isEmpty {
            return
        }

        Task {
            do {
                let decoded = try await apiService.fetchWatchlist(symbols: symbols)

                var quotes: [String: WatchlistQuote] = [:]

                if let basicItems = decoded.basicItems {
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

                for item in decoded.items {
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

                watchlistQuotes = quotes
                watchlistLastLoadedAt = Date()
                persistWatchlistQuotes()
            } catch {
            }
        }
    }

    func startQuoteAutoRefresh(for symbol: String) {
        stopQuoteAutoRefresh()
        quoteRefreshTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                if Task.isCancelled { break }
                self.quoteLoading = true
                do {
                    let quote = try await self.apiService.fetchQuote(symbol: symbol)
                    self.liveQuote = quote
                } catch {
                }
                self.quoteLoading = false
            }
        }
    }

    func stopQuoteAutoRefresh() {
        quoteRefreshTask?.cancel()
        quoteRefreshTask = nil
    }

    func startWatchlistAutoRefresh(symbols: [String]) {
        stopWatchlistAutoRefresh()
        guard !symbols.isEmpty else { return }
        watchlistRefreshTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                if Task.isCancelled { break }
                self.refreshWatchlistQuotes(symbols: symbols, force: true)
            }
        }
    }

    func stopWatchlistAutoRefresh() {
        watchlistRefreshTask?.cancel()
        watchlistRefreshTask = nil
    }
}
