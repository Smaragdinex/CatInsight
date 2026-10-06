import Foundation

enum StockAPIServiceError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpStatus(Int)
    case api(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .invalidResponse:
            return "Invalid server response"
        case .httpStatus(let code):
            return "HTTP error \(code)"
        case .api(let message):
            return message
        }
    }
}

struct StockAPIService {
    let baseURL: String
    let session: URLSession

    init(baseURL: String = "https://api.example.com",   // 部署時改成自己的後端網址
          session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func fetchStock(symbol: String, period: String) async throws -> StockResponse {
        let encodedSymbol = try encodePath(symbol)
        let url = try makeURL("/stock/\(encodedSymbol)?period=\(period)")
        return try await fetch(url)
    }

    /// 圖表專用序列(1D 5 分鐘、1W 15 分鐘、1M 每小時、其餘每日)。
    func fetchChart(symbol: String, period: String) async throws -> StockResponse {
        let encodedSymbol = try encodePath(symbol)
        let url = try makeURL("/chart/\(encodedSymbol)?period=\(period)")
        return try await fetch(url)
    }

    func fetchQuote(symbol: String) async throws -> QuoteResponse {
        let encodedSymbol = try encodePath(symbol)
        let url = try makeURL("/quote/\(encodedSymbol)")
        return try await fetch(url)
    }

    func search(query: String, limit: Int = 8) async throws -> SearchResponse {
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)
        guard let encoded else { throw StockAPIServiceError.invalidURL }
        let url = try makeURL("/search?q=\(encoded)&limit=\(limit)")
        return try await fetch(url)
    }

    func fetchRatings(symbol: String) async throws -> RatingsResponse {
        let encodedSymbol = try encodePath(symbol)
        let url = try makeURL("/ratings/\(encodedSymbol)")
        return try await fetch(url)
    }

    func fetchValuation(symbol: String) async throws -> ValuationResponse {
        let encodedSymbol = try encodePath(symbol)
        let url = try makeURL("/valuation/\(encodedSymbol)")
        return try await fetch(url)
    }

    func fetchEarnings(symbol: String, limit: Int = 5) async throws -> EarningsResponse {
        let encodedSymbol = try encodePath(symbol)
        let url = try makeURL("/earnings/\(encodedSymbol)?limit=\(limit)")
        return try await fetch(url)
    }

    func fetchNews(symbol: String, limit: Int = 12) async throws -> NewsResponse {
        let encodedSymbol = try encodePath(symbol)
        let url = try makeURL("/news/\(encodedSymbol)?limit=\(limit)")
        return try await fetch(url)
    }

    func fetchNewsDigest(symbol: String, languageCode: String) async throws -> NewsDigestResponse {
        let encodedSymbol = try encodePath(symbol)
        let url = try makeURL("/news-digest/\(encodedSymbol)?lang=\(languageCode)")
        return try await fetch(url, timeout: 180)
    }

    func fetchLLMTomorrow(symbol: String, languageCode: String) async throws -> LLMTomorrowResponse {
        let encodedSymbol = try encodePath(symbol)
        let url = try makeURL("/llm-tomorrow/\(encodedSymbol)?lang=\(languageCode)")
        return try await fetch(url)
    }

    func fetchWatchlist(symbols: [String]) async throws -> WatchlistBatchResponse {
        let joined = symbols.joined(separator: ",")
        guard let encoded = joined.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else {
            throw StockAPIServiceError.invalidURL
        }
        let url = try makeURL("/watchlist?symbols=\(encoded)")
        return try await fetch(url)
    }

    func fetchRanking(top: Int = 20) async throws -> RankingResponse {
        let url = try makeURL("/ranking?top=\(top)")
        return try await fetch(url)
    }

    func fetchHealth(symbol: String) async throws -> HealthResponse {
        let encodedSymbol = try encodePath(symbol)
        let url = try makeURL("/health/\(encodedSymbol)")
        return try await fetch(url)
    }

    func fetchTopGainers(top: Int = 20, window: String = "1y", live: Bool = true) async throws -> TopGainersResponse {
        let url = try makeURL("/top-gainers?top=\(top)&window=\(window)&live=\(live ? 1 : 0)")
        return try await fetch(url)
    }

    func fetchSignals(symbol: String, period: Int = 14,
                      fast: Int = 12, slow: Int = 26, signal: Int = 9) async throws -> SignalsResponse {
        let encodedSymbol = try encodePath(symbol)
        let url = try makeURL("/signals/\(encodedSymbol)?period=\(period)&fast=\(fast)&slow=\(slow)&signal=\(signal)")
        return try await fetch(url)
    }

    func fetchAIReport(symbol: String, languageCode: String) async throws -> AIReportResponse {
        let encodedSymbol = try encodePath(symbol)
        let url = try makeURL("/api/ai/report/\(encodedSymbol)?lang=\(languageCode)")
        return try await fetch(url, timeout: 180)   // 本地 LLM 冷啟動+生成較慢
    }

