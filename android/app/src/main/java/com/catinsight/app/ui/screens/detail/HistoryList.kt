package com.catinsight.app.ui.screens.detail

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.catinsight.app.data.StockResponse
import java.util.Locale

/**
 * 對應 iOS ContentView.historyListCard(info:)。
 * iOS 用 LazyVStack,這裡直接鋪成外層 LazyColumn 的 items 以維持惰性載入;
 * 卡片背景與頁面背景同色,拆成多個 item 視覺上無差異。
 */
internal fun LazyListScope.historyListCard(
    ctx: DetailContext,
    info: StockResponse,
    expanded: Boolean,
    onToggle: () -> Unit,
) {
    val theme = ctx.theme
    val text = ctx.text

    item(key = "history-header") {
        Column(modifier = Modifier.fillMaxWidth()) {
            Spacer(Modifier.height(16.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(theme.appBackground)
                    .clickable(onClick = onToggle)
                    .padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = if (expanded) 12.dp else 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    if (expanded) Icons.Filled.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = null,
                    tint = theme.secondaryText,
                    modifier = Modifier.size(18.dp),
                )
                Text(text.historyTitle, fontSize = IosFont.headline, fontWeight = FontWeight.SemiBold, color = theme.primaryText)
            }
        }
    }

    if (expanded) {
        // 最新一筆不列(已顯示在摘要卡),其餘由新到舊
        val rows = info.data.dropLast(1).asReversed()
        items(count = rows.size, key = { "history-${rows[it].date}-$it" }) { index ->
            val item = rows[index]
            Column(modifier = Modifier.fillMaxWidth().background(theme.appBackground).padding(horizontal = 16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(ctx.shortDate(item.date), fontSize = IosFont.headline, fontWeight = FontWeight.SemiBold, color = theme.primaryText)
                        val maText = item.ma5?.let { String.format(Locale.US, "%.2f", it) } ?: "-"
                        Text("${text.maLabel}: $maText", fontSize = IosFont.caption, color = theme.secondaryText)
                    }
                    Text(
                        "$" + String.format(Locale.US, "%.2f", item.price),
                        fontSize = IosFont.title3,
                        fontWeight = FontWeight.Bold,
                        color = ctx.priceColorFor(item),
                    )
                }
                HorizontalDivider(color = theme.divider, thickness = 0.5.dp)
            }
        }
        item(key = "history-footer") {
            Spacer(Modifier.fillMaxWidth().height(16.dp).background(theme.appBackground))
        }
    }
}
