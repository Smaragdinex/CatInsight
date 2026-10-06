package com.catinsight.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.catinsight.app.data.HealthFactor
import com.catinsight.app.data.HealthResponse
import com.catinsight.app.ui.LocalAppSettings
import com.catinsight.app.ui.theme.AppColors
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * 對應 iOS HealthRadarCard.swift:
 * 個股「一鍵量化體檢」雷達卡:把模型 6 大因子的全市場百分位畫成雷達圖,
 * 並以總分百分位當頭條(擊敗 X% 美股)。資料來自後端 /health/{symbol}。
 */
@Composable
fun HealthRadarCard(health: HealthResponse) {
    val s = LocalAppSettings.current
    val theme = s.theme
    val isZh = s.isZh
    val gold = AppColors.gold
    val goodGreen = AppColors.goodGreen

    val factors: List<HealthFactor> = health.factors ?: emptyList()
    val overall: Int = health.overall ?: 0

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(theme.cardBackground)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        // 標題列:量化體檢 + asOf 日期
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = if (isZh) "量化體檢" else "Stock Health",
                fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = theme.primaryText,
            )
            Spacer(Modifier.weight(1f))
            health.asOf?.let { asOf ->
                Text(text = asOf, fontSize = 11.sp, color = theme.secondaryText)
            }
        }

        // 總分大字 + 擊敗 X% 美股膠囊
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = "$overall",
                    fontSize = 44.sp, fontWeight = FontWeight.Bold, color = theme.primaryText,
                    modifier = Modifier.alignByBaseline(),
                )
                Text(
                    text = if (isZh) "百分位" else "th pct",
                    fontSize = 14.sp, color = theme.secondaryText,
                    modifier = Modifier.alignByBaseline(),
                )
            }
            Text(
                text = if (isZh) "擊敗 $overall% 美股" else "Beats $overall% of US stocks",
                fontSize = 12.sp, fontWeight = FontWeight.Medium, color = goodGreen,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(goodGreen.copy(alpha = 0.15f))
                    .padding(horizontal = 12.dp, vertical = 5.dp),
            )
        }

        // 雷達圖(固定高度 250)
        HealthRadar(
            factors = factors,
            gold = gold,
            gridBase = theme.primaryText,
            labelPrimary = theme.secondaryText,
            tierColor = { v -> healthTierColor(v) },
            modifier = Modifier.fillMaxWidth().height(250.dp),
        )
    }
}

/** 分級色:>=67 綠、>=34 金、其餘紅。 */
private fun healthTierColor(v: Int): Color {
    if (v >= 67) return AppColors.goodGreen
    if (v >= 34) return AppColors.gold
    return AppColors.badRed
}

/** 第 i 個因子在半徑 r 上的頂點(從正上方 -90° 開始順時針)。 */
private fun radarVertex(c: Offset, r: Float, i: Int, n: Int): Offset {
    val angle = ((-90.0 + 360.0 / max(n, 1).toDouble() * i.toDouble()) * Math.PI / 180.0)
    return Offset(c.x + r * cos(angle).toFloat(), c.y + r * sin(angle).toFloat())
}

/**
 * 雷達圖:Canvas 畫格線 / 輻條 / 資料多邊形 / 頂點圓點,
 * 外圈以 Layout 把每個因子的標籤置中放在 (maxR + 22) 的位置。
 */
@Composable
private fun HealthRadar(
    factors: List<HealthFactor>,
    gold: Color,
    gridBase: Color,
    labelPrimary: Color,
    tierColor: (Int) -> Color,
    modifier: Modifier = Modifier,
) {
    Box(modifier = modifier) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            if (factors.isEmpty()) return@Canvas
            val center = Offset(size.width / 2f, size.height / 2f)
            val r = min(size.width, size.height) / 2f - 44.dp.toPx()
            val grid = gridBase.copy(alpha = 0.14f)
            val n = factors.size

            // 三圈同心多邊形格線
            for (ring in listOf(1f / 3f, 2f / 3f, 1f)) {
                val p = Path()
                for (i in 0 until n) {
                    val pt = radarVertex(center, r * ring, i, n)
                    if (i == 0) p.moveTo(pt.x, pt.y) else p.lineTo(pt.x, pt.y)
                }
                p.close()
                drawPath(p, grid, style = Stroke(width = 1.dp.toPx()))
            }
            // 由中心放射的輻條
            for (i in 0 until n) {
                val pt = radarVertex(center, r, i, n)
                drawLine(grid.copy(alpha = grid.alpha * 0.7f), center, pt, strokeWidth = 0.8f * density)
            }

            // 資料多邊形:填色 + 外光暈 + 主線
            val dp = Path()
            factors.forEachIndexed { i, f ->
                val pt = radarVertex(center, r * f.value.toFloat() / 100f, i, n)
                if (i == 0) dp.moveTo(pt.x, pt.y) else dp.lineTo(pt.x, pt.y)
            }
            dp.close()
            drawPath(dp, gold.copy(alpha = 0.22f), style = Fill)
            drawPath(dp, gold.copy(alpha = 0.35f), style = Stroke(width = 5.dp.toPx()))
            drawPath(dp, gold, style = Stroke(width = 2.dp.toPx()))

            // 各頂點圓點(直徑 6.4)
            factors.forEachIndexed { i, f ->
                val pt = radarVertex(center, r * f.value.toFloat() / 100f, i, n)
                drawCircle(gold, radius = 3.2f * density, center = pt)
            }
        }

        // 外圈標籤:labelEn(小字)/ labelZh + 分數(分級色)
        Layout(
            modifier = Modifier.fillMaxSize(),
            content = {
                factors.forEach { f ->
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(1.dp)) {
                        Text(text = f.labelEn, fontSize = 9.sp, color = labelPrimary.copy(alpha = labelPrimary.alpha * 0.7f), maxLines = 1)
                        Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(text = f.labelZh, fontSize = 11.sp, fontWeight = FontWeight.Medium, color = labelPrimary, maxLines = 1)
                            Text(text = "${f.value}", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = tierColor(f.value), maxLines = 1)
                        }
                    }
                }
            },
        ) { measurables, constraints ->
            val w = constraints.maxWidth
            val h = constraints.maxHeight
            val c = Offset(w / 2f, h / 2f)
            val maxR = min(w, h) / 2f - 44.dp.toPx()
            // 標籤不受父層寬高限制(對應 iOS .fixedSize())
            val loose = Constraints(minWidth = 0, minHeight = 0, maxWidth = Constraints.Infinity, maxHeight = Constraints.Infinity)
            val placeables = measurables.map { it.measure(loose) }
            layout(w, h) {
                placeables.forEachIndexed { idx, p ->
                    val pt = radarVertex(c, maxR + 22.dp.toPx(), idx, placeables.size)
                    p.place(
                        x = (pt.x - p.width / 2f).toInt(),
                        y = (pt.y - p.height / 2f).toInt(),
                    )
                }
            }
        }
    }
}
