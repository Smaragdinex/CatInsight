package com.catinsight.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.NorthEast
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.SouthEast
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.catinsight.app.DashboardViewModel
import com.catinsight.app.data.GainerItem
import com.catinsight.app.data.MarketIndexItem
import com.catinsight.app.data.RankingItem
import com.catinsight.app.data.SearchResult
import com.catinsight.app.ui.LocalAppSettings
import com.catinsight.app.ui.components.MiniSparkline
import com.catinsight.app.ui.theme.AppColors
import java.util.Locale

// ---- iOS 系統字級對應(pt → sp)----
private val fontBody = 17.sp          // .body
private val fontHeadline = 17.sp      // .headline(semibold)
private val fontTitle3 = 20.sp        // .title3
private val fontSubheadline = 15.sp   // .subheadline
private val fontCaption = 12.sp       // .caption
private val fontCaption2 = 11.sp      // .caption2

/**
 * 對應 iOS ContentView 的 .search 模式:
 * 上方 searchBar,下方 ScrollView 依序 rankingSection → topGainersSection → marketIndexSection。
 */
@Composable
fun SearchScreen(vm: DashboardViewModel, onOpenSymbol: (String) -> Unit) {
    // 對應 iOS selectSearchResult:清掉搜尋狀態後切到個股頁抓資料
    fun selectSearchResult(result: SearchResult) {
        val pickedSymbol = result.symbol
        vm.symbol = pickedSymbol
        vm.searchQuery = ""
        vm.searchResults = emptyList()
        vm.errorMessage = null
        onOpenSymbol(pickedSymbol)
    }

    // 對應 iOS openRankingSymbol(AI 精選 / 漲幅榜共用)
    fun openRankingSymbol(symbol: String) {
        vm.errorMessage = null
        vm.symbol = symbol
        onOpenSymbol(symbol)
    }

    // 對應 iOS openMarketIndex
    fun openMarketIndex(item: MarketIndexItem) {
        vm.symbol = item.symbol
        vm.searchResults = emptyList()
        vm.errorMessage = null
        onOpenSymbol(item.symbol)
    }

    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SearchBar(vm = vm, onSelect = { selectSearchResult(it) })

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            RankingSection(vm = vm, onOpen = { openRankingSymbol(it) })
            TopGainersSection(vm = vm, onOpen = { openRankingSymbol(it) })
            MarketIndexSection(vm = vm, onOpen = { openMarketIndex(it) })
            Spacer(Modifier.height(16.dp))   // .padding(.bottom, 16)
        }
    }
}

// MARK: - 搜尋列

/** 對應 iOS containsChinese:是否含 CJK 統一表意文字(U+4E00–U+9FFF)。 */
private fun containsChinese(text: String): Boolean = text.any { it in '\u4E00'..'\u9FFF' }

/**
 * 對應 iOS searchBar:TextField + 查詢按鈕 + 最多 5 筆候選下拉。
 * 搜尋由 ViewModel 的 searchQuery debounce(120ms)自動觸發。
 */
@Composable
private fun SearchBar(vm: DashboardViewModel, onSelect: (SearchResult) -> Unit) {
    val s = LocalAppSettings.current
    val theme = s.theme
    val shape = RoundedCornerShape(14.dp)

    // onSubmit / 查詢按鈕共用:中文 → 取第一筆;否則找代號完全相同者
    fun submit() {
        val trimmed = vm.searchQuery.trim()
        val normalized = trimmed.uppercase()
        if (containsChinese(trimmed)) {
            vm.searchResults.firstOrNull()?.let { onSelect(it) }
            return
        }
        vm.searchResults.firstOrNull { it.symbol.uppercase() == normalized }?.let { onSelect(it) }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .padding(top = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BasicTextField(
                value = vm.searchQuery,
                onValueChange = { vm.searchQuery = it },
                modifier = Modifier
                    .weight(1f)
                    .clip(shape)
                    .background(theme.cardBackground)
                    .border(1.dp, theme.divider, shape)
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                singleLine = true,
                textStyle = TextStyle(color = theme.primaryText, fontSize = fontBody),
                cursorBrush = SolidColor(theme.primaryText),
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    autoCorrectEnabled = false,
                    imeAction = ImeAction.Search,
                ),
                keyboardActions = KeyboardActions(onSearch = { submit() }),
                decorationBox = { inner ->
                    Box {
                        if (vm.searchQuery.isEmpty()) {
                            Text(
                                text = s.text.searchPlaceholder,
                                color = theme.secondaryText,
                                fontSize = fontBody,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        inner()
                    }
                },
            )

            // .buttonStyle(.borderedProminent).tint(.blue)
            Button(
                onClick = { submit() },
                enabled = !vm.isLoading,
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = AppColors.blue, contentColor = Color.White),
            ) {
                Text(s.text.searchButton, fontSize = fontBody)
            }
        }

        if (vm.searchResults.isNotEmpty()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(shape)
                    .background(theme.cardBackground)
                    .border(1.dp, theme.divider, shape),
            ) {
                vm.searchResults.take(5).forEach { result ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onSelect(result) }
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(
                                text = "${result.symbol} · ${result.name}",
                                color = theme.primaryText,
                                fontSize = fontSubheadline,
                            )
                            val exchange = result.exchange
                            if (!exchange.isNullOrEmpty()) {
                                Text(text = exchange, color = theme.secondaryText, fontSize = fontCaption)
                            }
                        }
                        Spacer(Modifier.weight(1f))
                    }
                    HorizontalDivider(thickness = 1.dp, color = theme.divider)
                }
            }
        }
    }
}

