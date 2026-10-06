package com.catinsight.app.ui.screens.detail

import android.icu.text.DisplayContext
import android.icu.text.RelativeDateTimeFormatter
import android.icu.util.ULocale
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import com.catinsight.app.DashboardViewModel
import com.catinsight.app.data.ChartPoint
import com.catinsight.app.data.StockData
import com.catinsight.app.data.StockDateParser
import com.catinsight.app.data.StockResponse
import com.catinsight.app.ui.theme.AppColors
import com.catinsight.app.ui.theme.AppSettings
import com.catinsight.app.ui.theme.AppTheme
import com.catinsight.app.ui.theme.CopySet
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs

/** iOS 系統字級對照(pt → sp)。 */
internal object IosFont {
    val title2 = 22.sp
    val title3 = 20.sp
    val headline = 17.sp
    val body = 17.sp
    val subheadline = 15.sp
    val caption = 12.sp
    val caption2 = 11.sp
}

/** iOS 系統紫色(深色模式值),AppColors 沒有提供。 */
internal val iosPurple = Color(0xFFBF5AF2)

/**
 * 對應 iOS ContentView 內個股詳情頁用到的輔助 computed property / func。
 * 所有值都直接讀 ViewModel 的 snapshot state,在 composition 內取值即可觸發重組。
 */
internal class DetailContext(val vm: DashboardViewModel, val s: AppSettings) {
    val text: CopySet get() = s.text
    val theme: AppTheme get() = s.theme
    private val displayLocale: Locale get() = if (s.isZh) Locale.TAIWAN else Locale.US

    // MARK: - 代號 / 價格

    val currentResolvedSymbol: String
        get() = (vm.liveQuote?.stock ?: vm.stockInfo?.stock ?: vm.symbol).uppercase()

    val isTaiwanSymbol: Boolean
        get() = currentResolvedSymbol.endsWith(".TW") || currentResolvedSymbol.endsWith(".TWO")

    val latestHistoryPrice: Double?
        get() = vm.stockInfo?.data?.lastOrNull()?.price

    /** 依盤別挑選最合適的即時價。 */
    val preferredLivePrice: Double?
        get() {
            // iOS:liveQuote 為 nil 時 session 走 default 分支,所有欄位皆 nil → 回傳 nil
            val q = vm.liveQuote ?: return null
            return when (q.session) {
                "pre", "post" -> q.extendedPrice ?: q.displayPrice ?: q.price
                "regular" -> q.regularPrice ?: q.displayPrice ?: q.price
                else -> q.displayPrice ?: q.extendedPrice ?: q.regularPrice ?: q.price
            }
        }

    /** 與歷史資料同步的顯示價格(歷史最新一筆優先)。 */
    val syncedDisplayPrice: Double?
        get() {
            latestHistoryPrice?.let { return it }
            if (isTaiwanSymbol) {
                return vm.liveQuote?.displayPrice ?: vm.liveQuote?.regularPrice ?: vm.liveQuote?.price
            }
            vm.watchlistQuotes[currentResolvedSymbol]?.price?.let { return it }
            return preferredLivePrice
        }

    /** (漲跌, 漲跌幅 %),以昨收為基準。 */
    val syncedChangeMetrics: Pair<Double, Double>?
        get() {
            val latest = syncedDisplayPrice ?: return null
            val previousClose = vm.liveQuote?.previousClose ?: return null
            if (previousClose == 0.0) return null
            val change = latest - previousClose
            return change to (change / previousClose) * 100
        }

    fun priceColorFor(item: StockData): Color {
        vm.liveQuote?.previousClose?.let { previousClose ->
            val delta = item.price - previousClose
            if (delta > 0) return s.risingColor()
            if (delta < 0) return s.fallingColor()
        }
        return theme.primaryText
    }

    fun quotePriceColor(info: StockResponse): Color {
        syncedChangeMetrics?.let { return s.changeColor(it.first) }
        vm.liveQuote?.change?.let { return s.changeColor(it) }
        info.data.lastOrNull()?.let { return priceColorFor(it) }
        return theme.primaryText
    }

    val priceLabel: String
        get() {
            if (isTaiwanSymbol) return text.latestPrice
            return when (vm.liveQuote?.session) {
                "pre" -> text.preMarketPrice
                "post" -> text.postMarketPrice
                "regular" -> text.latestPrice
                else -> text.latestPrice
            }
        }

