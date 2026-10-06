package com.catinsight.app.ui.sheets

import android.app.Activity
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.UnfoldMore
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.catinsight.app.data.AlertCenter
import com.catinsight.app.data.AlertDirection
import com.catinsight.app.data.AlertMetric
import com.catinsight.app.data.StockAlert
import com.catinsight.app.ui.LocalAppSettings
import com.catinsight.app.ui.theme.AppColors
import com.catinsight.app.ui.theme.AppTheme
import java.util.Locale
import kotlin.math.abs

/**
 * 對應 iOS AlertSheet:個股提醒設定(參考 Robinhood)。
 * 上半部是新增提醒表單(指標 / 週期 / 觸發條件 / 目標值 / 檢查頻率),下半部列出已設定的提醒。
 * 外層 ModalBottomSheet 由 AppRoot 提供,這裡只畫內容。
 */
@Composable
fun AlertSheetContent(symbol: String, onDismiss: () -> Unit) {
    val s = LocalAppSettings.current
    val theme = s.theme
    val isZh = s.isZh
    // 漲/跌色(已依台美切換):above 用漲色、below 用跌色
    val upColor = s.risingColor()
    val downColor = s.fallingColor()
    val activity = LocalContext.current as? Activity

    var metric by remember { mutableStateOf(AlertMetric.PRICE) }
    var direction by remember { mutableStateOf(AlertDirection.ABOVE) }
    var targetText by remember { mutableStateOf("") }
    var interval by remember { mutableStateOf("5 min") }
    var showDirOptions by remember { mutableStateOf(false) }
    var periodText by remember { mutableStateOf("14") }
    var fastText by remember { mutableStateOf("12") }
    var slowText by remember { mutableStateOf("26") }
    var signalText by remember { mutableStateOf("9") }

    val intervals = listOf("5 min", "15 min", "1 hour", "Daily")
    val needsTarget = metric == AlertMetric.PRICE || metric == AlertMetric.RSI   // 只有 價格/RSI 要輸入數值
    val needsPeriod = metric == AlertMetric.RSI || metric == AlertMetric.MA
    val needsDirection = metric != AlertMetric.MONEY_OUTFLOW
    val needsInterval = metric != AlertMetric.PRICE && metric != AlertMetric.MONEY_OUTFLOW
    val canAdd = !needsTarget || targetText.toDoubleOrNull() != null

    fun metricName(m: AlertMetric): String = when (m) {
        AlertMetric.PRICE -> if (isZh) "價格" else "Price"
        AlertMetric.RSI -> "RSI"
        AlertMetric.MA -> if (isZh) "均線 MA" else "MA"
        AlertMetric.VWAP -> "VWAP"
        AlertMetric.MACD -> "MACD"
        AlertMetric.MONEY_OUTFLOW -> if (isZh) "大戶出金" else "Money outflow"
    }
    fun directionName(d: AlertDirection): String =
        if (d == AlertDirection.ABOVE) (if (isZh) "高於" else "Above") else (if (isZh) "低於" else "Below")
    fun intervalName(v: String): String {
        if (!isZh) return v
        return when (v) {
            "5 min" -> "5 分鐘"
            "15 min" -> "15 分鐘"
            "1 hour" -> "1 小時"
            "Daily" -> "每日"
            else -> v
        }
    }

    fun addAlert() {
        val target = targetText.toDoubleOrNull() ?: 0.0
        val period = if (needsPeriod)
            (periodText.toIntOrNull()?.coerceIn(2, 50) ?: (if (metric == AlertMetric.MA) 10 else 14))
        else null
        val isMacd = metric == AlertMetric.MACD
        AlertCenter.add(
            StockAlert(
                symbol = symbol.uppercase(Locale.US), metric = metric,
                direction = direction, target = target, enabled = true,
                lastTriggered = null, interval = if (needsInterval) interval else null, period = period,
                fastPeriod = if (isMacd) (fastText.toIntOrNull() ?: 12) else null,
                slowPeriod = if (isMacd) (slowText.toIntOrNull() ?: 26) else null,
                signalPeriod = if (isMacd) (signalText.toIntOrNull() ?: 9) else null,
            )
        )
        targetText = ""
    }

    // 對應 iOS .onAppear { center.requestAuthorization() }:面板一出現就請求通知權限
    LaunchedEffect(Unit) {
        activity?.let { AlertCenter.requestAuthorization(it) }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .fillMaxHeight(0.9f)
            .background(theme.appBackground)
    ) {
        // 導覽列:置中標題 + 右側「完成」
        Box(modifier = Modifier.fillMaxWidth().height(44.dp)) {
            Text(
                text = if (isZh) "$symbol 提醒" else "$symbol alerts",
                color = theme.primaryText, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.align(Alignment.Center),
            )
            TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.CenterEnd).padding(end = 4.dp)) {
                Text(if (isZh) "完成" else "Done", color = AppColors.blue, fontSize = 17.sp)
            }
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            // ---------- 新增提醒表單 ----------
            val cardShape = RoundedCornerShape(14.dp)
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(cardShape)
                    .background(theme.cardBackground)
                    .border(1.dp, theme.divider, cardShape)
            ) {
                // 提醒項目
                FormRow(label = if (isZh) "提醒項目" else "Alert for", theme = theme) {
                    MenuPicker(
                        label = metricName(metric),
                        options = AlertMetric.entries.toList(),
                        optionName = { metricName(it) },
                        theme = theme,
                    ) { metric = it }
                }
                // 週期(RSI / MA)
                if (needsPeriod) {
                    HorizontalDivider(color = theme.divider, thickness = 1.dp)
                    FormRow(label = (if (metric == AlertMetric.MA) "MA" else "RSI") + (if (isZh) " 週期" else " period"), theme = theme) {
                        NumberField(
                            value = periodText, onValueChange = { periodText = it },
                            placeholder = if (metric == AlertMetric.MA) "10" else "14",
                            width = 80.dp, decimal = false, theme = theme,
                        )
                    }
                }
                // MACD 參數(Fast / Slow / Signal,預設 12/26/9)
                if (metric == AlertMetric.MACD) {
                    HorizontalDivider(color = theme.divider, thickness = 1.dp)
                    FormRow(label = if (isZh) "快線週期" else "Fast period", theme = theme) {
                        NumberField(fastText, { fastText = it }, "12", 80.dp, false, theme)
                    }
                    HorizontalDivider(color = theme.divider, thickness = 1.dp)
                    FormRow(label = if (isZh) "慢線週期" else "Slow period", theme = theme) {
                        NumberField(slowText, { slowText = it }, "26", 80.dp, false, theme)
                    }
                    HorizontalDivider(color = theme.divider, thickness = 1.dp)
                    FormRow(label = if (isZh) "訊號週期" else "Signal period", theme = theme) {
                        NumberField(signalText, { signalText = it }, "9", 80.dp, false, theme)
                    }
                }
                // 觸發條件(除大戶出金外都有)
                if (needsDirection) {
                    HorizontalDivider(color = theme.divider, thickness = 1.dp)
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { showDirOptions = !showDirOptions }
                            .padding(horizontal = 14.dp, vertical = 13.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(if (isZh) "觸發條件" else "Trigger", color = theme.secondaryText, fontSize = 15.sp)
                        Spacer(Modifier.weight(1f))
                        DirArrow(direction, upColor, downColor)
                        Spacer(Modifier.width(8.dp))
                        Text(directionName(direction), color = theme.primaryText, fontSize = 15.sp)
                        Spacer(Modifier.width(8.dp))
                        Icon(Icons.Filled.UnfoldMore, contentDescription = null, tint = theme.secondaryText, modifier = Modifier.size(14.dp))
                    }
                    AnimatedVisibility(visible = showDirOptions) {
                        Column {
                            DirOption(AlertDirection.ABOVE, direction, isZh, upColor, downColor, theme, directionName(AlertDirection.ABOVE)) {
                                direction = AlertDirection.ABOVE; showDirOptions = false
                            }
                            DirOption(AlertDirection.BELOW, direction, isZh, upColor, downColor, theme, directionName(AlertDirection.BELOW)) {
                                direction = AlertDirection.BELOW; showDirOptions = false
                            }
                        }
                    }
                }
                // 數值(僅 價格 / RSI)
                if (needsTarget) {
                    HorizontalDivider(color = theme.divider, thickness = 1.dp)
                    FormRow(
                        label = if (metric == AlertMetric.RSI) (if (isZh) "門檻值" else "Level") else (if (isZh) "目標值" else "Target"),
                        theme = theme,
                    ) {
                        NumberField(
                            value = targetText, onValueChange = { targetText = it },
                            placeholder = if (metric == AlertMetric.RSI) (if (isZh) "如 70 / 30" else "e.g. 70 / 30") else (if (isZh) "價格" else "Price"),
                            width = 140.dp, decimal = true, theme = theme,
                        )
                    }
                }
                if (metric == AlertMetric.MONEY_OUTFLOW) {
                    HorizontalDivider(color = theme.divider, thickness = 1.dp)
                    FormRow(label = "", theme = theme) {
                        Text(if (isZh) "偵測到大戶出金時提醒" else "Notify on big-money outflow", color = theme.secondaryText, fontSize = 12.sp)
                    }
                }
                // 檢查頻率(技術指標才有,價格/大戶出金不需要)
                if (needsInterval) {
                    HorizontalDivider(color = theme.divider, thickness = 1.dp)
                    FormRow(label = if (isZh) "檢查頻率" else "Interval", theme = theme) {
                        MenuPicker(
                            label = intervalName(interval),
                            options = intervals,
                            optionName = { intervalName(it) },
                            theme = theme,
                        ) { interval = it }
                    }
                }
            }

            // 新增提醒按鈕
            val btnShape = RoundedCornerShape(12.dp)
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(btnShape)
                    .background(if (canAdd) AppColors.blue else Color.Gray.copy(alpha = 0.4f))
                    .clickable(enabled = canAdd) { addAlert() }
                    .padding(vertical = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(if (isZh) "新增提醒" else "Add alert", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            }

            // ---------- 已設定的提醒 ----------
            val existing = AlertCenter.alertsFor(symbol)
            if (existing.isNotEmpty()) {
                Text(if (isZh) "已設定的提醒" else "Your alerts", color = theme.primaryText, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                val rowShape = RoundedCornerShape(12.dp)
                existing.forEach { a ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(rowShape)
                            .background(theme.cardBackground)
                            .border(1.dp, theme.divider, rowShape)
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(describe(a, isZh), color = theme.primaryText, fontSize = 15.sp)
                            a.lastTriggered?.let { t ->
                                Text((if (isZh) "上次觸發 " else "Triggered ") + relative(t, isZh), color = theme.secondaryText, fontSize = 11.sp)
                            }
                        }
                        IconButton(onClick = { AlertCenter.delete(a) }) {
                            Icon(Icons.Filled.Delete, contentDescription = "Delete", tint = AppColors.red)
                        }
                    }
                }
            }
        }
    }
}

