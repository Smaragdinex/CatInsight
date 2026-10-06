package com.catinsight.app.ui.screens.detail

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Spacer
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.ShowChart
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.catinsight.app.data.ChartCandle
import com.catinsight.app.data.ChartPoint
import com.catinsight.app.data.StockResponse
import com.catinsight.app.ui.components.PulseDot
import com.catinsight.app.ui.theme.AppColors
import com.catinsight.app.ui.theme.AppTheme
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

// 對應 iOS ContentView.contentInnerHorizontalPadding
private val contentInnerHorizontalPadding = 12.dp

private data class PeriodOption(val title: String, val value: String)

// 對齊 Robinhood:1D / 1W / 1M / 3M / YTD / 1Y(後端 1W 對應 period=5d)
private val periodOptions = listOf(
    PeriodOption("1D", "1d"),
    PeriodOption("1W", "5d"),
    PeriodOption("1M", "1mo"),
    PeriodOption("3M", "3mo"),
    PeriodOption("YTD", "ytd"),
    PeriodOption("1Y", "1y"),
)

/** 對應 iOS ContentView.chartSection(info:):K 線/折線切換 + 圖表卡 + 期間按鈕。 */
@Composable
internal fun ChartSection(ctx: DetailContext, info: StockResponse) {
    val s = ctx.s
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = contentInnerHorizontalPadding),
            horizontalArrangement = Arrangement.End,
        ) {
            ChartTypePicker(isCandle = s.showCandle, onChange = { s.setShowCandle(it) }, theme = s.theme)
        }
        ChartCardHost(ctx, info)
        PeriodButtons(ctx)
    }
}

/** 對應 iOS 的 segmented Picker(折線 / 柱狀圖示,寬 110)。 */
@Composable
private fun ChartTypePicker(isCandle: Boolean, onChange: (Boolean) -> Unit, theme: AppTheme) {
    val selectedBg = if (theme.isDark) Color.White.copy(alpha = 0.22f) else Color.White
    Row(
        modifier = Modifier
            .width(110.dp)
            .height(32.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(theme.primaryText.copy(alpha = 0.10f))
            .padding(2.dp),
    ) {
        @Composable
        fun segment(selected: Boolean, icon: ImageVector, onClick: () -> Unit) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (selected) selectedBg else Color.Transparent)
                    .clickable(onClick = onClick),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = theme.primaryText, modifier = Modifier.size(18.dp))
            }
        }
        segment(!isCandle, Icons.Filled.ShowChart) { onChange(false) }
        segment(isCandle, Icons.Filled.BarChart) { onChange(true) }
    }
}

/** 對應 iOS ContentView.periodButtons。 */
@Composable
private fun PeriodButtons(ctx: DetailContext) {
    val vm = ctx.vm
    val s = ctx.s
    val theme = s.theme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = contentInnerHorizontalPadding),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        periodOptions.forEach { option ->
            val selected = vm.selectedPeriod == option.value
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (selected) AppColors.blue else theme.appBackground)
                    .clickable {
                        vm.selectedPeriod = option.value
                        if (vm.stockInfo != null) {
                            vm.refreshAllData(languageCode = s.langCode)
                        }
                    }
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            ) {
                Text(
                    option.title,
                    fontSize = IosFont.body,
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                    color = if (selected) Color.White else theme.primaryText.copy(alpha = 0.9f),
                )
            }
        }
    }
}