    fun sessionText(session: String): String = when (session) {
        "pre" -> text.preBadge
        "post" -> text.postBadge
        "regular" -> text.regularBadge
        else -> session.uppercase()
    }

    fun sessionBadgeColor(session: String): Color = when (session) {
        "pre" -> AppColors.orange
        "post" -> iosPurple
        "regular" -> AppColors.green
        else -> AppColors.blue
    }

    // MARK: - 圖表

    /** 依日期排序後的歷史資料(附解析後的 Date,避免排序時重複解析字串)。 */
    fun sortedData(info: StockResponse): List<Pair<StockData, Date>> =
        info.data.map { it to it.parsedDate }.sortedBy { it.second }

    fun chartTrendColor(sorted: List<Pair<StockData, Date>>): Color {
        if (vm.selectedPeriod == "1d") {
            syncedChangeMetrics?.let { return s.changeColor(it.first) }
            vm.liveQuote?.change?.let { return s.changeColor(it) }
            return AppColors.green
        }
        val first = sorted.firstOrNull()?.first?.price
        val last = sorted.lastOrNull()?.first?.price
        if (first != null && last != null) return s.changeColor(last - first)
        return AppColors.green
    }

    /** 歷史點 + 即時點合併(台股不加即時點)。 */
    fun mergedChartPoints(sorted: List<Pair<StockData, Date>>): List<ChartPoint> {
        val points = sorted.map { (d, date) -> ChartPoint(date, d.price, d.ma5, false) }.toMutableList()
        if (isTaiwanSymbol) return points
        val livePrice = preferredLivePrice ?: return points
        val lastPoint = points.lastOrNull() ?: return points

        val liveDate = liveDate(lastPoint.date)
        val lastMA5 = points.takeLast(4).map { it.price }
        val liveMA5Base = lastMA5 + livePrice
        val liveMA5 = if (liveMA5Base.size >= 5) liveMA5Base.takeLast(5).sum() / 5 else null

        if (abs(lastPoint.price - livePrice) < 0.0001) {
            points[points.size - 1] = ChartPoint(lastPoint.date, livePrice, lastPoint.ma5, true)
            return points
        }
        points.add(ChartPoint(liveDate, livePrice, liveMA5, true))
        return points
    }

    fun liveDate(after: Date): Date = when (vm.liveQuote?.session) {
        "pre", "post", "regular" -> Date()
        else -> when (vm.selectedPeriod) {
            "1d" -> Date(after.time + 60_000L * 5)
            "5d" -> Date(after.time + 60_000L * 30)
            "5y" -> Date(after.time + 86_400_000L * 7)
            else -> Date(after.time + 86_400_000L)
        }
    }

    fun axisLabel(date: Date): String {
        val pattern = when (vm.selectedPeriod) {
            "1d" -> "HH:mm"
            "5d" -> "M/d"
            "1mo", "3mo", "6mo", "ytd" -> "M/d"
            "1y", "5y" -> "yy/M"
            else -> "M/d"
        }
        return SimpleDateFormat(pattern, displayLocale).format(date)
    }

    fun shortDate(date: String): String = StockDateParser.parse(date)?.let { axisLabel(it) } ?: date

    // MARK: - 文案

    fun newsDateText(date: Date): String = relativeTimeText(date, s.isZh)

    fun localizedSignal(value: String?): String {
        if (value == null) return "-"
        return when (value) {
            "強勢", "Strong" -> text.strongLabel
            "主力出貨", "Distribution" -> text.distributionLabel
            "中性", "Neutral" -> text.neutralLabel
            else -> value
        }
    }

    fun nextEarningsDisplayText(raw: String): String {
        val date = StockDateParser.parse(raw) ?: return raw
        val formatted = SimpleDateFormat("M/d", displayLocale).format(date)
        return if (s.isZh) "預計於 $formatted" else "Expected on $formatted"
    }

    fun localizedEarningsTiming(value: String): String = when (value) {
        "after-hours" -> if (s.isZh) "盤後公布" else "After-hours"
        "before-open" -> if (s.isZh) "開盤前公布" else "Before open"
        else -> value
    }
}