/** 對應 iOS row(label:):左側灰標籤 + 右側內容,水平 14 / 垂直 13 內距。 */
@Composable
private fun FormRow(label: String, theme: AppTheme, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (label.isNotEmpty()) Text(label, color = theme.secondaryText, fontSize = 15.sp)
        Spacer(Modifier.weight(1f))
        content()
    }
}

/** 對應 iOS Menu + menuLabel:文字 + 上下箭頭,點了展開下拉選單。 */
@Composable
private fun <T> MenuPicker(label: String, options: List<T>, optionName: (T) -> String, theme: AppTheme, onSelect: (T) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        Row(
            modifier = Modifier.clickable { expanded = true },
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, color = theme.primaryText, fontSize = 15.sp)
            Icon(Icons.Filled.UnfoldMore, contentDescription = null, tint = theme.secondaryText, modifier = Modifier.size(14.dp))
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { opt ->
                DropdownMenuItem(
                    text = { Text(optionName(opt), color = theme.primaryText, fontSize = 15.sp) },
                    onClick = { onSelect(opt); expanded = false },
                )
            }
        }
    }
}

/** 數字輸入框(對應 iOS TextField 靠右對齊、固定最大寬度)。 */
@Composable
private fun NumberField(value: String, onValueChange: (String) -> Unit, placeholder: String, width: Dp, decimal: Boolean, theme: AppTheme) {
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = Modifier.width(width),
        singleLine = true,
        textStyle = TextStyle(color = theme.primaryText, fontSize = 15.sp, textAlign = TextAlign.End),
        keyboardOptions = KeyboardOptions(keyboardType = if (decimal) KeyboardType.Decimal else KeyboardType.Number),
        cursorBrush = SolidColor(AppColors.blue),
        decorationBox = { inner ->
            Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                if (value.isEmpty()) {
                    Text(placeholder, color = theme.secondaryText.copy(alpha = 0.5f), fontSize = 15.sp, textAlign = TextAlign.End, modifier = Modifier.fillMaxWidth())
                }
                inner()
            }
        },
    )
}

