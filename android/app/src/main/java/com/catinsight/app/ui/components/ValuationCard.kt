package com.catinsight.app.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.catinsight.app.DashboardViewModel
import com.catinsight.app.data.ValuationResponse
import com.catinsight.app.data.ValuationScenario
import com.catinsight.app.ui.LocalAppSettings
import com.catinsight.app.ui.theme.AppColors
import com.catinsight.app.ui.theme.AppSettings
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

// ---- 對應 iOS ContentView 傳入 ValuationCardView 的輔助函式 ----

/** 對應 ContentView.currencyPrice:"$" + 兩位小數。 */
private fun currencyPrice(value: Double?): String =
    value?.let { "$" + String.format(Locale.US, "%.2f", it) } ?: "-"

/** 對應 ContentView.percentText:比率 ×100,帶正負號一位小數。 */
private fun percentText(value: Double?): String =
    value?.let { String.format(Locale.US, "%+.1f", it * 100) + "%" } ?: "-"

/** 對應 ContentView.expectedReturnColor:null 用次要文字色,否則依漲跌色。 */
private fun expectedReturnColor(s: AppSettings, value: Double?): Color =
    value?.let { s.changeColor(it) } ?: s.theme.secondaryText

/** 對應 ContentView.formattedCompactNumber:>=100 無小數、>=10 一位、其餘兩位。 */
private fun formattedCompactNumber(value: Double?): String {
    if (value == null) return "-"
    if (abs(value) >= 100) return String.format(Locale.US, "%.0f", value)
    if (abs(value) >= 10) return String.format(Locale.US, "%.1f", value)
    return String.format(Locale.US, "%.2f", value)
}

/** 對應 ContentView.multipleText:整數 + "x"。 */
private fun multipleText(value: Double?): String =
    value?.let { String.format(Locale.US, "%.0f", it) + "x" } ?: "-"

/** 對應 ContentView.industryBucketText:產業桶代碼 → 中/英文名稱。 */
private fun industryBucketText(isZh: Boolean, value: String?): String = when (value) {
    "food" -> if (isZh) "食品" else "Food"
    "high_end_pcb" -> if (isZh) "衛星通訊" else "Satellite Comms"
    "electronic_components" -> if (isZh) "電子零組件" else "Electronic Components"
    "semiconductors" -> if (isZh) "半導體" else "Semiconductors"
    "shipping" -> if (isZh) "航運" else "Shipping"
    "building_materials" -> if (isZh) "建材玻璃" else "Building Materials"
    "chemicals_materials" -> if (isZh) "塑化原物料" else "Chemicals & Materials"
    "financials" -> if (isZh) "金融保險" else "Financials"
    "default" -> if (isZh) "一般產業" else "General"
    else -> value ?: "-"
}

/**
 * 對應 iOS ContentView.valuationCard + ValuationCardView.swift:估值模型卡。
 * 資料用 vm.valuation;情境用 vm.selectedValuationScenario(點分段選擇器直接指定)。
 * 照 iOS 行為:valuation 為 null 或沒有情境時顯示「目前沒有可用估值資料」。
 *
 * @param currentPrice 呼叫端傳入的同步顯示價(iOS:syncedDisplayPrice ?? valuation.currentPrice ?? 0)。
 */
