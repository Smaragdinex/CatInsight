package com.catinsight.app.ui.screens.detail

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.catinsight.app.ui.theme.AppColors
import com.catinsight.app.ui.theme.AppTheme
import java.util.Locale
import kotlin.math.max

/** 對應 iOS ContentView.yOffset(for:min:range:):把值映射到 ±32pt 的垂直位移。 */
private fun yOffsetDp(value: Double, min: Double, range: Double): Float {
    val normalized = (value - min) / range
    return ((1 - normalized) * 64 - 32).toFloat()
}

/** 對應 iOS ContentView.earningsCard:財報(EPS 預估/實際點圖 + 下次財報)。 */
@Composable
internal fun EarningsCard(ctx: DetailContext) {
    val vm = ctx.vm
    val theme = ctx.theme
    val isZh = ctx.s.isZh
    val items = vm.earningsItems

    Column(
        modifier = Modifier.fillMaxWidth().background(theme.appBackground).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(if (isZh) "財報" else "Earnings", fontSize = IosFont.headline, fontWeight = FontWeight.SemiBold, color = theme.primaryText)

        if (items.isEmpty()) {
            Text(
                if (isZh) "目前沒有 EPS 資料" else "No EPS data available",
                fontSize = IosFont.subheadline, color = theme.secondaryText,
            )
        } else {
            val values = items.flatMap { listOfNotNull(it.estimate, it.actual) }
            val minValue = values.minOrNull() ?: 0.0
            val maxValue = values.maxOrNull() ?: 1.0
            val range = max(maxValue - minValue, 0.01)

            // 點圖:左側 y 軸 3 個標籤(寬 30 高 120)+ 各季一欄
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                Column(modifier = Modifier.width(30.dp).height(120.dp)) {
                    Box(modifier = Modifier.height(24.dp), contentAlignment = Alignment.TopStart) {
                        Text(String.format(Locale.US, "%.2f", maxValue), fontSize = IosFont.caption2, color = theme.secondaryText)
                    }
                    Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                        Text(String.format(Locale.US, "%.2f", minValue + (range / 2)), fontSize = IosFont.caption2, color = theme.secondaryText)
                    }
                    Box(modifier = Modifier.height(24.dp), contentAlignment = Alignment.BottomStart) {
                        Text(String.format(Locale.US, "%.2f", minValue), fontSize = IosFont.caption2, color = theme.secondaryText)
                    }
                }

                // iOS:HStack spacing 20 + 寬 0 的 Spacer → 實際間距 40
                Spacer(Modifier.width(40.dp))

                Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.Bottom) {
                    items.asReversed().forEach { item ->
                        Column(
                            modifier = Modifier.weight(1f),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Box(modifier = Modifier.size(width = 26.dp, height = 96.dp), contentAlignment = Alignment.Center) {
                                item.estimate?.let { estimate ->
                                    Box(
                                        modifier = Modifier
                                            .offset(y = yOffsetDp(estimate, minValue, range).dp)
                                            .size(16.dp)
                                            .background(AppColors.green.copy(alpha = 0.28f), CircleShape),
                                    )
                                }
                                item.actual?.let { actual ->
                                    Box(
                                        modifier = Modifier
                                            .offset(y = yOffsetDp(actual, minValue, range).dp)
                                            .size(16.dp)
                                            .background(AppColors.green, CircleShape),
                                    )
                                }
                            }
                            Column(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(1.dp),
                            ) {
                                Text(item.quarter, fontSize = IosFont.caption, color = theme.primaryText, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                item.fiscalYear?.let { fiscalYear ->
                                    Text(fiscalYear, fontSize = IosFont.caption2, color = theme.secondaryText, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }
                }
            }

            // 圖例:預估 EPS / 實際 EPS 或下次財報(ViewThatFits:水平 16、垂直 12)
            AdaptiveMetricRow(spacing = 16.dp, verticalSpacing = 12.dp, modifier = Modifier.fillMaxWidth()) {
                EarningsLegendColumn(
                    title = if (isZh) "預估 EPS" else "Estimated EPS",
                    dotColor = AppColors.green.copy(alpha = 0.28f),
                    theme = theme,
                ) {
                    Text(
                        DetailFmt.number(items.firstOrNull()?.estimate ?: items.lastOrNull()?.estimate),
                        fontSize = IosFont.title3, fontWeight = FontWeight.Bold, color = theme.primaryText,
                    )
                }

                EarningsLegendColumn(
                    title = if (isZh) "實際 EPS / 下次財報" else "Actual EPS / Next Earnings",
                    dotColor = AppColors.green,
                    theme = theme,
                ) {
                    val nextEarningsDateText = vm.nextEarningsDateText
                    if (nextEarningsDateText != null) {
                        Text(
                            ctx.nextEarningsDisplayText(nextEarningsDateText),
                            fontSize = IosFont.body, fontWeight = FontWeight.SemiBold, color = theme.primaryText,
                        )
                        vm.nextEarningsTiming?.let { timing ->
                            Text(ctx.localizedEarningsTiming(timing), fontSize = IosFont.caption, color = theme.secondaryText)
                        }
                    } else {
                        Text(
                            DetailFmt.number(items.lastOrNull()?.actual),
                            fontSize = IosFont.title3, fontWeight = FontWeight.Bold, color = theme.primaryText,
                        )
                    }
                }
            }
            // iOS 的 showLegacyAIPrediction 為 false,舊版 AI 預測區塊不顯示。
        }
    }
}

/** 圖例欄:標題(caption)+ 色點(12)+ 內容。 */
@Composable
private fun EarningsLegendColumn(title: String, dotColor: Color, theme: AppTheme, content: @Composable () -> Unit) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, fontSize = IosFont.caption, color = theme.secondaryText)
            Box(modifier = Modifier.size(12.dp).background(dotColor, CircleShape))
        }
        content()
    }
}