/** 對應 dirArrow:above 用漲色向上箭頭、below 用跌色向下箭頭。 */
@Composable
private fun DirArrow(d: AlertDirection, upColor: Color, downColor: Color) {
    Icon(
        if (d == AlertDirection.ABOVE) Icons.Filled.ArrowUpward else Icons.Filled.ArrowDownward,
        contentDescription = null,
        tint = if (d == AlertDirection.ABOVE) upColor else downColor,
        modifier = Modifier.size(14.dp),
    )
}

/** 對應 dirOption:展開後的觸發條件選項列,選中時淡藍底 + 藍勾。 */
@Composable
private fun DirOption(
    d: AlertDirection, current: AlertDirection, isZh: Boolean,
    upColor: Color, downColor: Color, theme: AppTheme, name: String, onClick: () -> Unit,
) {
    val selected = current == d
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (selected) AppColors.blue.copy(alpha = 0.10f) else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 22.dp, vertical = 11.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DirArrow(d, upColor, downColor)
        Text(
            name + (if (isZh) "目標" else (if (d == AlertDirection.ABOVE) " (rises above)" else " (falls below)")),
            color = theme.primaryText, fontSize = 15.sp,
        )
        Spacer(Modifier.weight(1f))
        if (selected) Icon(Icons.Filled.Check, contentDescription = null, tint = AppColors.blue, modifier = Modifier.size(14.dp))
    }
}

