package com.catinsight.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import kotlin.math.max
import kotlin.math.min

/**
 * 對應 iOS MiniSparklineView(92x34)。
 * baseline:虛線基準(通常為昨收價);不給時以走勢第一點為基準。
 */
@Composable
fun MiniSparkline(values: List<Double>, color: Color, baseline: Double? = null, modifier: Modifier = Modifier.size(92.dp, 34.dp)) {
    Canvas(modifier = modifier) {
        val baselineValue = baseline ?: values.firstOrNull() ?: 0.0
        val minValue = min(values.minOrNull() ?: 0.0, baselineValue)
        val maxValue = max(values.maxOrNull() ?: 1.0, baselineValue)
        val range = max(maxValue - minValue, 0.0001)
        val w = size.width; val h = size.height
        val baselineY = (h * (1 - ((baselineValue - minValue) / range))).toFloat()

        if (values.isNotEmpty()) {
            drawLine(
                color = Color.White.copy(alpha = 0.5f),
                start = Offset(0f, baselineY), end = Offset(w, baselineY),
                strokeWidth = 1.dp.toPx(), cap = StrokeCap.Round,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx())),
            )
            val path = Path()
            values.forEachIndexed { index, v ->
                val x = w * index / max(values.size - 1, 1)
                val y = (h * (1 - ((v - minValue) / range))).toFloat()
                if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            drawPath(path, color, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
    }
}