/** 對應 iOS ContentView.chartCard(info:):算出圖表點、蠟燭、基準線、x 軸格數與 y 軸範圍。 */
@Composable
private fun ChartCardHost(ctx: DetailContext, info: StockResponse) {
    val s = ctx.s
    val theme = s.theme
    val period = ctx.vm.selectedPeriod
    // 圖表優先用 /chart 的細間隔序列(需為同一股票、同一期間),還沒到就先畫 /stock 的每日資料
    val source = ctx.vm.chartInfo?.takeIf { it.period == period && it.stock.uppercase() == info.stock.uppercase() } ?: info
    val sorted = remember(source) { ctx.sortedData(source) }
    val chartPoints = ctx.mergedChartPoints(sorted)
    val trendColor = ctx.chartTrendColor(sorted)
    val isOneDay = period == "1d"

    // 蠟燭資料(OHLC)
    val candles = remember(sorted) {
        sorted.mapIndexed { idx, pair ->
            val d = pair.first
            ChartCandle(
                date = pair.second,
                label = d.chartLabel ?: idx.toString(),
                open = d.open ?: d.price,
                high = d.high ?: d.price,
                low = d.low ?: d.price,
                close = d.price,
                volume = d.volume ?: 0.0,
            )
        }
    }

    // 基準虛線:1D 用昨收,其他期間用期初第一筆
    val baseline: Double? = if (isOneDay) (ctx.vm.liveQuote?.previousClose ?: chartPoints.firstOrNull()?.price)
                            else chartPoints.firstOrNull()?.price

    // x 軸格數:1D 固定整段交易時段(美股 78 根 5 分鐘、台股 54 根),其餘按資料筆數
    val dataCount = max(chartPoints.size, candles.size)
    val sessionSlots = if (ctx.isTaiwanSymbol) 54 else 78
    val slotCount = if (isOneDay) max(sessionSlots, dataCount) else dataCount

    // y 範圍:蠟燭用高低點,線圖用收盤(+基準線),上下各留 8%
    val showCandle = s.showCandle
    val lows = if (showCandle) candles.map { it.low } else chartPoints.map { it.price }
    val highs = if (showCandle) candles.map { it.high } else chartPoints.map { it.price }
    val allValues = lows + highs + (if (!showCandle && baseline != null) listOf(baseline) else emptyList())
    val minValue = allValues.minOrNull() ?: 0.0
    val maxValue = allValues.maxOrNull() ?: 1.0
    val padding = max((maxValue - minValue) * 0.08, 0.01)
    val yMin = max(0.0, minValue - padding)
    val yMax = maxValue + padding
    val livePoint = chartPoints.lastOrNull { it.isLivePoint }

    ChartCard(
        chartPoints = chartPoints,
        selectedPeriod = period,
        trendColor = trendColor,
        yMin = yMin,
        yMax = yMax,
        livePoint = livePoint,
        baseline = baseline,
        slotCount = slotCount,
        dividerColor = theme.divider,
        axisColor = theme.chartAxis,
        primaryColor = theme.primaryText,
        secondaryColor = theme.secondaryText,
        themeBackground = theme.appBackground,
        axisLabel = { ctx.axisLabel(it) },
        tooltipLabel = { tooltipLabel(it, period, s.isZh) },
        candles = candles,
        isCandle = showCandle,
        upColor = s.risingColor(),
        downColor = s.fallingColor(),
    )
}

/** 十字線資訊列的日期格式(比軸標籤完整)。 */
private fun tooltipLabel(date: Date, period: String, isZh: Boolean): String {
    val pattern = when (period) { "1d" -> "HH:mm"; "5d" -> "M/d HH:mm"; else -> "yyyy/M/d" }
    return java.text.SimpleDateFormat(pattern, if (isZh) Locale.TAIWAN else Locale.US).format(date)
}

// MARK: - 看盤軟體風格價格圖(Yahoo Finance / Robinhood)
//  - x 軸按「第幾筆」排列,週末與休市不佔寬度;1D 固定整段交易時段的格數,盤中未走完的部分留白
//  - 一條線 + 淡漸層、昨收/期初虛線基準、右側 3 個價位、底部 4~5 個時間;不畫直格線、不畫均線
//  - 長按拖曳出十字線,上方顯示日期與價格(K 線模式顯示開高低收)

private val yAxisWidth = 46.dp      // 右側 y 軸標籤區
private val xAxisHeight = 18.dp     // 下方 x 軸標籤區
private val axisFontSize = 11.sp

