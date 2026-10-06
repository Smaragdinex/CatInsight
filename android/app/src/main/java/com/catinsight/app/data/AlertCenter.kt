package com.catinsight.app.data

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.compose.runtime.mutableStateListOf
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.Locale

/** 本機儲存價格/技術提醒 + 評估觸發 + 發本機通知(對應 iOS AlertCenter)。 */
object AlertCenter {
    private const val KEY = "stock.alerts.v1"
    private const val CHANNEL = "stock_alerts"
    val alerts = mutableStateListOf<StockAlert>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val api = StockApiService.default
    private lateinit var appContext: Context

    fun init(context: Context) {
        appContext = context.applicationContext
        alerts.clear()
        Prefs.getJson<List<StockAlert>>(KEY)?.let { alerts.addAll(it) }
        val nm = appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Stock alerts", NotificationManager.IMPORTANCE_DEFAULT))
    }

    private fun persist() = Prefs.putJson(KEY, alerts.toList())

    fun alertsFor(symbol: String): List<StockAlert> = alerts.filter { it.symbol == symbol.uppercase() }
    fun add(a: StockAlert) { alerts.add(a); persist() }
    fun update(a: StockAlert) { val i = alerts.indexOfFirst { it.id == a.id }; if (i >= 0) { alerts[i] = a; persist() } }
    fun delete(a: StockAlert) { alerts.removeAll { it.id == a.id }; persist() }
    fun hasAlerts(symbol: String) = alerts.any { it.symbol == symbol.uppercase() && it.enabled }

    /** Android 13+ 需要 POST_NOTIFICATIONS 執行期權限。 */
    fun requestAuthorization(activity: Activity) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
        }
    }

    private fun notify(title: String, body: String) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(appContext, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val n = NotificationCompat.Builder(appContext, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle(title).setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true).build()
        (appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify((System.currentTimeMillis() % Int.MAX_VALUE).toInt(), n)
    }

    private fun fmt(v: Double) = String.format(Locale.US, "%.2f", v)

    /** 抓該股訊號,比對其啟用中的提醒,觸發則發通知並記錄(12 小時內不重複)。 */
    fun evaluate(symbol: String, isZh: Boolean) {
        val sym = symbol.uppercase()
        val mine = alertsFor(sym).filter { it.enabled }
        if (mine.isEmpty()) return
        scope.launch {
            for (a in mine) {
                val last = a.lastTriggered
                if (last != null && System.currentTimeMillis() - last < 12 * 3600_000L) continue
                val period = when (a.metric) {
                    AlertMetric.RSI, AlertMetric.MA -> a.period ?: (if (a.metric == AlertMetric.MA) 10 else 14)
                    AlertMetric.VWAP -> 20
                    else -> 14
                }
                val f = a.fastPeriod ?: 12; val sl = a.slowPeriod ?: 26; val sg = a.signalPeriod ?: 9
                val sig = runCatching { api.fetchSignals(sym, period, f, sl, sg) }.getOrNull() ?: continue
                var hit = false
                var msg = ""
                val above = a.direction == AlertDirection.ABOVE
                when (a.metric) {
                    AlertMetric.PRICE -> sig.price?.let { p ->
                        hit = if (above) p >= a.target else p <= a.target
                        if (hit) msg = if (isZh) "$sym 價格 ${fmt(p)} ${if (above) "突破" else "跌破"} ${fmt(a.target)}"
                                       else "$sym price ${fmt(p)} ${if (above) "rose above" else "fell below"} ${fmt(a.target)}"
                    }
                    AlertMetric.RSI -> sig.rsi?.let { r ->
                        hit = if (above) r >= a.target else r <= a.target
                        if (hit) msg = if (isZh) "$sym RSI ${r.toInt()} ${if (above) "高於" else "低於"} ${a.target.toInt()}"
                                       else "$sym RSI ${r.toInt()} ${if (above) "above" else "below"} ${a.target.toInt()}"
                    }
                    AlertMetric.MA -> if (sig.price != null && sig.ma != null) {
                        val p = sig.price; val m = sig.ma
                        hit = if (above) p >= m else p <= m
                        if (hit) msg = if (isZh) "$sym 價格 ${fmt(p)} ${if (above) "突破" else "跌破"} MA($period) ${fmt(m)}"
                                       else "$sym price ${fmt(p)} ${if (above) "above" else "below"} MA($period) ${fmt(m)}"
                    }
                    AlertMetric.VWAP -> if (sig.price != null && sig.vwap != null) {
                        val p = sig.price; val w = sig.vwap
                        hit = if (above) p >= w else p <= w
                        if (hit) msg = if (isZh) "$sym 價格 ${fmt(p)} ${if (above) "高於" else "低於"} VWAP ${fmt(w)}"
                                       else "$sym price ${fmt(p)} ${if (above) "above" else "below"} VWAP ${fmt(w)}"
                    }
                    AlertMetric.MACD -> if (sig.macd != null && sig.macdSignal != null) {
                        val m = sig.macd; val s = sig.macdSignal
                        hit = if (above) m >= s else m <= s
                        if (hit) msg = if (isZh) "$sym MACD ${if (above) "黃金交叉(轉多)" else "死亡交叉(轉空)"}"
                                       else "$sym MACD ${if (above) "bullish cross" else "bearish cross"}"
                    }
                    AlertMetric.MONEY_OUTFLOW -> if (sig.moneyOutflow == true) {
                        hit = true
                        msg = if (isZh) "$sym 偵測到大戶出金(資金流出)" else "$sym big-money outflow detected"
                    }
                }
                if (hit) {
                    notify(if (isZh) "📈 股價提醒" else "📈 Stock alert", msg)
                    update(a.copy(lastTriggered = System.currentTimeMillis()))
                }
            }
        }
    }
}
