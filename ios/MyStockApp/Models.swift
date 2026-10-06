import Foundation

nonisolated struct APIErrorResponse: Codable, Sendable {
    let error: String
}

nonisolated struct StockResponse: Codable, Sendable {
    let stock: String
    let period: String?
    let interval: String?
    let data: [StockData]
    let rsi: Double?
    let mfi: Double?
    let signal: String?
}

nonisolated struct QuoteResponse: Codable, Sendable {
    let stock: String
    let price: Double?
    let displayPrice: Double?
    let regularPrice: Double?
    let extendedPrice: Double?
    let previousClose: Double?
    let change: Double?
    let changePercent: Double?
    let dayHigh: Double?
    let dayLow: Double?
    let currency: String?
    let marketState: String?
    let session: String?
    let companyName: String?
    let marketCap: Double?
    let openPrice: Double?
    let fiftyTwoWeekHigh: Double?
    let fiftyTwoWeekLow: Double?
    let eps: Double?
    let peRatio: Double?
    let dividendYield: Double?
}

nonisolated struct SearchResponse: Codable, Sendable {
    let query: String?
    let results: [SearchResult]
    let error: String?
}

nonisolated struct RankingResponse: Codable, Sendable {
    let asOf: String?
    let model: String?
    let count: Int?
    let items: [RankingItem]
}

nonisolated struct RankingItem: Codable, Identifiable, Sendable {
    let rank: Int
    let symbol: String
    let price: Double?
    let score: Double?
    let analystUpside: Double?
    let analystRaisesRatio: Double?
    let rsi: Double?
    let isNewStock: Bool?

    var id: String { symbol }
}

// 個股量化體檢:總分百分位 + 6 因子百分位(雷達圖用)
nonisolated struct HealthResponse: Codable, Sendable {
    let symbol: String
    let available: Bool
    let asOf: String?
    let overall: Int?
    let factors: [HealthFactor]?
}

nonisolated struct HealthFactor: Codable, Sendable, Identifiable {
    let key: String
    let labelEn: String
    let labelZh: String
    let value: Int
    var id: String { key }
}

// 漲幅排行榜(window: 1y 近一年 / ytd 今年)
nonisolated struct TopGainersResponse: Codable, Sendable {
    let asOf: String?
    let window: String?
    let since: String?
    let count: Int?
    let items: [GainerItem]
    let live: Bool?
}

nonisolated struct GainerItem: Codable, Identifiable, Sendable {
    let rank: Int
    let symbol: String
    let baselineDate: String?
    let baselinePrice: Double?
    let price: Double?
    let changePct: Double?
    let rsRating: Int?
    var id: String { symbol }
}

nonisolated struct WatchlistBatchResponse: Codable, Sendable {
    let symbols: [String]
    let items: [WatchlistBatchItem]
    let basicItems: [WatchlistBasicItem]?
}

nonisolated struct WatchlistBasicItem: Codable, Sendable {
    let symbol: String
    let name: String
    let price: Double?
    let previousClose: Double?
    let change: Double?
}

nonisolated struct WatchlistBatchItem: Codable, Sendable {
    let symbol: String
    let name: String
    let price: Double?
    let previousClose: Double?
    let change: Double?
    let sparkline: [Double]
}

nonisolated struct NewsResponse: Codable, Sendable {
    let stock: String
    let items: [NewsItem]
    let error: String?
}

/// AI 幫你讀新聞:3 句摘要 + 偏多/偏空/中性
nonisolated struct NewsDigestResponse: Codable, Sendable {
    let symbol: String
    let sentiment: String      // positive / negative / neutral
    let summary: String
    let count: Int?
    let asOf: String?
    let error: String?
}

nonisolated struct RatingsResponse: Codable, Sendable {
    let stock: String
    let strongBuy: Int
    let buy: Int
    let hold: Int
    let sell: Int
    let strongSell: Int
    let total: Int
    let recommendationKey: String?
    let numberOfAnalystOpinions: Int?
    let error: String?
}

nonisolated struct EarningsResponse: Codable, Sendable {
    let stock: String
    let items: [EarningsItem]
    let nextEarningsDate: String?
    let earningsTiming: String?
    let error: String?
}

nonisolated struct EarningsItem: Codable, Identifiable, Sendable {
    let quarter: String
    let fiscalYear: String?
    let estimate: Double?
    let actual: Double?
    let surprisePercent: Double?
    let earningsDate: String?

    var id: String { "\(quarter)-\(fiscalYear ?? "")-\(earningsDate ?? "")" }
}

nonisolated struct LLMTomorrowResponse: Codable, Sendable {
    let stock: String
    let bias: String
    let predictedLow: Double?
    let predictedHigh: Double?
    let confidence: String
    let summary: String
    let newsImpact: String
    let newsSummary: String
    let source: String?
    let lang: String?
    let error: String?
}

nonisolated struct AIReportResponse: Codable, Sendable {
    let symbol: String
    let report: String
    let source: String?
    let lang: String?
    let error: String?
}

nonisolated struct AIChatMessage: Codable, Identifiable, Sendable {
    var id = UUID()
    let role: String      // "user" or "assistant"
    let content: String

    enum CodingKeys: String, CodingKey { case role, content }
}

nonisolated struct AIChatResponse: Codable, Sendable {
    let symbol: String
    let reply: String
    let source: String?
    let lang: String?
    let error: String?
}