@Composable
internal fun ChartCard(
    chartPoints: List<ChartPoint>,
    selectedPeriod: String,
    trendColor: Color,
    yMin: Double,
    yMax: Double,
    livePoint: ChartPoint?,
    baseline: Double?,
    slotCount: Int,
    dividerColor: Color,
    axisColor: Color,
    primaryColor: Color,
    secondaryColor: Color,
    themeBackground: Color,
    axisLabel: (Date) -> String,
    tooltipLabel: (Date) -> String,
    candles: List<ChartCandle> = emptyList(),
    isCandle: Boolean = false,
    upColor: Color = AppColors.green,
    downColor: Color = AppColors.red,
) {
    var selectedIndex by remember(isCandle, selectedPeriod) { mutableStateOf<Int?>(null) }
    val pointCount = if (isCandle) candles.size else chartPoints.size
    val dates = if (isCandle) candles.map { it.date } else chartPoints.map { it.date }
    // 即時點(isLivePoint)不算新的一天,否則 1W 會多出一個今天的標籤
    val tickDates = if (isCandle) dates else chartPoints.filter { !it.isLivePoint }.map { it.date }
    val geom = ChartGeom(selectedPeriod = selectedPeriod, slotCount = max(slotCount, pointCount), dates = dates, tickDates = tickDates, axisLabel = axisLabel)

    val tooltipText: String? = selectedIndex?.takeIf { it in 0 until pointCount }?.let { i ->
        val date = geom.dateAt(i) ?: return@let null
        if (isCandle) {
            val c = candles[i]
            String.format(Locale.US, "%s   O %.2f  H %.2f  L %.2f  C %.2f", tooltipLabel(date), c.open, c.high, c.low, c.close)
        } else {
            String.format(Locale.US, "%s   $%.2f", tooltipLabel(date), chartPoints[i].price)
        }
    }

    Column(
        modifier = Modifier.fillMaxWidth().background(themeBackground).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        // 十字線資訊列(固定高度,避免出現/消失時版面跳動)
        Box(modifier = Modifier.fillMaxWidth().height(22.dp), contentAlignment = Alignment.Center) {
            Text(
                tooltipText ?: "",
                fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = primaryColor,
                maxLines = 1, textAlign = TextAlign.Center,
            )
        }
        if (isCandle) {
            CandleChart(candles, geom, yMin, yMax, selectedIndex, { selectedIndex = it }, dividerColor, axisColor, secondaryColor, upColor, downColor)
            VolumeChart(candles, geom, axisColor, upColor, downColor)
        } else {
            LineChart(chartPoints, geom, trendColor, yMin, yMax, livePoint, baseline, selectedIndex, { selectedIndex = it }, dividerColor, axisColor, secondaryColor)
        }
    }
}

/** x 軸的「格」幾何:索引 ↔ 時間 ↔ 標籤。 */
private class ChartGeom(
    val selectedPeriod: String,
    val slotCount: Int,
    private val dates: List<Date>,
    private val tickDates: List<Date> = dates,
    private val axisLabel: (Date) -> String,
) {
    fun dateAt(index: Int): Date? {
        if (index in dates.indices) return dates[index]
        // 1D 資料還沒走完:用第一筆時間 + 5 分鐘 × 索引 推出標籤
        if (selectedPeriod != "1d") return null
        val first = dates.firstOrNull() ?: return null
        return Date(first.time + index * 300_000L)
    }

    fun label(index: Int): String = dateAt(index)?.let(axisLabel) ?: ""

    /** x 軸標籤的索引:1D 每 1.5 小時(美股)/ 1 小時(台股)一個,其他期間平均取 5 個。 */
    val tickIndices: List<Int>
        get() {
            val n = slotCount
            if (n <= 1) return listOf(0)
            if (selectedPeriod == "1d") {
                // 每 1.5 小時(美股)/ 1 小時(台股)一個;最後一段不標,避免最右邊的標籤擠到邊
                val step = if (n >= 70) 18 else 12
                return (0 until (n - step / 2) step step).toList()
            }
            if (selectedPeriod == "5d") {
                // 1W:每個交易日的第一根標一次日期
                val cal = Calendar.getInstance()
                val out = ArrayList<Int>()
                var lastDay = -1
                tickDates.forEachIndexed { i, d ->
                    cal.time = d
                    val day = cal.get(Calendar.YEAR) * 1000 + cal.get(Calendar.DAY_OF_YEAR)
                    if (day != lastDay) { out.add(i); lastDay = day }
                }
                return out
            }
            val step = max(1, n / 5)
            return (0 until n step step).toList()
        }
}

/** 繪圖區(不含軸標籤)的像素矩形。 */
private class Plot(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val width: Float get() = right - left
    val height: Float get() = bottom - top
}