    func sendAIChat(symbol: String, languageCode: String, messages: [AIChatMessage], watchlist: [String] = []) async throws -> AIChatResponse {
        let url = try makeURL("/api/ai/chat")
        let payload: [String: Any] = [
            "symbol": symbol,
            "lang": languageCode,
            "messages": messages.map { ["role": $0.role, "content": $0.content] },
            "watchlist": watchlist,
        ]
        return try await post(url, payload: payload, timeout: 180)
    }

    /// 串流版問答(語音對話用):後端每行回一個 NDJSON,{"t": 片段} … 最後 {"done": true}。
    /// 回傳的 stream 逐段吐出文字片段。
    func streamAIChat(symbol: String, languageCode: String, messages: [AIChatMessage], watchlist: [String] = [], voice: Bool = true) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let url = try makeURL("/api/ai/chat/stream")
                    var request = URLRequest(url: url)
                    request.httpMethod = "POST"
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.timeoutInterval = 180
                    let payload: [String: Any] = [
                        "symbol": symbol, "lang": languageCode, "voice": voice,
                        "messages": messages.map { ["role": $0.role, "content": $0.content] },
                        "watchlist": watchlist,
                    ]
                    request.httpBody = try JSONSerialization.data(withJSONObject: payload)
                    let (bytes, response) = try await session.bytes(for: request)
                    guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                        throw StockAPIServiceError.httpStatus((response as? HTTPURLResponse)?.statusCode ?? -1)
                    }
                    for try await line in bytes.lines {
                        guard let data = line.data(using: .utf8),
                              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                        if let t = obj["t"] as? String, !t.isEmpty { continuation.yield(t) }
                        if obj["done"] as? Bool == true {
                            if let err = obj["error"] as? String, !err.isEmpty { throw StockAPIServiceError.api(err) }
                            break
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: - 推播

    func registerPush(token: String, languageCode: String) async throws {
        let url = try makeURL("/push/register")
        let _: [String: Bool] = try await post(url, payload: ["token": token, "platform": "ios", "lang": languageCode])
    }

    func syncPushAlerts(token: String, alerts: [StockAlert], watchlist: [String]) async throws {
        let url = try makeURL("/push/alerts")
        let items: [[String: Any]] = alerts.map { a in
            var d: [String: Any] = ["id": a.id.uuidString, "symbol": a.symbol, "metric": a.metric.rawValue,
                                    "direction": a.direction.rawValue, "target": a.target, "enabled": a.enabled]
            if let v = a.period { d["period"] = v }
            if let v = a.fastPeriod { d["fastPeriod"] = v }
            if let v = a.slowPeriod { d["slowPeriod"] = v }
            if let v = a.signalPeriod { d["signalPeriod"] = v }
            if let t = a.lastTriggered { d["lastTriggered"] = t.timeIntervalSince1970 }
            return d
        }
        let _: [String: Bool] = try await post(url, payload: ["token": token, "alerts": items, "watchlist": watchlist])
    }

    func fetchAIAnalysis(payload: [String: Any]) async throws -> AIAnalysisResponse {
        let url = try makeURL("/api/ai/analyze")
        return try await post(url, payload: payload)
    }

    private func makeURL(_ path: String) throws -> URL {
        guard let url = URL(string: baseURL + path) else {
            throw StockAPIServiceError.invalidURL
        }
        return url
    }

    private func encodePath(_ value: String) throws -> String {
        guard let encoded = value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw StockAPIServiceError.invalidURL
        }
        return encoded
    }

    private func fetch<T: Decodable>(_ url: URL, timeout: TimeInterval = 60) async throws -> T {
        var request = URLRequest(url: url)
        request.timeoutInterval = timeout
        let (data, response) = try await session.data(for: request)
        return try decodeResponse(data: data, response: response)
    }

    private func post<T: Decodable>(_ url: URL, payload: [String: Any], timeout: TimeInterval = 60) async throws -> T {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        request.timeoutInterval = timeout
        let (data, response) = try await session.data(for: request)
        return try decodeResponse(data: data, response: response)
    }

    private func decodeResponse<T: Decodable>(data: Data, response: URLResponse) throws -> T {
        guard let http = response as? HTTPURLResponse else {
            throw StockAPIServiceError.invalidResponse
        }

        guard (200...299).contains(http.statusCode) else {
            if let apiError = try? JSONDecoder().decode(APIErrorResponse.self, from: data) {
                throw StockAPIServiceError.api(apiError.error)
            }
            throw StockAPIServiceError.httpStatus(http.statusCode)
        }

        if let apiError = try? JSONDecoder().decode(APIErrorResponse.self, from: data) {
            throw StockAPIServiceError.api(apiError.error)
        }

        return try JSONDecoder().decode(T.self, from: data)
    }
}
