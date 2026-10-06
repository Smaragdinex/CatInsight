package com.catinsight.app.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient
import java.util.UUID

// 對應 iOS Models.swift。所有欄位皆可為 null 以容忍後端缺欄位。

@Serializable data class APIErrorResponse(val error: String)

@Serializable data class StockResponse(
    val stock: String,
    val period: String? = null,
    val interval: String? = null,
    val data: List<StockData> = emptyList(),
    val rsi: Double? = null,
    val mfi: Double? = null,
    val signal: String? = null,
)

@Serializable data class QuoteResponse(
    val stock: String,
    val price: Double? = null,
    val displayPrice: Double? = null,
    val regularPrice: Double? = null,
    val extendedPrice: Double? = null,
    val previousClose: Double? = null,
    val change: Double? = null,
    val changePercent: Double? = null,
    val dayHigh: Double? = null,
    val dayLow: Double? = null,
    val currency: String? = null,
    val marketState: String? = null,
    val session: String? = null,
    val companyName: String? = null,
    val marketCap: Double? = null,
    val openPrice: Double? = null,
    val fiftyTwoWeekHigh: Double? = null,
    val fiftyTwoWeekLow: Double? = null,
    val eps: Double? = null,
    val peRatio: Double? = null,
    val dividendYield: Double? = null,
)

@Serializable data class SearchResponse(
    val query: String? = null,
    val results: List<SearchResult> = emptyList(),
    val error: String? = null,
)

@Serializable data class SearchResult(
    val symbol: String,
    val name: String = "",
    val exchange: String? = null,
    val type: String? = null,
)

@Serializable data class RankingResponse(
    val asOf: String? = null,
    val model: String? = null,
    val count: Int? = null,
    val items: List<RankingItem> = emptyList(),
)

@Serializable data class RankingItem(
    val rank: Int,
    val symbol: String,
    val price: Double? = null,
    val score: Double? = null,
    val analystUpside: Double? = null,
    val analystRaisesRatio: Double? = null,
    val rsi: Double? = null,
    val isNewStock: Boolean? = null,
)

// 漲幅排行榜(window: 1y 近一年 / ytd 今年)
@Serializable data class TopGainersResponse(
    val asOf: String? = null,
    val window: String? = null,
    val since: String? = null,
    val count: Int? = null,
    val items: List<GainerItem> = emptyList(),
    val live: Boolean? = null,
)

@Serializable data class GainerItem(
    val rank: Int,
    val symbol: String,
    val baselineDate: String? = null,
    val baselinePrice: Double? = null,
    val price: Double? = null,
    val changePct: Double? = null,
    val rsRating: Int? = null,
)

@Serializable data class WatchlistBatchResponse(
    val symbols: List<String> = emptyList(),
    val items: List<WatchlistBatchItem> = emptyList(),
    val basicItems: List<WatchlistBasicItem>? = null,
)

@Serializable data class WatchlistBasicItem(
    val symbol: String,
    val name: String = "",
    val price: Double? = null,
    val previousClose: Double? = null,
    val change: Double? = null,
)

@Serializable data class WatchlistBatchItem(
    val symbol: String,
    val name: String = "",
    val price: Double? = null,
    val previousClose: Double? = null,
    val change: Double? = null,
    val sparkline: List<Double> = emptyList(),
)

@Serializable data class NewsResponse(
    val stock: String = "",
    val items: List<NewsItem> = emptyList(),
    val error: String? = null,
)

@Serializable data class NewsItem(
    val id: String = UUID.randomUUID().toString(),
    val title: String = "Untitled",
    val summary: String? = null,
    val url: String? = null,
    val provider: String? = null,
    val publishedAt: String? = null,
    val imageUrl: String? = null,
    val domain: String? = null,
) {
    val publishedDate: java.util.Date? get() = publishedAt?.let { StockDateParser.parse(it) }
}

@Serializable data class RatingsResponse(
    val stock: String = "",
    val strongBuy: Int = 0,
    val buy: Int = 0,
    val hold: Int = 0,
    val sell: Int = 0,
    val strongSell: Int = 0,
    val total: Int = 0,
    val recommendationKey: String? = null,
    val numberOfAnalystOpinions: Int? = null,
    val error: String? = null,
)

@Serializable data class EarningsResponse(
    val stock: String = "",
    val items: List<EarningsItem> = emptyList(),
    val nextEarningsDate: String? = null,
    val earningsTiming: String? = null,
    val error: String? = null,
)

@Serializable data class EarningsItem(
    val quarter: String = "",
    val fiscalYear: String? = null,
    val estimate: Double? = null,
    val actual: Double? = null,
    val surprisePercent: Double? = null,
    val earningsDate: String? = null,
) {
    val id: String get() = "$quarter-${fiscalYear ?: ""}-${earningsDate ?: ""}"
}

@Serializable data class LLMTomorrowResponse(
    val stock: String = "",
    val bias: String = "",
    val predictedLow: Double? = null,
    val predictedHigh: Double? = null,
    val confidence: String = "",
    val summary: String = "",
    val newsImpact: String = "",
    val newsSummary: String = "",
    val source: String? = null,
    val lang: String? = null,
    val error: String? = null,
)

