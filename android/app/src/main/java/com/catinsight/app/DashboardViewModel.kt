package com.catinsight.app

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.catinsight.app.data.*
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.Date
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * 對應 iOS DashboardViewModel(@Published → mutableStateOf)。
 * 另外把 iOS ContentView 裡的大盤指數 / AI 精選排名 / 漲幅榜狀態也收進來,方便各畫面共用。
 */
@OptIn(FlowPreview::class)
class DashboardViewModel(private val api: StockApiService = StockApiService.default) : ViewModel() {

    var stockInfo by mutableStateOf<StockResponse?>(null)
    /** 圖表專用序列(來自 /chart,較細的 K 線間隔);指標與歷史明細仍用 stockInfo。 */
    var chartInfo by mutableStateOf<StockResponse?>(null)
    var liveQuote by mutableStateOf<QuoteResponse?>(null)
    var isLoading by mutableStateOf(false)
    var quoteLoading by mutableStateOf(false)
    var errorMessage by mutableStateOf<String?>(null)
    var symbol by mutableStateOf("")
    var searchQuery by mutableStateOf("")
    var selectedPeriod by mutableStateOf("1mo")
    var searchResults by mutableStateOf<List<SearchResult>>(emptyList())
    var newsItems by mutableStateOf<List<NewsItem>>(emptyList())
    var newsLoading by mutableStateOf(false)
    var ratings by mutableStateOf<RatingsResponse?>(null)
    var earningsItems by mutableStateOf<List<EarningsItem>>(emptyList())
    var nextEarningsDateText by mutableStateOf<String?>(null)
    var nextEarningsTiming by mutableStateOf<String?>(null)
    var llmTomorrow by mutableStateOf<LLMTomorrowResponse?>(null)
    var isLLMTomorrowLoading by mutableStateOf(false)
    var valuation by mutableStateOf<ValuationResponse?>(null)
    var selectedValuationScenario by mutableStateOf("base")
    var watchlistQuotes by mutableStateOf<Map<String, WatchlistQuote>>(emptyMap())
    var aiAnalysis by mutableStateOf<AIAnalysisResponse?>(null)

    // ---- 原本在 iOS ContentView 的首頁狀態 ----
    var marketIndexQuotes by mutableStateOf<Map<String, WatchlistQuote>>(emptyMap())
    var rankingItems by mutableStateOf<List<RankingItem>>(emptyList())
    var rankingAsOf by mutableStateOf<String?>(null)
    var gainerItems by mutableStateOf<List<GainerItem>>(emptyList())
    var gainersAsOf by mutableStateOf<String?>(null)
    private val gainerWindowState = mutableStateOf("1y")   // "1y" 近一年(預設) / "ytd" 今年
    val gainerWindow: String get() = gainerWindowState.value

    // 上排:最重要的大盤指數;下排:其餘。兩排各自獨立左右滑動。
    val marketIndicesTop = listOf(
        MarketIndexItem("^GSPC", "S&P 500"), MarketIndexItem("^IXIC", "NASDAQ"), MarketIndexItem("^NDX", "NASDAQ 100"),
        MarketIndexItem("^DJI", "Dow Jones"), MarketIndexItem("^RUT", "Russell 2000"),
    )
    val marketIndicesBottom = listOf(
        MarketIndexItem("BTC-USD", "Bitcoin"), MarketIndexItem("CL=F", "Crude Oil"), MarketIndexItem("GC=F", "Gold"),
        MarketIndexItem("DX-Y.NYB", "US Dollar"), MarketIndexItem("^VIX", "VIX"), MarketIndexItem("^SOX", "PHLX SOX"),
        MarketIndexItem("^TNX", "TNX"),
    )
    val marketIndices get() = marketIndicesTop + marketIndicesBottom

    private val watchlistCacheKey = "watchlist.quotes.cache"
    private var aiRefreshJob: Job? = null
    private var quoteRefreshJob: Job? = null
    private var watchlistRefreshJob: Job? = null
    private val searchCache = LinkedHashMap<String, List<SearchResult>>()
    private val ratingsCache = HashMap<String, Pair<Long, RatingsResponse>>()
    private val valuationCache = HashMap<String, Pair<Long, ValuationResponse>>()
    private val earningsCache = HashMap<String, Pair<Long, EarningsResponse>>()
    private val newsCache = HashMap<String, Pair<Long, List<NewsItem>>>()
    private val llmTomorrowCache = HashMap<String, Pair<Long, LLMTomorrowResponse>>()
    private var watchlistLastLoadedAt: Long? = null