// MARK: - AI 精選排名

/** 對應 iOS rankingSection:無資料時整區不顯示。 */
@Composable
private fun RankingSection(vm: DashboardViewModel, onOpen: (String) -> Unit) {
    val s = LocalAppSettings.current
    val theme = s.theme
    if (vm.rankingItems.isEmpty()) return

    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = if (s.isZh) "AI 精選排名" else "AI Top Picks",
                color = theme.primaryText,
                fontSize = fontHeadline,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.weight(1f))
            vm.rankingAsOf?.let { asOf ->
                Text(text = asOf, color = theme.secondaryText, fontSize = fontCaption)
            }
        }

        LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(vm.rankingItems, key = { it.symbol + it.rank }) { item ->
                RankingCard(item = item, onClick = { onOpen(item.symbol) })
            }
        }
    }
}

/** 對應 iOS rankingCard。 */
@Composable
private fun RankingCard(item: RankingItem, onClick: () -> Unit) {
    val s = LocalAppSettings.current
    val theme = s.theme
    val shape = RoundedCornerShape(14.dp)

    val priceText = item.price?.let { String.format(Locale.US, "%.2f", it) } ?: "--"
    val upside = item.analystUpside ?: 0.0
    val upsideText = String.format(Locale.US, "%+.0f%%", upside * 100)
    val upsideColor = s.changeColor(upside)
    val rsiText = item.rsi?.let { String.format(Locale.US, "RSI %.0f", it) } ?: "RSI --"

    Column(
        modifier = Modifier
            .width(124.dp)
            .clip(shape)
            .clickable(onClick = onClick)
            .background(theme.cardBackground)
            .border(1.dp, theme.divider, shape)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            RankBadge(rank = item.rank, color = AppColors.blue)
            Spacer(Modifier.weight(1f))
            if (item.isNewStock == true) {
                // Image(systemName: "sparkles")
                Icon(
                    imageVector = Icons.Filled.AutoAwesome,
                    contentDescription = null,
                    tint = AppColors.yellow,
                    modifier = Modifier.size(12.dp),
                )
            }
        }

        Text(text = item.symbol, color = theme.primaryText, fontSize = fontTitle3, fontWeight = FontWeight.Bold)

        Text(text = priceText, color = theme.primaryText, fontSize = fontSubheadline, fontWeight = FontWeight.SemiBold)

        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(text = if (s.isZh) "分析師" else "Upside", color = theme.secondaryText, fontSize = fontCaption2)
            Text(text = upsideText, color = upsideColor, fontSize = fontCaption, fontWeight = FontWeight.SemiBold)
        }

        Text(text = rsiText, color = theme.secondaryText, fontSize = fontCaption2)
    }
}

/** "#N" 名次標籤(AI 精選用藍色、漲幅榜用橘色)。 */
@Composable
private fun RankBadge(rank: Int, color: Color) {
    Text(
        text = "#$rank",
        color = Color.White,
        fontSize = fontCaption2,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(color)
            .padding(horizontal = 7.dp, vertical = 3.dp),
    )
}

// MARK: - 漲幅榜

