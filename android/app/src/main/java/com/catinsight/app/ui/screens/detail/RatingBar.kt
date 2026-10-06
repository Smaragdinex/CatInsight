package com.catinsight.app.ui.screens.detail

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.catinsight.app.ui.theme.AppColors
import com.catinsight.app.ui.theme.AppTheme
import kotlin.math.roundToInt

/** 對應 iOS RatingBarView:標籤 + 膠囊進度條 + 百分比。 */
@Composable
internal fun RatingBar(
    label: String,
    percent: Int,
    color: Color,
    primaryText: Color,
    secondaryText: Color,
    divider: Color,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(label, fontSize = IosFont.subheadline, color = primaryText, modifier = Modifier.widthIn(min = 44.dp))
        Box(
            modifier = Modifier
                .weight(1f)
                .height(10.dp)
                .clip(CircleShape)
                .background(divider),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction = (percent / 100f).coerceIn(0f, 1f))
                    .fillMaxHeight()
                    .clip(CircleShape)
                    .background(color),
            )
        }
        Text(
            "$percent%",
            fontSize = IosFont.caption,
            color = secondaryText,
            textAlign = TextAlign.End,
            modifier = Modifier.widthIn(min = 42.dp),
        )
    }
}

/** 買進比例環(92x92,線寬 12,圓端點,從 12 點鐘方向起算)。 */
@Composable
private fun RatingsRing(buyPct: Int, buyLabel: String, theme: AppTheme) {
    Box(modifier = Modifier.size(92.dp), contentAlignment = Alignment.Center) {
        Canvas(modifier = Modifier.size(92.dp)) {
            val strokeWidth = 12.dp.toPx()
            val inset = strokeWidth / 2f
            val arcSize = Size(size.width - strokeWidth, size.height - strokeWidth)
            drawCircle(theme.divider, radius = (size.minDimension - strokeWidth) / 2f, style = Stroke(width = strokeWidth))
            drawArc(
                color = AppColors.green,
                startAngle = -90f,
                sweepAngle = 360f * buyPct / 100f,
                useCenter = false,
                topLeft = Offset(inset, inset),
                size = arcSize,
                style = Stroke(width = strokeWidth, cap = StrokeCap.Round),
            )
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            AutoShrinkText("$buyPct%", color = theme.primaryText, fontSize = IosFont.title3, fontWeight = FontWeight.Bold)
            Text(buyLabel, fontSize = IosFont.caption, color = theme.secondaryText)
        }
    }
}

/** 對應 iOS ContentView.ratingsCard:分析師評等。 */
@Composable
internal fun RatingsCard(ctx: DetailContext) {
    val theme = ctx.theme
    val isZh = ctx.s.isZh
    val ratings = ctx.vm.ratings

    Column(
        modifier = Modifier.fillMaxWidth().background(theme.appBackground).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            if (isZh) "分析師評等" else "Analyst Ratings",
            fontSize = IosFont.headline, fontWeight = FontWeight.SemiBold, color = theme.primaryText,
        )

        if (ratings != null && ratings.total > 0) {
            val buyTotal = ratings.strongBuy + ratings.buy
            val holdTotal = ratings.hold
            val sellTotal = ratings.sell + ratings.strongSell
            val buyPct = ((buyTotal.toDouble() / ratings.total.toDouble()) * 100).roundToInt()
            val holdPct = ((holdTotal.toDouble() / ratings.total.toDouble()) * 100).roundToInt()
            val sellPct = ((sellTotal.toDouble() / ratings.total.toDouble()) * 100).roundToInt()
            val buyLabel = if (isZh) "買進" else "Buy"

            val bars: @Composable () -> Unit = {
                Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    RatingBar(buyLabel, buyPct, AppColors.green, theme.primaryText, theme.secondaryText, theme.divider)
                    RatingBar(if (isZh) "持有" else "Hold", holdPct, AppColors.orange, theme.primaryText, theme.secondaryText, theme.divider)
                    RatingBar(if (isZh) "賣出" else "Sell", sellPct, AppColors.red, theme.primaryText, theme.secondaryText, theme.divider)
                }
            }

            // 對應 ViewThatFits:寬度足夠時環 + 長條水平排列,否則垂直堆疊
            BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
                if (maxWidth >= 280.dp) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(18.dp),
                    ) {
                        RatingsRing(buyPct, buyLabel, theme)
                        Box(modifier = Modifier.weight(1f)) { bars() }
                    }
                } else {
                    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                            RatingsRing(buyPct, buyLabel, theme)
                        }
                        bars()
                    }
                }
            }

            Text(
                "${ratings.total} ${if (isZh) "位分析師" else "analysts"}",
                fontSize = IosFont.caption, color = theme.secondaryText,
            )
        } else {
            // 文案照抄 iOS(英文原文即為 "No analyst viewModel.ratings available")
            Text(
                if (isZh) "目前沒有分析師評等資料" else "No analyst viewModel.ratings available",
                fontSize = IosFont.subheadline, color = theme.secondaryText,
            )
        }
    }
}
