package com.catinsight.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import com.catinsight.app.DashboardViewModel
import com.catinsight.app.data.WatchlistItem
import com.catinsight.app.data.WatchlistStore
import com.catinsight.app.ui.LocalAppSettings
import com.catinsight.app.ui.components.MiniSparkline
import com.catinsight.app.ui.theme.AppColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import java.util.Locale

/**
 * 對應 iOS ContentView.watchlistView:自選清單頁。
 * - 標題列 + 「分析」按鈕(清單空時不顯示)
 * - 每列:代號/公司名(寬 110)、迷你走勢圖、價格膠囊;點列開啟個股
 * - 由右往左滑刪除(iOS swipeActions trailing)
 * - 長按拖曳排序(iOS List.onMove)
 */
@Composable
fun WatchlistScreen(vm: DashboardViewModel, onOpenSymbol: (String) -> Unit, onAnalyzeWatchlist: (prompt: String) -> Unit) {
    val s = LocalAppSettings.current
    val theme = s.theme
    val watchlist = WatchlistStore.items

    Column(
        modifier = Modifier.fillMaxSize().padding(top = 10.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // ---- 標題列 ----
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = s.text.listsTitle,
                fontSize = 20.sp,               // iOS .title3
                fontWeight = FontWeight.Bold,
                color = theme.primaryText,
            )
            Spacer(Modifier.weight(1f))
            if (watchlist.isNotEmpty()) {
                // iOS 原文 prompt(中/英)
                val prompt = if (s.isZh)
                    "幫我分析我的 watchlist 股票池健康狀況:集中度、動能與超買/超賣、估值 vs 分析師目標,以及最強/最弱的持股。"
                else
                    "Analyze my watchlist's health: concentration, momentum & overbought/oversold, valuation vs analyst targets, and strongest/weakest holdings."
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(AppColors.blue)
                        .clickable { onAnalyzeWatchlist(prompt) }
                        .padding(horizontal = 12.dp, vertical = 7.dp),
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.AutoAwesome, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                    Text(
                        text = if (s.isZh) "分析" else "Analyze",
                        fontSize = 15.sp,           // iOS .subheadline
                        fontWeight = FontWeight.SemiBold,
                        color = Color.White,
                    )
                }
            }
        }

        if (watchlist.isEmpty()) {
            // ---- 空清單 ----
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    text = s.text.emptyListsText,
                    color = theme.secondaryText,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        } else {
            WatchlistList(vm = vm, onOpenSymbol = onOpenSymbol)
        }
    }
}

/** 長按拖曳排序的共享狀態(以 symbol 當 key,避免排序中 index 變動造成錯亂)。 */
private class ReorderState {
    var draggingKey by mutableStateOf<String?>(null)
    var dragOffset by mutableFloatStateOf(0f)

    fun reset() { draggingKey = null; dragOffset = 0f }
}

/**
 * 依目前拖曳位移,判斷是否要把拖曳中的項目與別的項目換位。
 * 會呼叫 WatchlistStore.move(from, to),並補償位移量讓畫面不跳動。
 */