/** 對應 iOS describe(_:):把提醒描述成一句話。 */
private fun describe(a: StockAlert, isZh: Boolean): String {
    val above = a.direction == AlertDirection.ABOVE
    return when (a.metric) {
        AlertMetric.MONEY_OUTFLOW -> if (isZh) "大戶出金時提醒" else "On money outflow"
        AlertMetric.PRICE ->
            if (isZh) "價格 ${if (above) "高於" else "低於"} ${fmt(a.target)}"
            else "Price ${if (above) "above" else "below"} ${fmt(a.target)}"
        AlertMetric.RSI -> {
            val p = a.period ?: 14
            if (isZh) "RSI($p) ${if (above) "高於" else "低於"} ${a.target.toInt()}"
            else "RSI($p) ${if (above) "above" else "below"} ${a.target.toInt()}"
        }
        AlertMetric.MA -> {
            val p = a.period ?: 10
            if (isZh) "價格 ${if (above) "突破" else "跌破"} MA($p)"
            else "Price ${if (above) "above" else "below"} MA($p)"
        }
        AlertMetric.VWAP ->
            if (isZh) "價格 ${if (above) "高於" else "低於"} VWAP"
            else "Price ${if (above) "above" else "below"} VWAP"
        AlertMetric.MACD ->
            if (isZh) "MACD ${if (above) "黃金交叉" else "死亡交叉"}"
            else "MACD ${if (above) "bullish cross" else "bearish cross"}"
    }
}

private fun fmt(v: Double): String = String.format(Locale.US, "%.2f", v)

/** 對應 iOS RelativeDateTimeFormatter(zh_TW / en_US):「3分鐘前」/「3 minutes ago」。 */
private fun relative(millis: Long, isZh: Boolean): String {
    val diff = System.currentTimeMillis() - millis
    val future = diff < 0
    val sec = abs(diff) / 1000
    val min = sec / 60
    val hr = min / 60
    val day = hr / 24
    val week = day / 7
    val month = day / 30
    val year = day / 365
    val (n, zhUnit, enUnit) = when {
        year > 0 -> Triple(year, "年", "year")
        month > 0 -> Triple(month, "個月", "month")
        week > 0 -> Triple(week, "週", "week")
        day > 0 -> Triple(day, "天", "day")
        hr > 0 -> Triple(hr, "小時", "hour")
        min > 0 -> Triple(min, "分鐘", "minute")
        else -> Triple(sec, "秒", "second")
    }
    return if (isZh) {
        if (future) "${n}${zhUnit}後" else "${n}${zhUnit}前"
    } else {
        val unit = if (n == 1L) enUnit else enUnit + "s"
        if (future) "in $n $unit" else "$n $unit ago"
    }
}
