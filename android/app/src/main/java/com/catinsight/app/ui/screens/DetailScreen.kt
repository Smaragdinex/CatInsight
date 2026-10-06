package com.catinsight.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.catinsight.app.DashboardViewModel
import com.catinsight.app.data.PendingNewChat
import com.catinsight.app.data.StockResponse
import com.catinsight.app.ui.LocalAppSettings
import com.catinsight.app.ui.components.AIAssistantCard
import com.catinsight.app.ui.components.ValuationCard
import com.catinsight.app.ui.screens.detail.ChartSection
import com.catinsight.app.ui.screens.detail.DetailContext
import com.catinsight.app.ui.screens.detail.EarningsCard
import com.catinsight.app.ui.screens.detail.IndicatorCard
import com.catinsight.app.ui.screens.detail.MetricsSection
import com.catinsight.app.ui.screens.detail.NewsCard
import com.catinsight.app.ui.screens.detail.RatingsCard
import com.catinsight.app.ui.screens.detail.SummaryCardHost
import com.catinsight.app.ui.screens.detail.historyListCard
import com.catinsight.app.ui.theme.AppColors

/**
 * 對應 iOS ContentView.contentView 的 `.detail` 分支:
 * 載入中 / 錯誤 / 空提示 / 可下拉更新的個股詳情列表。
 */
@Composable
fun DetailScreen(vm: DashboardViewModel, onAskAI: (PendingNewChat) -> Unit) {
    val s = LocalAppSettings.current
    val theme = s.theme
    val ctx = DetailContext(vm, s)
    val errorMessage = vm.errorMessage
    val info = vm.stockInfo

    when {
        vm.isLoading -> {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    CircularProgressIndicator(color = theme.primaryText)
                    Text(s.text.loadingText, color = theme.primaryText)
                }
            }
        }
        errorMessage != null -> {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    errorMessage,
                    color = AppColors.red,
                    modifier = Modifier
                        .background(theme.cardBackground, RoundedCornerShape(14.dp))
                        .padding(16.dp),
                )
            }
        }
        info != null -> DetailContent(ctx = ctx, info = info, onAskAI = onAskAI)
        else -> {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(s.text.emptyPrompt, color = theme.secondaryText)
            }
        }
    }
}

/** 每個區塊之間垂直間距 16(對應 iOS VStack(spacing: 16))。 */
private fun LazyListScope.section(key: String, content: @Composable () -> Unit) {
    item(key = key) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Spacer(Modifier.height(16.dp))
            content()
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DetailContent(ctx: DetailContext, info: StockResponse, onAskAI: (PendingNewChat) -> Unit) {
    val vm = ctx.vm
    val s = ctx.s
    var isHistoryExpanded by rememberSaveable { mutableStateOf(false) }
    var isNewsExpanded by rememberSaveable { mutableStateOf(false) }

    // 先在 composition 內讀取,確保 LazyColumn 內容隨狀態重組
    val newsItems = vm.newsItems
    val newsLoading = vm.newsLoading
    val currentSymbol = vm.normalizedSymbolInput(vm.symbol)
    val valuationPrice = ctx.syncedDisplayPrice ?: vm.valuation?.currentPrice ?: 0.0

    PullToRefreshBox(
        isRefreshing = vm.isLoading,
        onRefresh = { vm.refreshAllData(languageCode = s.langCode) },
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp),
        ) {
            // 1. 摘要卡(第一個區塊,上方不留間距)
            item(key = "summary") { SummaryCardHost(ctx, info) }

            // 2. AI 助理卡(同事提供)
            section("ai-assistant") {
                AIAssistantCard(symbol = currentSymbol, onAsk = { sym -> onAskAI(PendingNewChat(sym, "")) })
            }

            // 3. 圖表區
            section("chart") { ChartSection(ctx, info) }

            // 4. 指標卡列
            section("metrics") { MetricsSection(ctx) }

            // 5. RSI / MFI / 判斷
            section("indicator") { IndicatorCard(ctx, info) }

            // 6. 歷史明細(可展開)
            historyListCard(ctx, info, expanded = isHistoryExpanded, onToggle = { isHistoryExpanded = !isHistoryExpanded })

            // 7. 新聞
            section("news") {
                NewsCard(
                    title = s.text.newsTitle,
                    isLoading = newsLoading,
                    emptyText = s.text.newsEmptyText,
                    items = newsItems,
                    isExpanded = isNewsExpanded,
                    moreButton = s.text.moreButton,
                    lessButton = s.text.lessButton,
                    theme = s.theme,
                    newsDateText = { ctx.newsDateText(it) },
                    onToggleExpanded = { isNewsExpanded = !isNewsExpanded },
                )
            }

            // 8. 分析師評等
            section("ratings") { RatingsCard(ctx) }

            // 9. 估值卡(同事提供)
            section("valuation") { ValuationCard(vm = vm, currentPrice = valuationPrice) }

            // 10. 財報
            section("earnings") { EarningsCard(ctx) }
        }
    }
}