/** 在 [min, max] 內取「好看」的刻度(1/2/5 × 10^k)。 */
private fun niceTicks(min: Double, max: Double, desired: Int): List<Double> {
    val range = max - min
    if (range <= 0 || desired <= 0) return listOf(min)
    val raw = range / desired
    val magnitude = 10.0.pow(floor(log10(raw)))
    val normalized = raw / magnitude
    val step = (when {
        normalized < 1.5 -> 1.0
        normalized < 3.0 -> 2.0
        normalized < 7.0 -> 5.0
        else -> 10.0
    }) * magnitude
    val result = ArrayList<Double>()
    var v = ceil(min / step) * step
    var guard = 0
    while (v <= max + step * 1e-6 && guard < 50) { result.add(v); v += step; guard++ }
    return result
}

private fun priceLabel(v: Double, yMin: Double, yMax: Double): String =
    if (yMax - yMin >= 10) String.format(Locale.US, "%.0f", v) else String.format(Locale.US, "%.2f", v)

/**
 * 長按拖曳選點的手勢(給折線與 K 線共用)。
 * 注意:pointerInput 的 key 固定為 Unit,並用 rememberUpdatedState 讀最新的 lambda;
 * 否則 selectedIndex 一改、畫面重繪,手勢偵測器就會被重建而取消長按。
 */
@Composable
private fun Modifier.crosshairGesture(
    indexOf: (Float) -> Int,
    onSelect: (Int?) -> Unit,
    onStartHaptic: () -> Unit,
): Modifier {
    val indexOfState = rememberUpdatedState(indexOf)
    val onSelectState = rememberUpdatedState(onSelect)
    val hapticState = rememberUpdatedState(onStartHaptic)
    return this.pointerInput(Unit) {
        detectDragGesturesAfterLongPress(
            onDragStart = { pos -> hapticState.value(); onSelectState.value(indexOfState.value(pos.x)) },
            onDrag = { change, _ -> change.consume(); onSelectState.value(indexOfState.value(change.position.x)) },
            onDragEnd = { onSelectState.value(null) },
            onDragCancel = { onSelectState.value(null) },
        )
    }
}