private fun moveIfNeeded(listState: LazyListState, reorder: ReorderState) {
    val key = reorder.draggingKey ?: return
    val visible = listState.layoutInfo.visibleItemsInfo
    val me = visible.firstOrNull { it.key == key } ?: return
    val center = me.offset + me.size / 2f + reorder.dragOffset
    val target = visible.firstOrNull { it.key != key && center >= it.offset && center < it.offset + it.size } ?: return
    val items = WatchlistStore.items
    val from = items.indexOfFirst { it.symbol == key }
    val to = items.indexOfFirst { it.symbol == target.key }
    if (from < 0 || to < 0 || from == to) return
    // 往下移:自己的底會對齊 target 的底;往上移:自己的頂對齊 target 的頂
    val delta = if (to > from) (target.offset + target.size) - (me.offset + me.size) else target.offset - me.offset
    WatchlistStore.move(from, to)
    reorder.dragOffset -= delta
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WatchlistList(vm: DashboardViewModel, onOpenSymbol: (String) -> Unit) {
    val s = LocalAppSettings.current
    val theme = s.theme
    val watchlist = WatchlistStore.items
    val listState = rememberLazyListState()
    val reorder = remember { ReorderState() }
    val haptic = LocalHapticFeedback.current

    // 拖曳到清單上下邊緣時自動捲動
    LaunchedEffect(reorder.draggingKey) {
        val key = reorder.draggingKey ?: return@LaunchedEffect
        while (isActive && reorder.draggingKey == key) {
            val info = listState.layoutInfo
            val me = info.visibleItemsInfo.firstOrNull { it.key == key }
            if (me != null) {
                val top = me.offset + reorder.dragOffset
                val bottom = top + me.size
                val step = when {
                    top < info.viewportStartOffset -> -12f
                    bottom > info.viewportEndOffset -> 12f
                    else -> 0f
                }
                if (step != 0f) {
                    val consumed = listState.scrollBy(step)
                    // 清單捲動後項目 layout 位置改變,補回位移讓被拖的列跟著手指
                    reorder.dragOffset += consumed
                    moveIfNeeded(listState, reorder)
                }
            }
            delay(16)
        }
    }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize().background(theme.appBackground),
    ) {
        itemsIndexed(watchlist, key = { _, item -> item.symbol }) { _, item ->
            val isDragging = reorder.draggingKey == item.symbol
            val quote = vm.watchlistQuotes[item.symbol]
            val sparkline = quote?.sparkline ?: emptyList()
            val first = sparkline.firstOrNull()
            val last = sparkline.lastOrNull()
            // 走勢色:首尾比較;持平或無資料用 secondaryText
            val moveColor = when {
                first == null || last == null -> theme.secondaryText
                last > first -> s.risingColor()
                last < first -> s.fallingColor()
                else -> theme.secondaryText
            }

            val currentSymbol by rememberUpdatedState(item.symbol)
            val onRemove by rememberUpdatedState<() -> Unit>({
                // 對應 iOS removeWatchlistItem:輕觸覺回饋 + 移除 + 清掉報價
                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                WatchlistStore.remove(currentSymbol)
                vm.watchlistQuotes = vm.watchlistQuotes - currentSymbol
            })

            val dismissState = rememberSwipeToDismissBoxState(
                confirmValueChange = { value ->
                    if (value == SwipeToDismissBoxValue.EndToStart) { onRemove(); true } else false
                },
            )
            // 防護:同一代號刪除後又重新加入時,LazyColumn 可能還原舊的「已滑除」狀態 → 復位
            LaunchedEffect(dismissState.currentValue) {
                if (dismissState.currentValue == SwipeToDismissBoxValue.EndToStart && WatchlistStore.contains(item.symbol)) {
                    dismissState.reset()
                }
            }

            val itemModifier = Modifier
                .fillMaxWidth()
                .zIndex(if (isDragging) 1f else 0f)
                .graphicsLayer { translationY = if (isDragging) reorder.dragOffset else 0f }
                .then(if (isDragging) Modifier else Modifier.animateItem())

            SwipeToDismissBox(
                state = dismissState,
                modifier = itemModifier,
                enableDismissFromStartToEnd = false,
                enableDismissFromEndToStart = true,
                gesturesEnabled = reorder.draggingKey == null,
                backgroundContent = {
                    // 對應 iOS swipeActions:紅底 + 垃圾桶
                    Box(
                        modifier = Modifier.fillMaxSize().background(AppColors.red).padding(end = 20.dp),
                        contentAlignment = Alignment.CenterEnd,
                    ) {
                        Icon(Icons.Filled.Delete, contentDescription = null, tint = Color.White)
                    }
                },
            ) {
                WatchlistRow(
                    item = item,
                    price = quote?.price,
                    sparkline = sparkline,
                    moveColor = moveColor,
                    isDragging = isDragging,
                    onClick = { onOpenSymbol(item.symbol) },
                    modifier = Modifier.pointerInput(item.symbol) {
                        detectDragGesturesAfterLongPress(
                            onDragStart = {
                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                reorder.draggingKey = currentSymbol
                                reorder.dragOffset = 0f
                            },
                            onDragEnd = { reorder.reset() },
                            onDragCancel = { reorder.reset() },
                            onDrag = { change, dragAmount ->
                                change.consume()
                                reorder.dragOffset += dragAmount.y
                                moveIfNeeded(listState, reorder)
                            },
                        )
                    },
                )
            }
        }
    }
}

/** 單列:代號+公司名(110dp) / 迷你走勢圖(置中) / 價格膠囊。 */
@Composable
private fun WatchlistRow(
    item: WatchlistItem,
    price: Double?,
    sparkline: List<Double>,
    moveColor: Color,
    isDragging: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val theme = LocalAppSettings.current.theme
    Column(
        modifier = modifier
            .fillMaxWidth()
            // 拖曳中略微提亮,讓使用者知道抓到了
            .background(if (isDragging) theme.chipBackground else theme.appBackground)
            .clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 6.dp)
                .padding(vertical = 6.dp),   // iOS: 列內 padding(.vertical, 6) + List 預設列間距
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.width(110.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = item.symbol,
                    fontSize = 17.sp,               // iOS .headline
                    fontWeight = FontWeight.SemiBold,
                    color = theme.primaryText,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = item.name,
                    fontSize = 12.sp,               // iOS .caption
                    color = theme.secondaryText,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            // iOS: MiniSparklineView 固定 92x34,外層 maxWidth infinity → 置中
            Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
                MiniSparkline(values = sparkline, color = moveColor)
            }

            // 價格膠囊:白字、背景走勢色
            Box(
                modifier = Modifier
                    .widthIn(min = 85.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(moveColor)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                ShrinkToFitText(
                    text = formattedListPrice(price),
                    color = Color.White,
                    maxFontSizeSp = 15f,            // iOS .subheadline
                    minScale = 0.5f,                // iOS minimumScaleFactor(0.5)
                )
            }
        }
        HorizontalDivider(color = theme.divider, thickness = 0.5.dp)
    }
}

/**
 * 對應 iOS Text.minimumScaleFactor:單行放不下時逐步縮小字級,最低到 maxFontSize * minScale。
 */
@Composable
private fun ShrinkToFitText(text: String, color: Color, maxFontSizeSp: Float, minScale: Float) {
    // 以 0.5sp 為單位逐步縮小;文字改變時重置
    var shrinkSteps by remember(text) { mutableIntStateOf(0) }
    val minSp = maxFontSizeSp * minScale
    val fontSp = (maxFontSizeSp - shrinkSteps * 0.5f).coerceAtLeast(minSp)
    Text(
        text = text,
        color = color,
        fontSize = fontSp.sp,
        fontWeight = FontWeight.Bold,
        maxLines = 1,
        softWrap = false,
        textAlign = TextAlign.Center,
        onTextLayout = { result ->
            if (result.didOverflowWidth && fontSp > minSp) shrinkSteps += 1
        },
    )
}

/** 對應 iOS formattedListPrice:"$%.2f",無值顯示 "--"。 */
private fun formattedListPrice(value: Double?): String =
    value?.let { String.format(Locale.US, "$%.2f", it) } ?: "--"
