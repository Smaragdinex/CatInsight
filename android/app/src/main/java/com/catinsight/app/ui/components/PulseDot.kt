package com.catinsight.app.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp

/** 對應 iOS PulseDotView:外圈擴散淡出、內圈實心白邊。 */
@Composable
fun PulseDot(color: Color, modifier: Modifier = Modifier.size(26.dp)) {
    val t = rememberInfiniteTransition(label = "pulse")
    val progress by t.animateFloat(0f, 1f, infiniteRepeatable(tween(1200, easing = LinearEasing), RepeatMode.Restart), label = "p")
    Canvas(modifier = modifier) {
        val scale = 0.7f + progress * 1.0f
        val alpha = (0.9f * (1f - progress)).coerceIn(0f, 1f)
        drawCircle(color.copy(alpha = 0.22f * alpha), radius = 13.dp.toPx() * scale)
        drawCircle(color, radius = 5.dp.toPx())
        drawCircle(Color.White.copy(alpha = 0.9f), radius = 5.dp.toPx(), style = Stroke(width = 2.dp.toPx()))
    }
}