/** 折線:面積漸層 + 一條線 + 基準虛線 + 即時點 + 十字線(高 240)。 */
@Composable
private fun LineChart(
    points: List<ChartPoint>,
    geom: ChartGeom,
    trendColor: Color,
    yMin: Double,
    yMax: Double,
    livePoint: ChartPoint?,
    baseline: Double?,
    selectedIndex: Int?,
    onSelect: (Int?) -> Unit,
    dividerColor: Color,
    axisColor: Color,
    secondaryColor: Color,
) {
    val textMeasurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val haptic = LocalHapticFeedback.current
    val axisStyle = TextStyle(color = axisColor, fontSize = axisFontSize)

    BoxWithConstraints(modifier = Modifier.fillMaxWidth().height(240.dp)) {
        val wPx = with(density) { maxWidth.toPx() }
        val hPx = with(density) { maxHeight.toPx() }
        val plot = with(density) { Plot(0f, 0f, wPx - yAxisWidth.toPx(), hPx - xAxisHeight.toPx()) }
        val ySpan = (yMax - yMin).takeIf { it > 0 } ?: 1.0
        val denom = max(geom.slotCount - 1, 1).toFloat()

        fun xOf(i: Int): Float = plot.left + i / denom * plot.width
        fun yOf(v: Double): Float = plot.top + ((1.0 - (v - yMin) / ySpan) * plot.height).toFloat()
        fun indexAt(x: Float): Int = ((x - plot.left) / plot.width * denom).roundToInt().coerceIn(0, max(points.size - 1, 0))

        Canvas(
            modifier = Modifier.fillMaxSize().crosshairGesture(
                indexOf = { indexAt(it) },
                onSelect = onSelect, onStartHaptic = { haptic.performHapticFeedback(HapticFeedbackType.LongPress) },
            ),
        ) {
            val hairline = 0.5.dp.toPx()

            // y 軸:淡橫線 + 右側 3 個價位
            niceTicks(yMin, yMax, 3).forEach { v ->
                val y = yOf(v)
                drawLine(dividerColor, Offset(plot.left, y), Offset(plot.right, y), hairline)
                val measured = textMeasurer.measure(priceLabel(v, yMin, yMax), axisStyle)
                drawText(measured, topLeft = Offset(plot.right + 6.dp.toPx(), (y - measured.size.height / 2f).coerceIn(0f, max(0f, hPx - measured.size.height))))
            }

            // x 軸:只有標籤,不畫直格線
            geom.tickIndices.forEach { i ->
                val x = xOf(i)
                val measured = textMeasurer.measure(geom.label(i), axisStyle)
                drawText(measured, topLeft = Offset((x - measured.size.width / 2f).coerceIn(0f, max(0f, plot.right - measured.size.width)), plot.bottom + 5.dp.toPx()))
            }

            if (points.isEmpty()) return@Canvas

            // 基準虛線(昨收 / 期初)
            baseline?.let { b ->
                val y = yOf(b)
                drawLine(secondaryColor.copy(alpha = 0.45f), Offset(plot.left, y), Offset(plot.right, y), 1.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 4.dp.toPx())))
            }

            // 面積漸層 + 折線
            val linePath = Path()
            val areaPath = Path()
            val baseY = plot.bottom
            points.forEachIndexed { i, p ->
                val x = xOf(i); val y = yOf(p.price)
                if (i == 0) { linePath.moveTo(x, y); areaPath.moveTo(x, baseY); areaPath.lineTo(x, y) }
                else { linePath.lineTo(x, y); areaPath.lineTo(x, y) }
            }
            areaPath.lineTo(xOf(points.size - 1), baseY)
            areaPath.close()
            drawPath(areaPath, Brush.verticalGradient(colors = listOf(trendColor.copy(alpha = 0.28f), trendColor.copy(alpha = 0f)), startY = plot.top, endY = plot.bottom))
            drawPath(linePath, trendColor, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))

            // 十字線
            selectedIndex?.takeIf { it in points.indices }?.let { i ->
                val x = xOf(i); val y = yOf(points[i].price)
                drawLine(secondaryColor.copy(alpha = 0.6f), Offset(x, plot.top), Offset(x, plot.bottom), 1.dp.toPx())
                drawCircle(trendColor, radius = 5.dp.toPx(), center = Offset(x, y))
                drawCircle(Color.White, radius = 5.dp.toPx(), center = Offset(x, y), style = Stroke(width = 1.5.dp.toPx()))
            }
        }

        // 即時點(沒有在拖曳十字線時才顯示)
        if (selectedIndex == null) {
            livePoint?.let { lp ->
                val i = points.indexOfLast { it.isLivePoint }
                if (i >= 0) {
                    val cx = xOf(i); val cy = yOf(lp.price)
                    PulseDot(color = trendColor, modifier = Modifier
                        .offset { IntOffset((cx - 13.dp.toPx()).roundToInt(), (cy - 13.dp.toPx()).roundToInt()) }
                        .size(26.dp))
                }
            }
        }
    }
}

