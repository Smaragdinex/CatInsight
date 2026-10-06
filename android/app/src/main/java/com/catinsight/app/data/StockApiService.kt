package com.catinsight.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import android.util.Log
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class StockApiException(message: String) : Exception(message)

/** 對應 iOS StockAPIService。所有方法皆為 suspend,在 IO 執行緒執行。 */
class StockApiService(private val baseUrl: String = "https://api.example.com") {   // 部署時改成自己的後端網址

    companion object {
        val json = Json {
            ignoreUnknownKeys = true
            isLenient = true
            explicitNulls = false
            coerceInputValues = true
        }
        val default by lazy { StockApiService() }
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    private fun enc(v: String): String = URLEncoder.encode(v, "UTF-8").replace("+", "%20")

    suspend fun fetchStock(symbol: String, period: String): StockResponse =
        get("/stock/${enc(symbol)}?period=$period")

    /** 圖表專用序列(1D 5 分鐘、1W 15 分鐘、1M 每小時、其餘每日)。 */
    suspend fun fetchChart(symbol: String, period: String): StockResponse =
        get("/chart/${enc(symbol)}?period=$period")

    suspend fun fetchQuote(symbol: String): QuoteResponse = get("/quote/${enc(symbol)}")

    suspend fun search(query: String, limit: Int = 8): SearchResponse =
        get("/search?q=${enc(query)}&limit=$limit")

    suspend fun fetchRatings(symbol: String): RatingsResponse = get("/ratings/${enc(symbol)}")

    suspend fun fetchValuation(symbol: String): ValuationResponse = get("/valuation/${enc(symbol)}")

    suspend fun fetchEarnings(symbol: String, limit: Int = 5): EarningsResponse =
        get("/earnings/${enc(symbol)}?limit=$limit")

    suspend fun fetchNews(symbol: String, limit: Int = 12): NewsResponse =
        get("/news/${enc(symbol)}?limit=$limit")

    suspend fun fetchLLMTomorrow(symbol: String, languageCode: String): LLMTomorrowResponse =
        get("/llm-tomorrow/${enc(symbol)}?lang=$languageCode")

    suspend fun fetchWatchlist(symbols: List<String>): WatchlistBatchResponse =
        get("/watchlist?symbols=${enc(symbols.joinToString(","))}")

    suspend fun fetchRanking(top: Int = 20): RankingResponse = get("/ranking?top=$top")

    suspend fun fetchHealth(symbol: String): HealthResponse = get("/health/${enc(symbol)}")

    suspend fun fetchTopGainers(top: Int = 20, window: String = "1y", live: Boolean = true): TopGainersResponse =
        get("/top-gainers?top=$top&window=$window&live=${if (live) 1 else 0}")

    suspend fun fetchSignals(symbol: String, period: Int = 14, fast: Int = 12, slow: Int = 26, signal: Int = 9): SignalsResponse =
        get("/signals/${enc(symbol)}?period=$period&fast=$fast&slow=$slow&signal=$signal")

    suspend fun fetchAIReport(symbol: String, languageCode: String): AIReportResponse =
        get("/api/ai/report/${enc(symbol)}?lang=$languageCode", timeoutSec = 180)   // 本地 LLM 冷啟動+生成較慢

    suspend fun sendAIChat(symbol: String, languageCode: String, messages: List<AIChatMessage>, watchlist: List<String> = emptyList()): AIChatResponse {
        val payload = buildJsonObject {
            put("symbol", symbol)
            put("lang", languageCode)
            put("messages", buildJsonArray {
                messages.forEach { m -> add(buildJsonObject { put("role", m.role); put("content", m.content) }) }
            })
            put("watchlist", buildJsonArray { watchlist.forEach { add(JsonPrimitive(it)) } })
        }
        return post("/api/ai/chat", payload, timeoutSec = 180)
    }

    /**
     * 對應 iOS streamAIChat:POST /api/ai/chat/stream,回應是 NDJSON,
     * 每行 {"t":"片段"},最後一行 {"done":true,"reply":"全文","source":"模型","error":"(可選)"}。
     * 回傳 Flow<String>,每個元素是一段文字;收集端取消時會一併取消 OkHttp call(阻塞中的讀取立刻中斷)。
     * 最後一行帶 error 時以 StockApiException 結束 Flow。
     */
    fun streamAIChat(
        symbol: String, languageCode: String, messages: List<AIChatMessage>,
        watchlist: List<String> = emptyList(), voice: Boolean = true,
    ): Flow<String> = callbackFlow {
        val payload = buildJsonObject {
            put("symbol", symbol)
            put("lang", languageCode)
            put("voice", voice)
            put("messages", buildJsonArray {
                messages.forEach { m -> add(buildJsonObject { put("role", m.role); put("content", m.content) }) }
            })
            put("watchlist", buildJsonArray { watchlist.forEach { add(JsonPrimitive(it)) } })
        }
        val body = payload.toString().toRequestBody("application/json".toMediaType())
        val req = Request.Builder().url("$baseUrl/api/ai/chat/stream").post(body).build()
        val call = client.newBuilder()
            .readTimeout(180, TimeUnit.SECONDS).writeTimeout(180, TimeUnit.SECONDS)
            .build().newCall(req)

        launch(Dispatchers.IO) {
            try {
                call.execute().use { resp ->
                    val src = resp.body?.source() ?: throw StockApiException("Empty body")
                    if (!resp.isSuccessful) {
                        // 錯誤時整包讀完,盡量取出後端的 error 訊息
                        val text = runCatching { src.readUtf8() }.getOrDefault("")
                        val apiError = runCatching { json.decodeFromString<APIErrorResponse>(text) }.getOrNull()
                        throw StockApiException(apiError?.error ?: "HTTP error ${resp.code}")
                    }
                    // 逐行讀(不要 .string(),那會等整個回應結束)
                    while (true) {
                        val line = src.readUtf8Line() ?: break
                        if (line.isBlank()) continue
                        val obj = runCatching { json.parseToJsonElement(line).jsonObject }.getOrNull() ?: continue
                        val t = obj["t"]?.jsonPrimitive?.contentOrNull
                        if (!t.isNullOrEmpty()) send(t)
                        if (obj["done"]?.jsonPrimitive?.booleanOrNull == true) {
                            val err = obj["error"]?.jsonPrimitive?.contentOrNull
                            if (!err.isNullOrEmpty()) throw StockApiException(err)
                            break
                        }
                    }
                }
                close()
            } catch (e: Exception) {
                // 收集端取消 → call 已被 cancel,不算錯誤
                if (call.isCanceled()) close()
                else {
                    Log.w("StockApi", "POST /api/ai/chat/stream failed: ${e::class.simpleName}: ${e.message}")
                    close(e)
                }
            }
        }
        awaitClose { call.cancel() }
    }

    suspend fun fetchAIAnalysis(payload: JsonObject): AIAnalysisResponse = post("/api/ai/analyze", payload)

    // ---- 內部 ----

    private suspend inline fun <reified T> get(path: String, timeoutSec: Long = 60): T = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(baseUrl + path).get().build()
        execute(req, timeoutSec)
    }