/** 對應 iOS RelativeDateTimeFormatter(unitsStyle = .short),用 ICU 依語言輸出相對時間。 */
internal fun relativeTimeText(date: Date, isZh: Boolean): String {
    val formatter = RelativeDateTimeFormatter.getInstance(
        ULocale(if (isZh) "zh_TW" else "en_US"), null,
        RelativeDateTimeFormatter.Style.SHORT, DisplayContext.CAPITALIZATION_NONE,
    )
    val diffMs = Date().time - date.time
    val absMs = abs(diffMs)
    val minute = 60_000L
    val hour = 3_600_000L
    val day = 86_400_000L
    val (quantity, unit) = when {
        absMs < minute -> (absMs / 1000).toDouble() to RelativeDateTimeFormatter.RelativeUnit.SECONDS
        absMs < hour -> (absMs / minute).toDouble() to RelativeDateTimeFormatter.RelativeUnit.MINUTES
        absMs < day -> (absMs / hour).toDouble() to RelativeDateTimeFormatter.RelativeUnit.HOURS
        absMs < 7 * day -> (absMs / day).toDouble() to RelativeDateTimeFormatter.RelativeUnit.DAYS
        absMs < 30 * day -> (absMs / (7 * day)).toDouble() to RelativeDateTimeFormatter.RelativeUnit.WEEKS
        absMs < 365 * day -> Math.floor(absMs / (30.44 * day)) to RelativeDateTimeFormatter.RelativeUnit.MONTHS
        else -> Math.floor(absMs / (365.25 * day)) to RelativeDateTimeFormatter.RelativeUnit.YEARS
    }
    val direction = if (diffMs >= 0) RelativeDateTimeFormatter.Direction.LAST else RelativeDateTimeFormatter.Direction.NEXT
    return runCatching { formatter.format(quantity, direction, unit) }.getOrElse { date.toString() }
}

/** 對應 iOS ContentView 的 formatted* 函式(畫面專屬)。 */
internal object DetailFmt {
    fun number(value: Double?): String = value?.let { String.format(Locale.US, "%.2f", it) } ?: "-"

    fun eps(value: Double?): String {
        if (value == null) return "-"
        val a = abs(value)
        return when {
            a >= 100 -> String.format(Locale.US, "%.1f", value)
            a >= 10 -> String.format(Locale.US, "%.2f", value)
            a >= 1 -> String.format(Locale.US, "%.3f", value)
            else -> String.format(Locale.US, "%.4f", value)
        }
    }

    fun percent(value: Double?): String = value?.let { String.format(Locale.US, "%.2f%%", it) } ?: "-"

    fun surprise(value: Double?): String {
        if (value == null) return "-"
        val sign = if (value >= 0) "+" else ""
        return sign + String.format(Locale.US, "%.2f", value) + "%"
    }

    fun surpriseColor(value: Double?, theme: AppTheme): Color {
        if (value == null) return theme.secondaryText
        if (value > 0) return AppColors.green
        if (value < 0) return AppColors.red
        return theme.secondaryText
    }

    fun marketCap(value: Double?): String {
        if (value == null) return "-"
        val trillion = 1_000_000_000_000.0
        val billion = 1_000_000_000.0
        val million = 1_000_000.0
        return when {
            value >= trillion -> String.format(Locale.US, "%.2fT", value / trillion)
            value >= billion -> String.format(Locale.US, "%.2fB", value / billion)
            value >= million -> String.format(Locale.US, "%.2fM", value / million)
            else -> String.format(Locale.US, "%.0f", value)
        }
    }
}

/** 對應 iOS `.lineLimit(1).minimumScaleFactor(0.5)`:單行、放不下時逐步縮小字級。 */
@Composable
internal fun AutoShrinkText(
    text: String,
    color: Color,
    fontSize: TextUnit,
    fontWeight: FontWeight? = null,
    modifier: Modifier = Modifier,
    minScale: Float = 0.5f,
) {
    var scale by remember(text) { mutableStateOf(1f) }
    Text(
        text = text,
        modifier = modifier,
        color = color,
        fontSize = fontSize * scale,
        fontWeight = fontWeight,
        maxLines = 1,
        softWrap = false,
        overflow = TextOverflow.Clip,
        onTextLayout = { result ->
            if (result.didOverflowWidth && scale > minScale) {
                scale = (scale - 0.05f).coerceAtLeast(minScale)
            }
        },
    )
}
