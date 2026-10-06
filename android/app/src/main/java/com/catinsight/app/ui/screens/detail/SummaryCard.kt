package com.catinsight.app.ui.screens.detail

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.catinsight.app.data.StockResponse
import com.catinsight.app.ui.theme.AppTheme
import com.catinsight.app.ui.theme.Fmt
import java.util.Locale

/** 對應 iOS ContentView.summaryCard(info:):組裝 SummaryCardView 所需資料。 */
@Composable
internal fun SummaryCardHost(ctx: DetailContext, info: StockResponse) {
    val vm = ctx.vm
    val s = ctx.s
    val latestPrice = ctx.syncedDisplayPrice ?: 0.0

    val metrics = ctx.syncedChangeMetrics
    val liveChange = vm.liveQuote?.change
    val liveChangePercent = vm.liveQuote?.changePercent
    val changeTextValue: String?
    val changeColorValue: Color?
    if (metrics != null) {
        changeTextValue = Fmt.changeText(metrics.first, metrics.second)
        changeColorValue = s.changeColor(metrics.first)
    } else if (liveChange != null && liveChangePercent != null) {
        changeTextValue = Fmt.changeText(liveChange, liveChangePercent)
        changeColorValue = s.changeColor(liveChange)
    } else {
        changeTextValue = null
        changeColorValue = null
    }

    val session = vm.liveQuote?.session
    SummaryCard(
        stock = info.stock,
        companyName = vm.liveQuote?.companyName ?: info.stock,
        quoteLoading = vm.quoteLoading,
        priceLabel = ctx.priceLabel,
        latestPriceText = "$" + String.format(Locale.US, "%.2f", latestPrice),
        priceColor = ctx.quotePriceColor(info),
        changeText = changeTextValue,
        changeColor = changeColorValue,
        fallbackText = ctx.text.useHistoricalFallback,
        maLabel = ctx.text.maLabel,
        maText = info.data.lastOrNull()?.ma5?.let { String.format(Locale.US, "%.2f", it) } ?: "-",
        sessionText = if (!ctx.isTaiwanSymbol) session?.let { ctx.sessionText(it) } else null,
        sessionColor = if (!ctx.isTaiwanSymbol) session?.let { ctx.sessionBadgeColor(it) } else null,
        theme = ctx.theme,
    )
}

/** 對應 iOS SummaryCardView。 */
@Composable
internal fun SummaryCard(
    stock: String,
    companyName: String,
    quoteLoading: Boolean,
    priceLabel: String,
    latestPriceText: String,
    priceColor: Color,
    changeText: String?,
    changeColor: Color?,
    fallbackText: String,
    maLabel: String,
    maText: String,
    sessionText: String?,
    sessionColor: Color?,
    theme: AppTheme,
) {
    Column(
        modifier = Modifier.fillMaxWidth().background(theme.appBackground).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(stock, fontSize = IosFont.caption, color = theme.secondaryText)
                Text(companyName, fontSize = IosFont.title2, fontWeight = FontWeight.Bold, color = theme.primaryText)
            }
            if (quoteLoading) {
                CircularProgressIndicator(modifier = Modifier.size(16.dp), color = theme.primaryText, strokeWidth = 2.dp)
            }
        }

        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(priceLabel, fontSize = IosFont.caption, color = theme.secondaryText)
                AutoShrinkText(latestPriceText, color = priceColor, fontSize = IosFont.title2, fontWeight = FontWeight.Bold)
                if (changeText != null && changeColor != null) {
                    Text(changeText, fontSize = IosFont.subheadline, color = changeColor)
                } else {
                    Text(fallbackText, fontSize = IosFont.caption, color = theme.secondaryText)
                }
            }

            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(maLabel, fontSize = IosFont.caption, color = theme.secondaryText)
                Text(maText, fontSize = IosFont.headline, fontWeight = FontWeight.SemiBold, color = theme.primaryText)
                if (sessionText != null && sessionColor != null) {
                    Text(sessionText, fontSize = IosFont.caption2, color = sessionColor)
                }
            }
        }
    }
}
