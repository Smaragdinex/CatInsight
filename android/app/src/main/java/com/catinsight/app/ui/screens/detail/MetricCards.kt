package com.catinsight.app.ui.screens.detail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.catinsight.app.data.StockResponse

// 對應 iOS ContentView.contentInnerHorizontalPadding
private val contentInnerHorizontalPadding = 12.dp

/** 對應 iOS MetricCardView:標題(caption)+ 數值(headline semibold)。 */
@Composable
internal fun MetricCard(title: String, value: String, primaryText: Color, secondaryText: Color) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp, horizontal = 4.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, fontSize = IosFont.caption, color = secondaryText)
        Text(value, fontSize = IosFont.headline, fontWeight = FontWeight.SemiBold, color = primaryText)
    }
}

/**
 * 對應 iOS AdaptiveMetricRowView(ViewThatFits):
 * 子元件的理想寬度總和放得下 → 水平等分排列;否則改成垂直堆疊。
 */
@Composable
internal fun AdaptiveMetricRow(
    spacing: Dp,
    modifier: Modifier = Modifier,
    verticalSpacing: Dp = spacing,
    content: @Composable () -> Unit,
) {
    Layout(content = content, modifier = modifier) { measurables, constraints ->
        val n = measurables.size
        val width = constraints.maxWidth
        val hSpacing = spacing.roundToPx()
        val vSpacing = verticalSpacing.roundToPx()
        if (n == 0) return@Layout layout(width, 0) {}

        val intrinsicTotal = measurables.map { it.maxIntrinsicWidth(Int.MAX_VALUE) }.sum() + hSpacing * (n - 1)
        val horizontal = intrinsicTotal <= width

        if (horizontal) {
            val each = ((width - hSpacing * (n - 1)) / n).coerceAtLeast(0)
            val placeables = measurables.map {
                it.measure(Constraints(minWidth = each, maxWidth = each, minHeight = 0, maxHeight = constraints.maxHeight))
            }
            val height = placeables.maxOf { it.height }
            layout(width, height) {
                var x = 0
                placeables.forEach { p ->
                    p.placeRelative(x, 0)
                    x += each + hSpacing
                }
            }
        } else {
            val placeables = measurables.map {
                it.measure(Constraints(minWidth = width, maxWidth = width, minHeight = 0, maxHeight = constraints.maxHeight))
            }
            val height = placeables.map { it.height }.sum() + vSpacing * (n - 1)
            layout(width, height) {
                var y = 0
                placeables.forEach { p ->
                    p.placeRelative(0, y)
                    y += p.height + vSpacing
                }
            }
        }
    }
}

/** 對應 iOS ContentView.metricsSection:開盤/今高/今低、市值/52 週高低、EPS/本益比/殖利率。 */
@Composable
internal fun MetricsSection(ctx: DetailContext) {
    val q = ctx.vm.liveQuote
    val theme = ctx.theme
    val text = ctx.text
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = contentInnerHorizontalPadding),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AdaptiveMetricRow(spacing = 12.dp) {
            MetricCard(text.openLabel, DetailFmt.number(q?.openPrice), theme.primaryText, theme.secondaryText)
            MetricCard(text.todayHighLabel, DetailFmt.number(q?.dayHigh), theme.primaryText, theme.secondaryText)
            MetricCard(text.todayLowLabel, DetailFmt.number(q?.dayLow), theme.primaryText, theme.secondaryText)
        }
        AdaptiveMetricRow(spacing = 12.dp) {
            MetricCard(text.marketCapLabel, DetailFmt.marketCap(q?.marketCap), theme.primaryText, theme.secondaryText)
            MetricCard(text.fiftyTwoWeekHighLabel, DetailFmt.number(q?.fiftyTwoWeekHigh), theme.primaryText, theme.secondaryText)
            MetricCard(text.fiftyTwoWeekLowLabel, DetailFmt.number(q?.fiftyTwoWeekLow), theme.primaryText, theme.secondaryText)
        }
        AdaptiveMetricRow(spacing = 12.dp) {
            MetricCard(text.epsLabel, DetailFmt.eps(q?.eps), theme.primaryText, theme.secondaryText)
            MetricCard(text.peRatioLabel, DetailFmt.number(q?.peRatio), theme.primaryText, theme.secondaryText)
            MetricCard(text.dividendYieldLabel, DetailFmt.percent(q?.dividendYield), theme.primaryText, theme.secondaryText)
        }
    }
}

/** 對應 iOS ContentView.indicatorCard(info:):RSI / MFI / 判斷。 */
@Composable
internal fun IndicatorCard(ctx: DetailContext, info: StockResponse) {
    val theme = ctx.theme
    val text = ctx.text
    AdaptiveMetricRow(spacing = 12.dp, modifier = Modifier.fillMaxWidth().padding(horizontal = contentInnerHorizontalPadding)) {
        MetricCard(text.rsiLabel, DetailFmt.number(info.rsi), theme.primaryText, theme.secondaryText)
        MetricCard(text.mfiLabel, DetailFmt.number(info.mfi), theme.primaryText, theme.secondaryText)
        MetricCard(text.signalLabel, ctx.localizedSignal(info.signal), theme.primaryText, theme.secondaryText)
    }
}