    private suspend inline fun <reified T> post(path: String, payload: JsonElement, timeoutSec: Long = 60): T = withContext(Dispatchers.IO) {
        val body = payload.toString().toRequestBody("application/json".toMediaType())
        val req = Request.Builder().url(baseUrl + path).post(body).build()
        execute(req, timeoutSec)
    }

    private inline fun <reified T> execute(req: Request, timeoutSec: Long): T {
        val c = if (timeoutSec == 60L) client else client.newBuilder()
            .readTimeout(timeoutSec, TimeUnit.SECONDS).writeTimeout(timeoutSec, TimeUnit.SECONDS).build()
        try {
            return executeInner<T>(c, req)
        } catch (e: Exception) {
            Log.w("StockApi", "${req.method} ${req.url.encodedPath} failed: ${e::class.simpleName}: ${e.message}")
            throw e
        }
    }

    private inline fun <reified T> executeInner(c: OkHttpClient, req: Request): T {
        c.newCall(req).execute().use { resp ->
            val text = resp.body?.string() ?: ""
            val apiError = runCatching { json.decodeFromString<APIErrorResponse>(text) }.getOrNull()
            if (!resp.isSuccessful) {
                if (apiError != null) throw StockApiException(apiError.error)
                throw StockApiException("HTTP error ${resp.code}")
            }
            if (apiError != null) throw StockApiException(apiError.error)
            return json.decodeFromString<T>(text)
        }
    }
}