@Serializable data class AIReportResponse(
    val symbol: String = "",
    val report: String = "",
    val source: String? = null,
    val lang: String? = null,
    val error: String? = null,
)

@Serializable data class AIChatMessage(
    val role: String,      // "user" 或 "assistant"
    val content: String,
) {
    @Transient val id: String = UUID.randomUUID().toString()
}

@Serializable data class AIChatResponse(
    val symbol: String = "",
    val reply: String = "",
    val source: String? = null,
    val lang: String? = null,
    val error: String? = null,
)

@Serializable data class SignalsResponse(
    val symbol: String = "",
    val price: Double? = null,
    val rsi: Double? = null,
    val ma: Double? = null,
    val vwap: Double? = null,
    val macd: Double? = null,
    val macdSignal: Double? = null,
    val moneyOutflow: Boolean? = null,
)

@Serializable enum class AlertMetric {
    @SerialName("price") PRICE,
    @SerialName("rsi") RSI,
    @SerialName("ma") MA,
    @SerialName("vwap") VWAP,
    @SerialName("macd") MACD,
    @SerialName("moneyOutflow") MONEY_OUTFLOW,
}

@Serializable enum class AlertDirection {
    @SerialName("above") ABOVE,
    @SerialName("below") BELOW,
}

@Serializable data class StockAlert(
    val id: String = UUID.randomUUID().toString(),
    val symbol: String,
    val metric: AlertMetric,
    val direction: AlertDirection,
    val target: Double,
    val enabled: Boolean = true,
    val lastTriggered: Long? = null,     // epoch millis
    val interval: String? = null,
    val period: Int? = null,
    val fastPeriod: Int? = null,
    val slowPeriod: Int? = null,
    val signalPeriod: Int? = null,
)

@Serializable data class SavedChat(
    val id: String = UUID.randomUUID().toString(),
    val symbol: String,
    val date: Long,                      // epoch millis
    val title: String,
    val messages: List<AIChatMessage>,
)

@Serializable data class ValuationScenario(
    val id: String,
    val label: String = "",
    val revenueGrowthRate: Double? = null,
    val expectedNetMargin: Double? = null,
    val exitPE: Double? = null,
    val targetPE: Double? = null,
    val expectedEPS: Double? = null,
    val targetPrice: Double? = null,
    val compositeTargetPrice: Double? = null,
    val expectedReturn: Double? = null,
)

@Serializable data class ValuationResponse(
    val stock: String = "",
    val modelType: String? = null,
    val holdingYears: Int = 0,
    val currentPrice: Double? = null,
    val currentRevenuePerShare: Double? = null,
    val normalizedRevenuePerShare: Double? = null,
    val baseEPS: Double? = null,
    val trailingEPS: Double? = null,
    val forwardEPS: Double? = null,
    val industryBucket: String? = null,
    val analystTargetLow: Double? = null,
    val analystTargetMean: Double? = null,
    val analystTargetHigh: Double? = null,
    val analystCount: Int? = null,
    val isCalibrated: Boolean? = null,
    val notes: String? = null,
    val scenarios: List<ValuationScenario> = emptyList(),
    val error: String? = null,
)

@Serializable data class StockData(
    val date: String,
    val chartLabel: String? = null,
    val price: Double = 0.0,
    val open: Double? = null,
    val ma5: Double? = null,
    val high: Double? = null,
    val low: Double? = null,
    val volume: Double? = null,
) {
    val parsedDate: java.util.Date get() = StockDateParser.parse(date) ?: java.util.Date(0)
}

data class ChartCandle(
    val date: java.util.Date,
    val label: String,
    val open: Double,
    val high: Double,
    val low: Double,
    val close: Double,
    val volume: Double,
)

@Serializable data class WatchlistItem(val symbol: String, val name: String = "")

@Serializable data class WatchlistQuote(
    val id: String,
    val symbol: String,
    val name: String = "",
    val price: Double? = null,
    val previousClose: Double? = null,
    val change: Double? = null,
    val sparkline: List<Double> = emptyList(),
)

data class MarketIndexItem(val symbol: String, val name: String)

data class ChartPoint(
    val date: java.util.Date,
    val price: Double,
    val ma5: Double?,
    val isLivePoint: Boolean,
)

@Serializable data class AIAnalysisSentiment(val label: String = "", val items: List<String> = emptyList())

@Serializable data class AIAnalysisResponse(
    val action: String = "",
    val confidence: String = "",
    val predictedLow: Double? = null,
    val predictedHigh: Double? = null,
    val summary: String = "",
    val technical: List<String> = emptyList(),
    val sentiment: AIAnalysisSentiment = AIAnalysisSentiment(),
    val watchPoints: List<String> = emptyList(),
    val modelVersion: String? = null,
    val modelProbabilities: Map<String, Double>? = null,
)

/** 從個股頁帶過來、待開啟的新對話(股票代碼 + 已產生的報告)。 */
data class PendingNewChat(
    val symbol: String,
    val briefing: String,
    val autoPrompt: String = "",   // 有值時:開對話後自動送出這句問題
)