nonisolated struct SignalsResponse: Codable, Sendable {
    let symbol: String
    let price: Double?
    let rsi: Double?
    let ma: Double?
    let vwap: Double?
    let macd: Double?
    let macdSignal: Double?
    let moneyOutflow: Bool?
}

enum AlertMetric: String, Codable, Sendable, CaseIterable {
    case price, rsi, ma, vwap, macd, moneyOutflow
}

enum AlertDirection: String, Codable, Sendable {
    case above, below
}

nonisolated struct StockAlert: Codable, Identifiable, Sendable {
    let id: UUID
    let symbol: String
    var metric: AlertMetric
    var direction: AlertDirection
    var target: Double
    var enabled: Bool
    var lastTriggered: Date?
    var interval: String?
    var period: Int?
    var fastPeriod: Int?
    var slowPeriod: Int?
    var signalPeriod: Int?
}

nonisolated struct SavedChat: Codable, Identifiable, Sendable {
    let id: UUID
    let symbol: String
    var date: Date
    var title: String
    var messages: [AIChatMessage]
}

nonisolated struct ValuationScenario: Codable, Identifiable, Sendable {
    let id: String
    let label: String
    let revenueGrowthRate: Double?
    let expectedNetMargin: Double?
    let exitPE: Double?
    let targetPE: Double?
    let expectedEPS: Double?
    let targetPrice: Double?
    let compositeTargetPrice: Double?
    let expectedReturn: Double?
}

nonisolated struct ValuationResponse: Codable, Sendable {
    let stock: String
    let modelType: String?
    let holdingYears: Int
    let currentPrice: Double?
    let currentRevenuePerShare: Double?
    let normalizedRevenuePerShare: Double?
    let baseEPS: Double?
    let trailingEPS: Double?
    let forwardEPS: Double?
    let industryBucket: String?
    let analystTargetLow: Double?
    let analystTargetMean: Double?
    let analystTargetHigh: Double?
    let analystCount: Int?
    let isCalibrated: Bool?
    let notes: String?
    let scenarios: [ValuationScenario]
    let error: String?
}

nonisolated struct NewsItem: Codable, Identifiable, Sendable {
    let id: String
    let title: String
    let summary: String?
    let url: String?
    let provider: String?
    let publishedAt: String?
    let imageUrl: String?
    let domain: String?

    enum CodingKeys: String, CodingKey {
        case id, title, summary, url, provider, publishedAt, imageUrl, domain
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? "Untitled"
        summary = try container.decodeIfPresent(String.self, forKey: .summary)
        url = try container.decodeIfPresent(String.self, forKey: .url)
        provider = try container.decodeIfPresent(String.self, forKey: .provider)
        publishedAt = try container.decodeIfPresent(String.self, forKey: .publishedAt)
        imageUrl = try container.decodeIfPresent(String.self, forKey: .imageUrl)
        domain = try container.decodeIfPresent(String.self, forKey: .domain)
    }

    init(id: String, title: String, summary: String?, url: String?, provider: String?, publishedAt: String?, imageUrl: String?, domain: String?) {
        self.id = id
        self.title = title
        self.summary = summary
        self.url = url
        self.provider = provider
        self.publishedAt = publishedAt
        self.imageUrl = imageUrl
        self.domain = domain
    }

    var publishedDate: Date? {
        guard let publishedAt else { return nil }
        return StockDateParser.parse(publishedAt)
    }
}

nonisolated struct SearchResult: Codable, Identifiable, Sendable {
    let symbol: String
    let name: String
    let exchange: String?
    let type: String?

    var id: String { symbol }
}

nonisolated struct StockData: Codable, Identifiable, Sendable {
    var id: String { date }
    let date: String
    let chartLabel: String?
    let price: Double
    let open: Double?
    let ma5: Double?
    let high: Double?
    let low: Double?
    let volume: Double?

    var parsedDate: Date {
        StockDateParser.parse(date) ?? .distantPast
    }
}

nonisolated struct ChartCandle: Identifiable {
    let id = UUID()
    let date: Date
    let label: String
    let open: Double
    let high: Double
    let low: Double
    let close: Double
    let volume: Double
}

nonisolated struct WatchlistItem: Codable, Identifiable, Hashable, Sendable {
    let symbol: String
    let name: String

    var id: String { symbol }
}

nonisolated struct WatchlistQuote: Codable, Identifiable, Sendable {
    let id: String
    let symbol: String
    let name: String
    let price: Double?
    let previousClose: Double?
    let change: Double?
    let sparkline: [Double]
}

nonisolated struct MarketIndexItem: Identifiable, Hashable, Sendable {
    let symbol: String
    let name: String

    var id: String { symbol }
}

nonisolated struct ChartPoint: Identifiable {
    let id = UUID()
    let date: Date
    let price: Double
    let ma5: Double?
    let isLivePoint: Bool
}

nonisolated struct AIAnalysisSentiment: Codable, Sendable {
    let label: String
    let items: [String]
}

nonisolated struct AIAnalysisResponse: Codable, Sendable {
    let action: String
    let confidence: String
    let predictedLow: Double?
    let predictedHigh: Double?
    let summary: String
    let technical: [String]
    let sentiment: AIAnalysisSentiment
    let watchPoints: [String]
    let modelVersion: String?
    let modelProbabilities: [String: Double]?
}