@Composable
fun ValuationCard(vm: DashboardViewModel, currentPrice: Double) {
    val s = LocalAppSettings.current
    val theme = s.theme
    val isZh = s.isZh
    val valuation: ValuationResponse? = vm.valuation
    val selectedScenarioId = vm.selectedValuationScenario

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(theme.appBackground)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            text = if (isZh) "估值模型" else "Valuation Model",
            fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = theme.primaryText,
        )

        if (valuation != null && valuation.scenarios.isNotEmpty()) {
            // 情境分段選擇器(對應 Picker .segmented)
            ValuationSegmentedPicker(
                options = valuation.scenarios.map { it.id to it.label },
                selectedId = selectedScenarioId,
                onSelect = { vm.selectedValuationScenario = it },
            )

            val selectedScenario: ValuationScenario? =
                valuation.scenarios.firstOrNull { it.id == selectedScenarioId } ?: valuation.scenarios.firstOrNull()

            if (selectedScenario != null) {
                val isRevenueExit = valuation.modelType == "revenue_exit_pe"
                val selectedDisplayTarget: Double? =
                    if (isRevenueExit) (selectedScenario.compositeTargetPrice ?: selectedScenario.targetPrice)
                    else selectedScenario.targetPrice
                val maxTarget: Double =
                    if (isRevenueExit) {
                        valuation.scenarios.mapNotNull { it.compositeTargetPrice }.maxOrNull()
                            ?: valuation.scenarios.mapNotNull { it.targetPrice }.maxOrNull()
                            ?: max(currentPrice, 1.0)
                    } else {
                        valuation.scenarios.mapNotNull { it.targetPrice }.maxOrNull() ?: max(currentPrice, 1.0)
                    }
                val gaugeRatio: Double =
                    if (maxTarget > 0) min(max((selectedDisplayTarget ?: 0.0) / maxTarget, 0.0), 1.0) else 0.0

                Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                    // 估值參考價格 / 預期年化報酬率
                    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                text = if (isZh) "估值參考價格" else "Valuation Reference",
                                fontSize = 12.sp, color = theme.secondaryText,
                            )
                            Text(
                                text = currencyPrice(selectedDisplayTarget),
                                fontSize = 22.sp, fontWeight = FontWeight.Bold, color = theme.primaryText,
                            )
                        }
                        Spacer(Modifier.weight(1f))
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp), horizontalAlignment = Alignment.End) {
                            Text(
                                text = if (isZh) "預期年化報酬率" else "Expected Return",
                                fontSize = 12.sp, color = theme.secondaryText,
                            )
                            Text(
                                text = percentText(selectedScenario.expectedReturn),
                                fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
                                color = expectedReturnColor(s, selectedScenario.expectedReturn),
                            )
                        }
                    }

                    // 漸層量表 + 可動指示圓點(情境切換時 0.35s easeInOut)
                    ValuationGauge(
                        ratio = gaugeRatio.toFloat(),
                        animationKey = selectedScenarioId,
                        trackColor = theme.divider,
                        knobFill = theme.appBackground,
                        knobStroke = theme.primaryText,
                    )

                    Row(modifier = Modifier.fillMaxWidth()) {
                        Text(text = currencyPrice(currentPrice), fontSize = 12.sp, color = theme.secondaryText)
                        Spacer(Modifier.weight(1f))
                        Text(text = currencyPrice(maxTarget), fontSize = 12.sp, color = theme.secondaryText)
                    }

                    if (valuation.modelType == "eps_pe") {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                            ValuationMetricChip(if (isZh) "預估 EPS" else "Expected EPS", formattedCompactNumber(selectedScenario.expectedEPS))
                            ValuationMetricChip(if (isZh) "目標本益比" else "Target P/E", multipleText(selectedScenario.targetPE))
                            ValuationMetricChip(if (isZh) "產業" else "Industry", industryBucketText(isZh, valuation.industryBucket))
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                            ValuationMetricChip(if (isZh) "基準 EPS" else "Base EPS", formattedCompactNumber(valuation.baseEPS ?: valuation.forwardEPS ?: valuation.trailingEPS))
                            ValuationMetricChip(if (isZh) "現價" else "Current", currencyPrice(currentPrice))
                            ValuationMetricChip(if (isZh) "模型" else "Model", "EPS × P/E")
                        }
                    } else {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                            ValuationMetricChip(if (isZh) "營收成長" else "Growth", percentText(selectedScenario.revenueGrowthRate))
                            ValuationMetricChip(if (isZh) "淨利率" else "Net Margin", percentText(selectedScenario.expectedNetMargin))
                            ValuationMetricChip(if (isZh) "退出本益比" else "Exit P/E", multipleText(selectedScenario.exitPE))
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                            ValuationMetricChip(if (isZh) "持有年數" else "Holding", "${valuation.holdingYears}Y")
                            ValuationMetricChip(if (isZh) "每股營收" else "Rev/Share", formattedCompactNumber(valuation.normalizedRevenuePerShare ?: valuation.currentRevenuePerShare))
                            ValuationMetricChip(if (isZh) "現價" else "Current", currencyPrice(currentPrice))
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                            ValuationMetricChip(if (isZh) "模型價" else "Model", currencyPrice(selectedScenario.targetPrice))
                            ValuationMetricChip(if (isZh) "分析師均價" else "Analyst Avg", currencyPrice(valuation.analystTargetMean))
                            ValuationMetricChip(if (isZh) "綜合加權" else "Composite", currencyPrice(selectedScenario.compositeTargetPrice))
                        }
                        val analystCount = valuation.analystCount
                        if (analystCount != null && analystCount > 0) {
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                                ValuationMetricChip(if (isZh) "分析師低標" else "Analyst Low", currencyPrice(valuation.analystTargetLow))
                                ValuationMetricChip(if (isZh) "分析師高標" else "Analyst High", currencyPrice(valuation.analystTargetHigh))
                                ValuationMetricChip(if (isZh) "分析師數量" else "Analysts", "$analystCount")
                            }
                        }
                    }

                    // eps_pe 模型的備註(排除 TW v2.1 內部註記)
                    val notes = valuation.notes
                    if (valuation.modelType == "eps_pe" && notes != null && !notes.contains("TW v2.1", ignoreCase = true)) {
                        Text(text = notes, fontSize = 12.sp, color = theme.secondaryText)
                    }
                }
            }
        } else {
            Text(
                text = if (isZh) "目前沒有可用估值資料" else "No valuation inputs available",
                fontSize = 15.sp, color = theme.secondaryText,
            )
        }

        Text(
            text = if (isZh) "模型試算,非投資建議" else "Model estimate, not investment advice",
            fontSize = 11.sp, color = theme.secondaryText.copy(alpha = theme.secondaryText.alpha * 0.7f),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** 對應 ValuationCardView.valuationMetricChip:標題(caption2)+ 值(subheadline semibold),圓角 12 淺底。 */
@Composable
private fun RowScope.ValuationMetricChip(title: String, value: String) {
    val theme = LocalAppSettings.current.theme
    Column(
        modifier = Modifier
            .weight(1f)
            .clip(RoundedCornerShape(12.dp))
            .background(theme.divider.copy(alpha = theme.divider.alpha * 0.65f))
            .padding(vertical = 10.dp, horizontal = 12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(text = title, fontSize = 11.sp, color = theme.secondaryText)
        Text(text = value, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = theme.primaryText)
    }
}

/**
 * 對應 ValuationCardView 的量表:divider 底膠囊、橘→綠漸層膠囊(高 12),
 * 24pt 圓點以 appBackground 填色 + primaryText 2pt 邊線,依 ratio 位移(0.35s 動畫)。
 */
@Composable
private fun ValuationGauge(
    ratio: Float,
    animationKey: String,
    trackColor: Color,
    knobFill: Color,
    knobStroke: Color,
) {
    // iOS 的 .animation(value: selectedScenarioId):情境改變時對位移做 0.35s easeInOut
    val animatedRatio by animateFloatAsState(
        targetValue = ratio,
        animationSpec = tween(durationMillis = 350),
        label = "valuationGauge-$animationKey",
    )
    BoxWithConstraints(modifier = Modifier.fillMaxWidth().height(24.dp)) {
        val width = maxWidth
        // 對應 iOS max(min(w*ratio-12, w-24), 0)
        val knobX = (width * animatedRatio - 12.dp).coerceAtMost(width - 24.dp).coerceAtLeast(0.dp)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(12.dp)
                .align(Alignment.CenterStart)
                .clip(CircleShape)
                .background(trackColor),
        )
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(12.dp)
                .align(Alignment.CenterStart)
                .clip(CircleShape)
                .background(
                    Brush.horizontalGradient(
                        colors = listOf(AppColors.orange.copy(alpha = 0.75f), AppColors.green.copy(alpha = 0.85f)),
                    ),
                ),
        )
        Box(
            modifier = Modifier
                .align(Alignment.CenterStart)
                .offset(x = knobX)
                .size(24.dp)
                .clip(CircleShape)
                .background(knobFill)
                .border(2.dp, knobStroke, CircleShape),
        )
    }
}