/** 對應 iOS topGainersSection:無資料時整區不顯示。 */
@Composable
private fun TopGainersSection(vm: DashboardViewModel, onOpen: (String) -> Unit) {
    val s = LocalAppSettings.current
    val theme = s.theme
    if (vm.gainerItems.isEmpty()) return

    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            // Image(systemName: "flame.fill")
            Icon(
                imageVector = Icons.Filled.LocalFireDepartment,
                contentDescription = null,
                tint = AppColors.orange,
                modifier = Modifier.size(18.dp),
            )
            Text(
                text = if (s.isZh) "漲幅榜" else "Top Gainers",
                color = theme.primaryText,
                fontSize = fontHeadline,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.weight(1f))
            GainerWindowToggle(vm = vm)
        }

        LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(vm.gainerItems, key = { it.symbol + it.rank }) { item ->
                GainerCard(item = item, onClick = { onOpen(item.symbol) })
            }
        }
    }
}

/** 對應 iOS gainerWindowToggle:近1年 / 今年 膠囊切換。 */
@Composable
private fun GainerWindowToggle(vm: DashboardViewModel) {
    val s = LocalAppSettings.current
    val theme = s.theme
    val options = listOf(
        "1y" to (if (s.isZh) "近1年" else "1Y"),
        "ytd" to (if (s.isZh) "今年" else "YTD"),
    )
    Row(
        modifier = Modifier
            .clip(CircleShape)
            .background(theme.chipBackground)
            .padding(2.dp),
    ) {
        options.forEach { (key, label) ->
            val selected = vm.gainerWindow == key
            Text(
                text = label,
                color = if (selected) Color.White else theme.secondaryText,
                fontSize = fontCaption,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(if (selected) AppColors.orange else Color.Transparent)
                    // 保留舊內容直到新資料到,避免整區閃爍/版面跳動(setGainerWindow 內處理)
                    .clickable { vm.setGainerWindow(key) }
                    .padding(horizontal = 10.dp, vertical = 5.dp),
            )
        }
    }
}

/** 對應 iOS gainerCard。 */
@Composable
private fun GainerCard(item: GainerItem, onClick: () -> Unit) {
    val s = LocalAppSettings.current
    val theme = s.theme
    val shape = RoundedCornerShape(14.dp)

    val priceText = item.price?.let { String.format(Locale.US, "%.2f", it) } ?: "--"
    val pct = item.changePct ?: 0.0
    val pctText = String.format(Locale.US, "%+.0f%%", pct * 100)

    Column(
        modifier = Modifier
            .width(124.dp)
            .clip(shape)
            .clickable(onClick = onClick)
            .background(theme.cardBackground)
            .border(1.dp, theme.divider, shape)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            RankBadge(rank = item.rank, color = AppColors.orange)
            Spacer(Modifier.weight(1f))
        }

        Text(text = item.symbol, color = theme.primaryText, fontSize = fontTitle3, fontWeight = FontWeight.Bold)

        Text(text = pctText, color = s.risingColor(), fontSize = fontTitle3, fontWeight = FontWeight.ExtraBold)

        Text(text = priceText, color = theme.secondaryText, fontSize = fontCaption, fontWeight = FontWeight.SemiBold)
    }
}

// MARK: - 市場指標

/** 對應 iOS marketIndexSection:上排重要指數、下排其餘,各自橫向捲動。 */
@Composable
private fun MarketIndexSection(vm: DashboardViewModel, onOpen: (MarketIndexItem) -> Unit) {
    val s = LocalAppSettings.current
    val theme = s.theme

    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            // Image(systemName: "globe.americas.fill")
            Icon(
                imageVector = Icons.Filled.Public,
                contentDescription = null,
                tint = AppColors.blue,
                modifier = Modifier.size(16.dp),
            )
            Text(
                text = if (s.isZh) "市場指標" else "Market Indices",
                color = theme.primaryText,
                fontSize = fontHeadline,
                fontWeight = FontWeight.SemiBold,
            )
        }

        MarketIndexRow(items = vm.marketIndicesTop, vm = vm, onOpen = onOpen)
        MarketIndexRow(items = vm.marketIndicesBottom, vm = vm, onOpen = onOpen)
    }
}

/** 對應 iOS marketIndexRow。 */
@Composable
private fun MarketIndexRow(items: List<MarketIndexItem>, vm: DashboardViewModel, onOpen: (MarketIndexItem) -> Unit) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        items(items, key = { it.symbol }) { item ->
            MarketIndexCard(item = item, vm = vm, onClick = { onOpen(item) })
        }
    }
}

