package com.catinsight.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.NotificationsNone
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.ShowChart
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import com.catinsight.app.DashboardViewModel
import com.catinsight.app.data.AlertCenter
import com.catinsight.app.data.PendingNewChat
import com.catinsight.app.data.WatchlistItem
import com.catinsight.app.data.WatchlistStore
import com.catinsight.app.ui.screens.ConversationsScreen
import com.catinsight.app.ui.screens.DetailScreen
import com.catinsight.app.ui.screens.SearchScreen
import com.catinsight.app.ui.screens.WatchlistScreen
import com.catinsight.app.ui.sheets.AlertSheetContent
import com.catinsight.app.ui.sheets.SettingsSheetContent
import com.catinsight.app.ui.theme.AppColors
import com.catinsight.app.ui.theme.AppSettings
import kotlin.math.abs

enum class ScreenMode { SEARCH, WATCHLIST, DETAIL, CONVERSATIONS }

/** 提供給所有畫面用的設定(主題/語言/漲跌色)。 */
val LocalAppSettings = staticCompositionLocalOf<AppSettings> { error("AppSettings not provided") }

/**
 * 對應 iOS ContentView 的外殼:單一畫面在 搜尋/自選/個股/對話 四個模式間切換,
 * 底部工具列,警示與設定用 bottom sheet。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppRoot(
    settings: AppSettings,
    vm: DashboardViewModel,
    autoOpenSymbol: String? = null,   // 測試鉤子(DEBUG):語音對話要開的股票代碼,可空
    autoVoiceText: String? = null,    // 測試鉤子(DEBUG):有值就直接開語音對話並把這句送出
) {
    val theme = settings.theme
    var screenMode by rememberSaveable { mutableStateOf(ScreenMode.SEARCH) }
    var showSettings by remember { mutableStateOf(false) }
    var showAlertSheet by remember { mutableStateOf(false) }
    var pendingChat by remember { mutableStateOf<PendingNewChat?>(null) }
    val watchlist = WatchlistStore.items

    val hasStock = vm.stockInfo != null || vm.liveQuote != null
    val showsBackToList = screenMode == ScreenMode.DETAIL && hasStock
    val currentSymbol = vm.normalizedSymbolInput(vm.symbol)
    val isInWatchlist = remember(watchlist.size, vm.liveQuote, vm.stockInfo) {
        val s = vm.liveQuote?.stock ?: vm.stockInfo?.stock
        s != null && s.isNotEmpty() && watchlist.any { it.symbol == s }
    }

    fun openSymbol(symbol: String) {
        screenMode = ScreenMode.DETAIL
        vm.symbol = symbol
        vm.refreshAllData(symbol, settings.langCode)
        AlertCenter.evaluate(symbol, settings.isZh)
    }

    fun toggleWatchlistForCurrentStock() {
        val sym = (vm.liveQuote?.stock ?: vm.stockInfo?.stock ?: vm.symbol).trim().uppercase()
        if (sym.isEmpty()) return
        val name = vm.liveQuote?.companyName ?: vm.stockInfo?.stock ?: sym
        if (WatchlistStore.contains(sym)) {
            WatchlistStore.remove(sym)
            vm.watchlistQuotes = vm.watchlistQuotes - sym
        } else {
            WatchlistStore.add(WatchlistItem(sym, name))
        }
        vm.refreshWatchlistQuotes(WatchlistStore.symbols, force = true)
        vm.startWatchlistAutoRefresh(WatchlistStore.symbols)
    }

    // onAppear
    LaunchedEffect(Unit) {
        vm.refreshWatchlistQuotes(WatchlistStore.symbols)
        vm.startWatchlistAutoRefresh(WatchlistStore.symbols)
        vm.refreshMarketIndices()
        vm.loadRanking()
        vm.loadTopGainers()
        WatchlistStore.symbols.forEach { AlertCenter.evaluate(it, settings.isZh) }
    }
    // 測試鉤子(DEBUG):直接開該股對話並進語音畫面(MainActivity 只在 DEBUG 才會傳進來)
    LaunchedEffect(Unit) {
        if (!autoVoiceText.isNullOrEmpty()) {
            pendingChat = PendingNewChat(autoOpenSymbol?.trim()?.uppercase() ?: "", "")
            screenMode = ScreenMode.CONVERSATIONS
        }
    }
    // 語言切換 → 重抓 AI 分析
    var firstLang by remember { mutableStateOf(true) }
    LaunchedEffect(settings.language) {
        if (firstLang) { firstLang = false; return@LaunchedEffect }
        val sym = vm.normalizedSymbolInput(vm.symbol)
        if (sym.isEmpty()) return@LaunchedEffect
        vm.llmTomorrow = null; vm.aiAnalysis = null; vm.isLLMTomorrowLoading = true
        vm.fetchLLMTomorrow(sym, settings.langCode, forceRefresh = true)
        vm.fetchAIAnalysis(sym, settings.langCode, forceRefresh = true)
    }

    BackHandler(enabled = screenMode == ScreenMode.DETAIL || screenMode == ScreenMode.CONVERSATIONS) {
        screenMode = if (screenMode == ScreenMode.DETAIL) ScreenMode.WATCHLIST else ScreenMode.SEARCH
    }

    CompositionLocalProvider(LocalAppSettings provides settings) {
        MaterialTheme(colorScheme = if (theme.isDark) darkColorScheme(primary = AppColors.blue, background = theme.appBackground, surface = theme.cardBackground)
                                    else lightColorScheme(primary = AppColors.blue, background = theme.appBackground, surface = theme.cardBackground)) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .background(theme.appBackground)
                    .statusBarsPadding()
                    .navigationBarsPadding()
                    .pointerInput(showsBackToList) {
                        if (!showsBackToList) return@pointerInput
                        var total = 0f
                        detectHorizontalDragGestures(
                            onDragStart = { total = 0f },
                            onDragEnd = { if (total > 70f * density) screenMode = ScreenMode.WATCHLIST },
                        ) { _, dragAmount -> total += dragAmount }
                    }
            ) {
                if (screenMode == ScreenMode.DETAIL) {
                    DetailTopBar(
                        showBack = showsBackToList, hasStock = hasStock,
                        hasAlerts = AlertCenter.hasAlerts(currentSymbol), isInWatchlist = isInWatchlist,
                        onBack = { screenMode = ScreenMode.WATCHLIST },
                        onBell = { showAlertSheet = true },
                        onToggleWatchlist = { toggleWatchlistForCurrentStock() },
                    )
                }
                Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                    when (screenMode) {
                        ScreenMode.CONVERSATIONS -> ConversationsScreen(
                            pending = pendingChat, onPendingConsumed = { pendingChat = null },
                            watchlistSymbols = watchlist.map { it.symbol },
                            autoVoiceText = autoVoiceText,
                        )
                        ScreenMode.WATCHLIST -> WatchlistScreen(
                            vm = vm, onOpenSymbol = { openSymbol(it) },
                            onAnalyzeWatchlist = { prompt ->
                                pendingChat = PendingNewChat("", "", prompt)
                                screenMode = ScreenMode.CONVERSATIONS
                            },
                        )
                        ScreenMode.SEARCH -> SearchScreen(vm = vm, onOpenSymbol = { openSymbol(it) })
                        ScreenMode.DETAIL -> DetailScreen(
                            vm = vm,
                            onAskAI = { pending -> pendingChat = pending; screenMode = ScreenMode.CONVERSATIONS },
                        )
                    }
                }
                BottomBar(screenMode = screenMode, onSelect = { screenMode = it }, onSettings = { showSettings = true })
            }

            if (showAlertSheet) {
                ModalBottomSheet(onDismissRequest = { showAlertSheet = false }, containerColor = theme.appBackground) {
                    AlertSheetContent(symbol = currentSymbol, onDismiss = { showAlertSheet = false })
                }
            }
            if (showSettings) {
                ModalBottomSheet(onDismissRequest = { showSettings = false }, containerColor = theme.appBackground) {
                    SettingsSheetContent(onDismiss = { showSettings = false })
                }
            }
        }
    }
}

@Composable
private fun DetailTopBar(
    showBack: Boolean, hasStock: Boolean, hasAlerts: Boolean, isInWatchlist: Boolean,
    onBack: () -> Unit, onBell: () -> Unit, onToggleWatchlist: () -> Unit,
) {
    val theme = LocalAppSettings.current.theme
    Row(
        modifier = Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showBack) IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, contentDescription = "Back", tint = theme.primaryText) }
        Spacer(Modifier.weight(1f))
        if (hasStock) {
            IconButton(onClick = onBell) {
                Icon(if (hasAlerts) Icons.Filled.Notifications else Icons.Filled.NotificationsNone,
                    contentDescription = "Alerts", tint = if (hasAlerts) AppColors.blue else theme.primaryText)
            }
            IconButton(onClick = onToggleWatchlist) {
                Icon(if (isInWatchlist) Icons.Filled.CheckCircle else Icons.Filled.Add,
                    contentDescription = "Watchlist", tint = if (isInWatchlist) AppColors.green else theme.primaryText)
            }
        }
    }
}

@Composable
private fun BottomBar(screenMode: ScreenMode, onSelect: (ScreenMode) -> Unit, onSettings: () -> Unit) {
    val theme = LocalAppSettings.current.theme
    Row(
        modifier = Modifier.fillMaxWidth().background(theme.appBackground).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        @Composable fun item(mode: ScreenMode?, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
            val tint = if (mode != null && screenMode == mode) AppColors.blue else theme.primaryText
            IconButton(onClick = onClick, modifier = Modifier.weight(1f).height(28.dp)) {
                Icon(icon, contentDescription = null, tint = tint)
            }
        }
        item(ScreenMode.WATCHLIST, Icons.Filled.ShowChart) { onSelect(ScreenMode.WATCHLIST) }
        item(ScreenMode.SEARCH, Icons.Filled.Search) { onSelect(ScreenMode.SEARCH) }
        item(ScreenMode.CONVERSATIONS, Icons.Outlined.Forum) { onSelect(ScreenMode.CONVERSATIONS) }
        item(null, Icons.Filled.Settings) { onSettings() }
    }
}
