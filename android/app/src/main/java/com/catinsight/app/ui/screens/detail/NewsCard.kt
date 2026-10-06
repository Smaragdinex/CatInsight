package com.catinsight.app.ui.screens.detail

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.catinsight.app.data.NewsItem
import com.catinsight.app.ui.theme.AppColors
import com.catinsight.app.ui.theme.AppTheme
import java.util.Date

/** 對應 iOS NewsCardView:標題、載入中/無資料、前 3 則 + 展開更多、點擊開瀏覽器。 */
@Composable
internal fun NewsCard(
    title: String,
    isLoading: Boolean,
    emptyText: String,
    items: List<NewsItem>,
    isExpanded: Boolean,
    moreButton: String,
    lessButton: String,
    theme: AppTheme,
    newsDateText: (Date) -> String,
    onToggleExpanded: () -> Unit,
) {
    val uriHandler = LocalUriHandler.current
    Column(
        modifier = Modifier.fillMaxWidth().background(theme.appBackground).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth()) {
            Text(title, fontSize = IosFont.headline, fontWeight = FontWeight.SemiBold, color = theme.primaryText)
        }

        if (isLoading) {
            CircularProgressIndicator(color = theme.primaryText)
        } else if (items.isEmpty()) {
            Text(emptyText, fontSize = IosFont.subheadline, color = theme.secondaryText)
        } else {
            val visibleItems = if (isExpanded) items else items.take(3)
            Column(modifier = Modifier.fillMaxWidth()) {
                visibleItems.forEachIndexed { index, item ->
                    // iOS:URL 無效時退回 Yahoo Finance
                    val url = item.url?.takeIf { it.isNotBlank() } ?: "https://finance.yahoo.com"
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { runCatching { uriHandler.openUri(url) } }
                            .padding(vertical = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(item.title, fontSize = IosFont.subheadline, fontWeight = FontWeight.SemiBold, color = theme.primaryText)
                        val summary = item.summary
                        if (!summary.isNullOrEmpty()) {
                            Text(summary, fontSize = IosFont.caption, color = theme.secondaryText, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            val provider = item.provider
                            if (!provider.isNullOrEmpty()) {
                                Text(provider, fontSize = IosFont.caption2, color = theme.secondaryText)
                            }
                            item.publishedDate?.let { published ->
                                Text(newsDateText(published), fontSize = IosFont.caption2, color = theme.secondaryText)
                            }
                        }
                    }

                    if (items.size > 3 && index == visibleItems.size - 1) {
                        Box(
                            modifier = Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 12.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                if (isExpanded) lessButton else moreButton,
                                fontSize = IosFont.caption,
                                color = AppColors.blue,
                                modifier = Modifier.clickable(onClick = onToggleExpanded),
                            )
                        }
                    }

                    if (index != visibleItems.size - 1) {
                        HorizontalDivider(color = theme.divider, thickness = 0.5.dp)
                    }
                }
            }
        }
    }
}