/**
 * 對應 SwiftUI Picker(.segmented):圓角容器、等寬分段,選中分段有淺色滑塊(帶動畫)。
 * options: (id, label)。
 */
@Composable
private fun ValuationSegmentedPicker(
    options: List<Pair<String, String>>,
    selectedId: String,
    onSelect: (String) -> Unit,
) {
    val theme = LocalAppSettings.current.theme
    if (options.isEmpty()) return
    val n = options.size
    val selectedIndex = options.indexOfFirst { it.first == selectedId }.let { if (it < 0) 0 else it }
    val containerColor = theme.primaryText.copy(alpha = 0.08f)
    val thumbColor = if (theme.isDark) theme.primaryText.copy(alpha = 0.16f) else Color.White

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxWidth()
            .height(32.dp)
            .clip(RoundedCornerShape(9.dp))
            .background(containerColor)
            .padding(2.dp),
    ) {
        val segmentWidth = maxWidth / n
        val thumbOffset by animateFloatAsState(
            targetValue = selectedIndex.toFloat(),
            animationSpec = tween(durationMillis = 200),
            label = "segmentThumb",
        )
        // 滑塊
        Box(
            modifier = Modifier
                .offset(x = segmentWidth * thumbOffset)
                .width(segmentWidth)
                .height(28.dp)
                .clip(RoundedCornerShape(7.dp))
                .background(thumbColor),
        )
        Row(modifier = Modifier.fillMaxWidth()) {
            options.forEachIndexed { idx, (id, label) ->
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(28.dp)
                        .clip(RoundedCornerShape(7.dp))
                        .clickable { onSelect(id) },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = label,
                        fontSize = 13.sp,
                        fontWeight = if (idx == selectedIndex) FontWeight.SemiBold else FontWeight.Normal,
                        color = theme.primaryText,
                        textAlign = TextAlign.Center,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}