    private fun now() = System.currentTimeMillis()
    private fun fresh(ts: Long, sec: Long = 300) = now() - ts < sec * 1000

    init {
        restoreCachedWatchlistQuotes()
        viewModelScope.launch {
            snapshotFlow { searchQuery }.distinctUntilChanged().debounce(120).collectLatest { performSearch(it) }
        }
    }

    fun normalizedSymbolInput(raw: String) = raw.trim().uppercase()

    suspend fun performSearch(query: String) {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) { searchResults = emptyList(); return }
        val cacheKey = trimmed.uppercase()
        searchCache[cacheKey]?.let { searchResults = it; return }
        try {
            val decoded = api.search(trimmed, 8)
            searchResults = decoded.results
            searchCache[cacheKey] = decoded.results
            if (searchCache.size > 50) searchCache.remove(searchCache.keys.first())
        } catch (_: Exception) {
            searchResults = emptyList()
        }
    }

    fun refreshAllData(symbolOverride: String? = null, languageCode: String) {
        val target = normalizedSymbolInput(symbolOverride ?: symbol)
        if (target.isEmpty()) {
            errorMessage = if (languageCode == "zh") "請輸入股票代號" else "Please enter a stock symbol"
            stockInfo = null; liveQuote = null
            return
        }
        symbol = target
        isLoading = true
        errorMessage = null
        searchResults = emptyList()
        ratings = null; valuation = null
        earningsItems = emptyList(); nextEarningsDateText = null; nextEarningsTiming = null
        newsItems = emptyList(); newsLoading = false
        aiAnalysis = null
        if (chartInfo?.stock?.uppercase() != target) chartInfo = null
        aiRefreshJob?.cancel()

        viewModelScope.launch {
            try {
                val stockD = async { api.fetchStock(target, selectedPeriod) }
                val quoteD = async { api.fetchQuote(target) }
                val stock = stockD.await()
                val quote = quoteD.await()
                stockInfo = stock
                liveQuote = quote
                symbol = stock.stock
                isLoading = false
                startQuoteAutoRefresh(target)
                launch { fetchChart(target) }
            } catch (e: Exception) {
                isLoading = false
                errorMessage = e.message ?: "Unknown error"
                stockInfo = null
                return@launch
            }

            launch {
                val a = async { fetchRatings(target) }
                val b = async { fetchValuation(target) }
                val c = async { fetchEarnings(target) }
                val d = async { fetchNews(target) }
                a.await(); b.await(); c.await(); d.await()
            }

            aiRefreshJob = launch {
                llmTomorrow = null
                aiAnalysis = null
                isLLMTomorrowLoading = true
                fetchLLMTomorrow(target, languageCode)
                if (!isActive) return@launch
                fetchAIAnalysis(target, languageCode)
            }
        }
    }

    suspend fun fetchChart(rawSymbol: String? = null) {
        val clean = normalizedSymbolInput(rawSymbol ?: symbol)
        if (clean.isEmpty()) { chartInfo = null; return }
        val period = selectedPeriod
        runCatching { api.fetchChart(clean, period) }.getOrNull()?.let { if (period == selectedPeriod) chartInfo = it }
    }

    suspend fun fetchRatings(rawSymbol: String? = null) {
        val clean = normalizedSymbolInput(rawSymbol ?: symbol)
        if (clean.isEmpty()) { ratings = null; return }
        ratingsCache[clean]?.takeIf { fresh(it.first) }?.let { ratings = it.second; return }
        runCatching { api.fetchRatings(clean) }.getOrNull()?.let { ratings = it; ratingsCache[clean] = now() to it }
    }

    suspend fun fetchValuation(rawSymbol: String? = null) {
        val clean = normalizedSymbolInput(rawSymbol ?: symbol)
        if (clean.isEmpty()) { valuation = null; return }
        val cached = valuationCache[clean]?.takeIf { fresh(it.first) }?.second
        val decoded = cached ?: runCatching { api.fetchValuation(clean) }.getOrNull() ?: return
        valuation = decoded
        if (cached == null) valuationCache[clean] = now() to decoded
        if (decoded.scenarios.none { it.id == selectedValuationScenario }) {
            decoded.scenarios.firstOrNull()?.let { selectedValuationScenario = it.id }
        }
    }

    suspend fun fetchEarnings(rawSymbol: String? = null) {
        val clean = normalizedSymbolInput(rawSymbol ?: symbol)
        if (clean.isEmpty()) { earningsItems = emptyList(); nextEarningsDateText = null; nextEarningsTiming = null; return }
        val cached = earningsCache[clean]?.takeIf { fresh(it.first) }?.second
        val decoded = cached ?: runCatching { api.fetchEarnings(clean, 5) }.getOrNull() ?: return
        earningsItems = decoded.items
        nextEarningsDateText = decoded.nextEarningsDate
        nextEarningsTiming = decoded.earningsTiming
        if (cached == null) earningsCache[clean] = now() to decoded
    }

    suspend fun fetchNews(rawSymbol: String? = null) {
        val clean = normalizedSymbolInput(rawSymbol ?: symbol)
        if (clean.isEmpty()) { newsItems = emptyList(); return }
        newsCache[clean]?.takeIf { fresh(it.first) }?.let { newsItems = it.second; newsLoading = false; return }
        newsLoading = true
        try {
            val response = api.fetchNews(clean, 12)
            val valid = response.items.filter { it.title.trim().isNotEmpty() }
            val sorted = valid.sortedByDescending { it.publishedDate?.time ?: Long.MIN_VALUE }
            val companyName = liveQuote?.companyName ?: stockInfo?.stock ?: clean
            val filtered = sorted.filter { isRelevantNewsItem(it, clean, companyName) }
            val finalItems = when {
                filtered.isEmpty() -> sorted
                filtered.size >= 3 -> filtered
                else -> {
                    val ids = filtered.map { it.id }.toSet()
                    filtered + sorted.filter { it.id !in ids }
                }
            }
            newsItems = finalItems
            newsCache[clean] = now() to finalItems
        } catch (_: Exception) {
            newsItems = emptyList()
        } finally {
            newsLoading = false
        }
    }

    suspend fun fetchLLMTomorrow(rawSymbol: String? = null, languageCode: String, forceRefresh: Boolean = false) {
        val clean = normalizedSymbolInput(rawSymbol ?: symbol)
        val cacheKey = "$clean|$languageCode"
        if (clean.isEmpty()) { llmTomorrow = null; isLLMTomorrowLoading = false; return }
        if (!forceRefresh) {
            llmTomorrowCache[cacheKey]?.takeIf { fresh(it.first) }?.let { llmTomorrow = it.second; isLLMTomorrowLoading = false; return }
        }
        if (llmTomorrow?.stock?.uppercase() != clean) llmTomorrow = null
        isLLMTomorrowLoading = true
        try {
            val decoded = api.fetchLLMTomorrow(clean, languageCode)
            llmTomorrow = decoded
            llmTomorrowCache[cacheKey] = now() to decoded
        } catch (_: Exception) {
        } finally {
            isLLMTomorrowLoading = false
        }
    }

    private fun isRelevantNewsItem(item: NewsItem, symbol: String, companyName: String): Boolean {
        val haystack = listOf(item.title, item.summary ?: "").joinToString(" ").lowercase()
        val tokens = newsMatchTokens(symbol, companyName)
        val blocked = newsBlockedTokens(symbol)
        val positive: Int = tokens.map { t -> if (t.isEmpty()) 0 else if (haystack.contains(t)) (if (t == symbol.lowercase()) 3 else 2) else 0 }.sum()
        val negative: Int = blocked.map { t -> if (haystack.contains(t)) 3 else 0 }.sum()
        return positive > 0 && positive >= negative
    }

    private fun newsMatchTokens(symbol: String, companyName: String): List<String> {
        val lowerSymbol = symbol.lowercase(); val lowerName = companyName.lowercase()
        val tokens = mutableSetOf(lowerSymbol, lowerName)
        lowerName.replace(",", " ").replace(".", " ").split(" ")
            .filter { it.length >= 4 && it !in setOf("inc", "corp", "ltd", "technology", "holdings", "group", "class") }
            .forEach { tokens.add(it) }
        val specific = mapOf("nvda" to listOf("nvidia", "jensen huang", "blackwell", "gpu"))
        specific[lowerSymbol]?.forEach { tokens.add(it) }
        return tokens.toList()
    }

    private fun newsBlockedTokens(symbol: String): List<String> = when (symbol.lowercase()) {
        "alab" -> listOf("marvell", "mrvl", "micron", "mu", "nvidia", "nvda", "broadcom", "avgo")
        "mrvl" -> listOf("micron", "mu", "maxim", "mxim", "美信")
        "mu" -> listOf("marvell", "mrvl", "maxim", "mxim")
        else -> emptyList()
    }

    suspend fun fetchAIAnalysis(rawSymbol: String? = null, languageCode: String, forceRefresh: Boolean = false) {
        val clean = normalizedSymbolInput(rawSymbol ?: symbol)
        if (clean.isEmpty()) { aiAnalysis = null; return }
        val companyName = liveQuote?.companyName ?: stockInfo?.stock ?: clean
        val currentPrice = liveQuote?.regularPrice ?: liveQuote?.displayPrice ?: liveQuote?.price ?: stockInfo?.data?.lastOrNull()?.price
        val prices = stockInfo?.data?.takeLast(20) ?: emptyList()
        val sequence = buildJsonArray {
            prices.forEachIndexed { index, item ->
                val prevClose = if (index > 0) prices[index - 1].price else null
                val return1d = prevClose?.takeIf { it > 0 }?.let { item.price / it - 1.0 }
                val start = maxOf(0, index - 4)
                val window = prices.subList(start, index + 1).map { it.price }
                val ma5 = if (window.isEmpty()) null else window.sum() / window.size
                val volatility5d: Double? = if (window.size >= 3) {
                    val base = prices.subList(maxOf(0, index - 5), index).map { it.price }
                    val combined = base + item.price
                    val returns = combined.drop(1).zip(combined).map { (curr, prev) -> curr / prev - 1.0 }
                    if (returns.isEmpty()) null else {
                        val mean = returns.sum() / returns.size
                        sqrt(returns.sumOf { (it - mean).pow(2) } / returns.size)
                    }
                } else null
                add(buildJsonObject {
                    put("date", item.date); put("close", item.price)
                    put("high", item.high?.let { JsonPrimitive(it) } ?: JsonNull)
                    put("low", item.low?.let { JsonPrimitive(it) } ?: JsonNull)
                    put("volume", item.volume?.let { JsonPrimitive(it) } ?: JsonNull)
                    put("ma5", ma5?.let { JsonPrimitive(it) } ?: JsonNull)
                    put("return1d", return1d?.let { JsonPrimitive(it) } ?: JsonNull)
                    put("volatility5d", volatility5d?.let { JsonPrimitive(it) } ?: JsonNull)
                })
            }
        }
        val llm = llmTomorrow
        val payload = buildJsonObject {
            put("symbol", clean); put("companyName", companyName)
            put("language", if (languageCode == "zh") "zh-TW" else "en-US")
            put("currentPrice", currentPrice?.let { JsonPrimitive(it) } ?: JsonNull)
            put("predictedLow", llm?.predictedLow?.let { JsonPrimitive(it) } ?: JsonNull)
            put("predictedHigh", llm?.predictedHigh?.let { JsonPrimitive(it) } ?: JsonNull)
            put("bias", llm?.bias?.let { JsonPrimitive(it) } ?: JsonNull)
            put("confidence", llm?.confidence?.let { JsonPrimitive(it) } ?: JsonNull)
            put("technicalSummary", llm?.summary?.let { JsonPrimitive(it) } ?: JsonNull)
            put("newsImpact", llm?.newsImpact?.let { JsonPrimitive(it) } ?: JsonNull)
            put("newsSummary", llm?.newsSummary?.let { JsonPrimitive(it) } ?: JsonNull)
            put("indicators", buildJsonObject {
                put("rsi", stockInfo?.rsi?.let { JsonPrimitive(it) } ?: JsonNull)
                put("mfi", stockInfo?.mfi?.let { JsonPrimitive(it) } ?: JsonNull)
                put("signal", stockInfo?.signal?.let { JsonPrimitive(it) } ?: JsonNull)
            })
            put("sequence", sequence)
            put("marketContext", "")
        }
        aiAnalysis = runCatching { api.fetchAIAnalysis(payload) }.getOrNull()
    }

    private fun restoreCachedWatchlistQuotes() {
        Prefs.getJson<Map<String, WatchlistQuote>>(watchlistCacheKey)?.let { watchlistQuotes = it }
    }

    private fun persistWatchlistQuotes() = Prefs.putJson(watchlistCacheKey, watchlistQuotes)

    fun refreshWatchlistQuotes(symbols: List<String>, force: Boolean = false) {
        if (symbols.isEmpty()) {
            watchlistQuotes = emptyMap(); watchlistLastLoadedAt = null; persistWatchlistQuotes(); return
        }
        val last = watchlistLastLoadedAt
        if (!force && last != null && now() - last < 30_000 && watchlistQuotes.isNotEmpty()) return
        viewModelScope.launch {
            runCatching { api.fetchWatchlist(symbols) }.getOrNull()?.let { decoded ->
                val quotes = HashMap<String, WatchlistQuote>()
                decoded.basicItems?.forEach { quotes[it.symbol] = WatchlistQuote(it.symbol, it.symbol, it.name, it.price, it.previousClose, it.change, emptyList()) }
                decoded.items.forEach { quotes[it.symbol] = WatchlistQuote(it.symbol, it.symbol, it.name, it.price, it.previousClose, it.change, it.sparkline) }
                watchlistQuotes = quotes
                watchlistLastLoadedAt = now()
                persistWatchlistQuotes()
            }
        }
    }

    fun startQuoteAutoRefresh(symbol: String) {
        stopQuoteAutoRefresh()
        quoteRefreshJob = viewModelScope.launch {
            while (isActive) {
                delay(20_000)
                if (!isActive) break
                quoteLoading = true
                runCatching { api.fetchQuote(symbol) }.getOrNull()?.let { liveQuote = it }
                quoteLoading = false
            }
        }
    }

    fun stopQuoteAutoRefresh() { quoteRefreshJob?.cancel(); quoteRefreshJob = null }

    fun startWatchlistAutoRefresh(symbols: List<String>) {
        stopWatchlistAutoRefresh()
        if (symbols.isEmpty()) return
        watchlistRefreshJob = viewModelScope.launch {
            while (isActive) {
                delay(10_000)
                if (!isActive) break
                refreshWatchlistQuotes(symbols, force = true)
            }
        }
    }

    fun stopWatchlistAutoRefresh() { watchlistRefreshJob?.cancel(); watchlistRefreshJob = null }

    // ---- 首頁:大盤指數 / AI 精選 / 漲幅榜(對應 iOS ContentView 的 refreshMarketIndices/loadRanking/loadTopGainers) ----

    fun refreshMarketIndices() {
        viewModelScope.launch {
            runCatching { api.fetchWatchlist(marketIndices.map { it.symbol }) }.getOrNull()?.let { decoded ->
                val quotes = HashMap<String, WatchlistQuote>()
                decoded.basicItems?.forEach { quotes[it.symbol] = WatchlistQuote(it.symbol, it.symbol, it.name, it.price, it.previousClose, it.change, emptyList()) }
                decoded.items.forEach { quotes[it.symbol] = WatchlistQuote(it.symbol, it.symbol, it.name, it.price, it.previousClose, it.change, it.sparkline) }
                marketIndexQuotes = quotes
            }
        }
    }

    fun loadRanking() {
        viewModelScope.launch {
            runCatching { api.fetchRanking(20) }.getOrNull()?.let { rankingItems = it.items; rankingAsOf = it.asOf }
        }
    }

    /** 保留舊內容直到新資料到,避免整區閃爍/版面跳動。 */
    fun loadTopGainers() {
        val window = gainerWindow
        viewModelScope.launch {
            runCatching { api.fetchTopGainers(20, window) }.getOrNull()?.let {
                if (gainerWindow == window) { gainerItems = it.items; gainersAsOf = it.asOf }
            }
        }
    }

    fun setGainerWindow(window: String) {
        if (gainerWindow == window) return
        gainerWindowState.value = window
        loadTopGainers()
    }

    override fun onCleared() {
        quoteRefreshJob?.cancel(); watchlistRefreshJob?.cancel(); aiRefreshJob?.cancel()
    }
}