/** 對應 iOS marketIndexCard(168x138)。 */
@Composable
private fun MarketIndexCard(item: MarketIndexItem, vm: DashboardViewModel, onClick: () -> Unit) {
    val s = LocalAppSettings.current
    val theme = s.theme
    val shape = RoundedCornerShape(16.dp)

    val quote = vm.marketIndexQuotes[item.symbol]
    val sparkline = quote?.sparkline ?: emptyList()
    val change = quote?.change ?: 0.0
    val moveColor = s.changeColor(change)
    val priceText = quote?.price?.let { String.format(Locale.US, "%.2f", it) } ?: "--"
    val changeText = quote?.change?.let { String.format(Locale.US, "%+.2f", it) } ?: "--"
    val changePercentText: String = run {
        val c = quote?.change ?: return@run "--"
        val prev = quote?.previousClose ?: return@run "--"
        if (prev == 0.0) return@run "--"
        String.format(Locale.US, "%+.2f%%", (c / prev) * 100)
    }
    val hasData = quote?.change != null
    val arrowIcon = if (change >= 0) Icons.Filled.NorthEast else Icons.Filled.SouthEast

    Row(
        modifier = Modifier
            .size(width = 168.dp, height = 138.dp)
            .shadow(
                elevation = 5.dp,
                shape = shape,
                ambientColor = Color.Black.copy(alpha = if (theme.isDark) 0.25f else 0.06f),
                spotColor = Color.Black.copy(alpha = if (theme.isDark) 0.25f else 0.06f),
            )
            .clip(shape)
            .clickable(onClick = onClick)
            .background(theme.cardBackground)
            .border(1.dp, if (hasData) moveColor.copy(alpha = 0.18f) else theme.divider, shape),
    ) {
        // 方向色彩的側邊強調條
        Box(
            modifier = Modifier
                .padding(vertical = 4.dp)
                .fillMaxHeight()
                .width(3.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(if (hasData) moveColor else theme.divider),
        )

        Column(
            modifier = Modifier
                .weight(1f)
                .padding(start = 10.dp, end = 12.dp)
                .padding(vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AutoShrinkText(
                    text = item.name,
                    color = theme.primaryText,
                    style = TextStyle(fontSize = fontSubheadline, fontWeight = FontWeight.Bold),
                    minScale = 0.7f,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(4.dp))
                Text(
                    text = item.symbol.replace("^", ""),
                    color = theme.secondaryText,
                    fontSize = fontCaption2,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(theme.chipBackground)
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }

            MiniSparkline(
                values = sparkline,
                color = moveColor,
                baseline = quote?.previousClose,
                modifier = Modifier.fillMaxWidth().height(34.dp),
            )

            Row(verticalAlignment = Alignment.CenterVertically) {
                AutoShrinkText(
                    text = priceText,
                    color = theme.primaryText,
                    style = TextStyle(fontSize = fontTitle3, fontWeight = FontWeight.Bold),
                    minScale = 0.5f,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(4.dp))
                if (hasData) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(3.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(moveColor.copy(alpha = 0.14f))
                            .padding(horizontal = 7.dp, vertical = 3.dp),
                    ) {
                        Icon(
                            imageVector = arrowIcon,
                            contentDescription = null,
                            tint = moveColor,
                            modifier = Modifier.size(9.dp),
                        )
                        Text(
                            text = changePercentText,
                            color = moveColor,
                            fontSize = fontCaption2,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                        )
                    }
                }
            }

            if (hasData) {
                Text(text = changeText, color = theme.secondaryText, fontSize = fontCaption2)
            }
        }
    }
}

// MARK: - 共用小工具

/**
 * 對應 iOS .lineLimit(1).minimumScaleFactor(x):單行放不下時逐步縮小字級,最低到 minScale。
 */
@Composable
private fun AutoShrinkText(
    text: String,
    color: Color,
    style: TextStyle,
    minScale: Float,
    modifier: Modifier = Modifier,
) {
    var scale by remember(text) { mutableFloatStateOf(1f) }
    Text(
        text = text,
        color = color,
        style = style.copy(fontSize = style.fontSize * scale),
        maxLines = 1,
        softWrap = false,
        overflow = TextOverflow.Clip,
        modifier = modifier,
        onTextLayout = { result ->
            if (result.hasVisualOverflow && scale > minScale) {
                scale = (scale - 0.05f).coerceAtLeast(minScale)
            }
        },
    )
}