/** K 線:每格一根、右側價位、十字線(高 220)。 */
@Composable
private fun CandleChart(
    candles: List<ChartCandle>,
    geom: ChartGeom,
    yMin: Double,
    yMax: Double,
    selectedIndex: Int?,
    onSelect: (Int?) -> Unit,
    dividerColor: Color,
    axisColor: Color,
    secondaryColor: Color,
    upColor: Color,
    downColor: Color,
) {
    val textMeasurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val haptic = LocalHapticFeedback.current
    val axisStyle = TextStyle(color = axisColor, fontSize = axisFontSize)

    BoxWithConstraints(modifier = Modifier.fillMaxWidth().height(220.dp)) {
        val wPx = with(density) { maxWidth.toPx() }
        val hPx = with(density) { maxHeight.toPx() }
        val plot = with(density) { Plot(0f, 0f, wPx - yAxisWidth.toPx(), hPx - xAxisHeight.toPx()) }
        val ySpan = (yMax - yMin).takeIf { it > 0 } ?: 1.0
        val n = geom.slotCount
        val slot = plot.width / max(n, 1)
        fun xOf(i: Int): Float = plot.left + (i + 0.5f) * slot
        fun yOf(v: Double): Float = plot.top + ((1.0 - (v - yMin) / ySpan) * plot.height).toFloat()
        fun indexAt(x: Float): Int = floor((x - plot.left) / slot).toInt().coerceIn(0, max(candles.size - 1, 0))

        Canvas(
            modifier = Modifier.fillMaxSize().crosshairGesture(
                indexOf = { indexAt(it) },
                onSelect = onSelect, onStartHaptic = { haptic.performHapticFeedback(HapticFeedbackType.LongPress) },
            ),
        ) {
            val hairline = 0.5.dp.toPx()
            niceTicks(yMin, yMax, 3).forEach { v ->
                val y = yOf(v)
                drawLine(dividerColor, Offset(plot.left, y), Offset(plot.right, y), hairline)
                val measured = textMeasurer.measure(priceLabel(v, yMin, yMax), axisStyle)
                drawText(measured, topLeft = Offset(plot.right + 6.dp.toPx(), (y - measured.size.height / 2f).coerceIn(0f, max(0f, hPx - measured.size.height))))
            }
            geom.tickIndices.forEach { i ->
                val x = xOf(i)
                val measured = textMeasurer.measure(geom.label(i), axisStyle)
                drawText(measured, topLeft = Offset((x - measured.size.width / 2f).coerceIn(0f, max(0f, plot.right - measured.size.width)), plot.bottom + 5.dp.toPx()))
            }
            if (candles.isEmpty()) return@Canvas

            val bodyWidth = max(slot * 0.6f, 1.5.dp.toPx())
            candles.forEachIndexed { i, c ->
                val color = if (c.close >= c.open) upColor else downColor
                val x = xOf(i)
                drawLine(color, Offset(x, yOf(c.low)), Offset(x, yOf(c.high)), 1.dp.toPx())
                val top = min(yOf(c.open), yOf(c.close))
                val bottom = max(yOf(c.open), yOf(c.close))
                drawRect(color, topLeft = Offset(x - bodyWidth / 2f, top), size = Size(bodyWidth, max(bottom - top, 1f)))
            }
            selectedIndex?.takeIf { it in candles.indices }?.let { i ->
                val x = xOf(i)
                drawLine(secondaryColor.copy(alpha = 0.6f), Offset(x, plot.top), Offset(x, plot.bottom), 1.dp.toPx())
            }
        }
    }
}

/** 成交量柱(高 56,右側 2 個刻度)。 */
@Composable
private fun VolumeChart(candles: List<ChartCandle>, geom: ChartGeom, axisColor: Color, upColor: Color, downColor: Color) {
    val textMeasurer = rememberTextMeasurer()
    val axisStyle = TextStyle(color = axisColor, fontSize = axisFontSize)

    Canvas(modifier = Modifier.fillMaxWidth().height(56.dp)) {
        val plot = Plot(0f, 0f, size.width - yAxisWidth.toPx(), size.height)
        val top = (candles.maxOfOrNull { it.volume } ?: 0.0).takeIf { it > 0 } ?: 1.0
        fun yOf(v: Double): Float = plot.bottom - (v / top * plot.height).toFloat()

        niceTicks(0.0, top, 2).forEach { v ->
            val y = yOf(v)
            val measured = textMeasurer.measure(volumeLabel(v), axisStyle)
            drawText(measured, topLeft = Offset(plot.right + 6.dp.toPx(), (y - measured.size.height / 2f).coerceIn(0f, max(0f, size.height - measured.size.height))))
        }
        if (candles.isEmpty()) return@Canvas
        val slot = plot.width / max(geom.slotCount, 1)
        val barWidth = max(slot * 0.6f, 1.5.dp.toPx())
        candles.forEachIndexed { i, c ->
            val color = (if (c.close >= c.open) upColor else downColor).copy(alpha = 0.5f)
            val x = plot.left + (i + 0.5f) * slot
            val y = yOf(c.volume)
            drawRect(color, topLeft = Offset(x - barWidth / 2f, y), size = Size(barWidth, max(plot.bottom - y, 0f)))
        }
    }
}

private fun volumeLabel(v: Double): String = when {
    v >= 1e9 -> String.format(Locale.US, "%.0fB", v / 1e9)
    v >= 1e6 -> String.format(Locale.US, "%.0fM", v / 1e6)
    else -> String.format(Locale.US, "%.0fK", v / 1e3)
}
