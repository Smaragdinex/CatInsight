package com.catinsight.app.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.ArrowCircleUp
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.ViewSidebar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.catinsight.app.data.AIChatMessage
import com.catinsight.app.data.ChatStore
import com.catinsight.app.data.PendingNewChat
import com.catinsight.app.data.SavedChat
import com.catinsight.app.data.StockApiService
import com.catinsight.app.ui.LocalAppSettings
import com.catinsight.app.ui.theme.AppColors
import com.catinsight.app.ui.voice.VoiceChatScreen
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

// 對應 iOS ConversationsView:主區是聊天,左上角可開合左側欄(顯示歷史對話,點下去繼續)。

private val SIDEBAR_WIDTH = 290.dp
private const val ANIM_MS = 220

/** 無漣漪的點擊(對應 iOS 的 Button(.plain) / onTapGesture)。 */
private fun Modifier.tap(enabled: Boolean = true, onClick: () -> Unit): Modifier = this.then(
    Modifier.clickable(interactionSource = MutableInteractionSource(), indication = null, enabled = enabled, onClick = onClick)
)

/**
 * [autoVoiceText] 只在 DEBUG 測試用:有值時,pending 對話開好後直接開語音畫面,並把這句當使用者說的話送出。
 */
@Composable
fun ConversationsScreen(
    pending: PendingNewChat?,
    onPendingConsumed: () -> Unit,
    watchlistSymbols: List<String>,
    autoVoiceText: String? = null,
) {
    val s = LocalAppSettings.current
    val theme = s.theme
    val isZh = s.isZh
    val scope = rememberCoroutineScope()
    val focusManager = LocalFocusManager.current

    // ---- 狀態(對應 iOS @State) ----
    var current by remember { mutableStateOf<SavedChat?>(null) }
    val messages = remember { mutableStateListOf<AIChatMessage>() }
    var input by remember { mutableStateOf("") }
    var isSending by remember { mutableStateOf(false) }
    var showSidebar by remember { mutableStateOf(false) }
    var searchText by remember { mutableStateOf("") }
    var showMsgSearch by remember { mutableStateOf(false) }
    var msgSearch by remember { mutableStateOf("") }
    var chatToDelete by remember { mutableStateOf<SavedChat?>(null) }
    var showVoice by remember { mutableStateOf(false) }                       // 全螢幕語音對話
    var voiceAutoText by remember { mutableStateOf(autoVoiceText) }           // 測試鉤子,用過一次就清掉
    val chats = ChatStore.chats

    // ---- 邏輯 ----
    fun load(chat: SavedChat) {
        current = chat
        messages.clear(); messages.addAll(chat.messages)
        input = ""
    }

    fun clear() {
        current = null; messages.clear(); input = ""
    }

    /** 有股票就用代碼當標題(資料夾);一般對話用第一個問題當標題。 */
    fun save() {
        val chat = current ?: return
        if (messages.isEmpty()) return
        val title = if (chat.symbol.isNotEmpty()) chat.symbol
        else messages.firstOrNull { it.role == "user" }?.content?.take(40) ?: (if (isZh) "新對話" else "New chat")
        val updated = SavedChat(id = chat.id, symbol = chat.symbol, date = System.currentTimeMillis(),
            title = title, messages = messages.toList())
        ChatStore.upsert(updated)
        current = updated
    }

    fun send() {
        val chat = current ?: return
        val text = input.trim()
        if (text.isEmpty()) return
        messages.add(AIChatMessage(role = "user", content = text))
        input = ""
        focusManager.clearFocus()   // 發送後收起鍵盤
        isSending = true
        val payload = messages.toList()
        val symbol = chat.symbol
        scope.launch {
            try {
                val resp = StockApiService.default.sendAIChat(symbol, s.langCode, payload, watchlistSymbols)
                messages.add(AIChatMessage(role = "assistant",
                    content = resp.reply.ifEmpty { if (isZh) "(沒有回應)" else "(no response)" }))
                save()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                messages.add(AIChatMessage(role = "assistant",
                    content = if (isZh) "回覆失敗,請再試一次。" else "Reply failed, please try again."))
            } finally {
                isSending = false
            }
        }
    }

    /** 開一段新對話並立刻送出 prompt(快捷用,如 watchlist 健康報告)。 */
    fun startAndSend(symbol: String, title: String, prompt: String) {
        val sym = symbol.trim().uppercase()
        current = SavedChat(symbol = sym, date = System.currentTimeMillis(), title = title, messages = emptyList())
        messages.clear()
        input = prompt
        showSidebar = false
        send()
    }

    /** ➕ 直接開一個空白新對話(不指定股票),AI 先打招呼,使用者可問任何股票。 */
    fun startGeneralChat() {
        val greet = if (isZh) "你好!想問哪支股票都可以,也可以請我分析你的 watchlist 股票池健康狀況。"
        else "Hi! Ask about any stock, or ask me to analyze your watchlist's health."
        val seed = listOf(AIChatMessage(role = "assistant", content = greet))
        current = SavedChat(symbol = "", date = System.currentTimeMillis(),
            title = if (isZh) "新對話" else "New chat", messages = seed)
        messages.clear(); messages.addAll(seed)
        input = ""
        showSidebar = false
    }

    fun startNew(symbol: String, briefing: String) {
        val sym = symbol.trim().uppercase()
        if (sym.isEmpty()) return
        // 同一支股票就是同一個對話框:已有該股對話則接續,沒有才新建
        val existing = chats.firstOrNull { it.symbol == sym }
        if (existing != null) {
            load(existing)
            showSidebar = false
            return
        }
        val seed = if (briefing.trim().isEmpty()) emptyList()
        else listOf(AIChatMessage(role = "assistant", content = briefing))
        current = SavedChat(symbol = sym, date = System.currentTimeMillis(), title = sym, messages = seed)
        messages.clear(); messages.addAll(seed)
        input = ""
        showSidebar = false
    }

    // onAppear + onChange(of: pending):有 pending 就開該股新對話,否則載入最新一筆
    LaunchedEffect(pending) {
        val p = pending
        if (p != null) {
            onPendingConsumed()
            if (p.autoPrompt.isNotEmpty()) {
                startAndSend(p.symbol, if (isZh) "Watchlist 健康" else "Watchlist health", p.autoPrompt)
            } else {
                startNew(p.symbol, p.briefing)
                // 測試鉤子(DEBUG):對話開好後直接進語音畫面;沒有指定股票就開一般對話
                if (!voiceAutoText.isNullOrEmpty()) {
                    if (current == null) startGeneralChat()
                    showVoice = true
                }
            }
        } else if (current == null) {
            chats.firstOrNull()?.let { load(it) }
        }
    }

    // Android 返回鍵:先關刪除確認 / 側欄(外殼的 BackHandler 才會切回搜尋頁)
    BackHandler(enabled = chatToDelete != null || showSidebar) {
        if (chatToDelete != null) chatToDelete = null else showSidebar = false
    }

    // 對話內搜尋:有關鍵字時只顯示含關鍵字的訊息
    val msgQuery = msgSearch.trim().lowercase()
    val displayedMessages: List<AIChatMessage> =
        if (showMsgSearch && msgQuery.isNotEmpty()) messages.filter { it.content.lowercase().contains(msgQuery) }
        else messages.toList()

    val chatQuery = searchText.trim().lowercase()
    val filteredChats: List<SavedChat> =
        if (chatQuery.isEmpty()) chats.toList()
        else chats.filter { it.symbol.lowercase().contains(chatQuery) || it.title.lowercase().contains(chatQuery) }

    val canSend = current != null && input.trim().isNotEmpty() && !isSending

    fun displayName(chat: SavedChat): String {
        if (chat.symbol.isNotEmpty()) return chat.symbol
        val u = chat.messages.firstOrNull { it.role == "user" }?.content
        if (!u.isNullOrEmpty()) return u.take(20)
        return if (isZh) "新對話" else "New chat"
    }

    fun lastPreview(chat: SavedChat): String {
        val lastUser = chat.messages.lastOrNull { it.role == "user" }?.content
        if (!lastUser.isNullOrEmpty()) return lastUser.take(24)
        return if (isZh) "${chat.messages.count()} 則訊息" else "${chat.messages.count()} msgs"
    }

    // ================= 空狀態 =================
    @Composable
    fun emptyState() {
        Column(
            Modifier.fillMaxSize().padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        ) {
            Icon(Icons.Outlined.Forum, contentDescription = null,
                tint = theme.secondaryText.copy(alpha = theme.secondaryText.alpha * 0.5f), modifier = Modifier.size(44.dp))
            Text(if (isZh) "從左側選擇一段對話繼續" else "Pick a conversation from the sidebar",
                fontSize = 15.sp, color = theme.secondaryText)
            Text(if (isZh) "或在個股頁用「AI 研究助理」開始新對話" else "or start one from a stock's AI assistant",
                fontSize = 12.sp, color = theme.secondaryText.copy(alpha = theme.secondaryText.alpha * 0.8f),
                textAlign = TextAlign.Center)
            Text(
                if (isZh) "開啟對話紀錄" else "Open history",
                fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Color.White,
                modifier = Modifier
                    .padding(top = 4.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(AppColors.blue)
                    .tap { showSidebar = true }
                    .padding(horizontal = 16.dp, vertical = 10.dp),
            )
        }
    }

    // ================= 輸入列 =================
    @Composable
    fun inputBar() {
        Row(
            Modifier.fillMaxWidth().background(theme.appBackground).padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            PlainTextField(
                value = input, onValueChange = { input = it },
                placeholder = if (isZh) "繼續問…" else "Continue…",
                textColor = theme.primaryText, placeholderColor = theme.secondaryText,
                fontSize = 15.sp, maxLines = 5,
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(18.dp))
                    .background(theme.cardBackground)
                    .border(1.dp, theme.divider, RoundedCornerShape(18.dp))
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            )
            if (input.trim().isEmpty()) {
                // 輸入框空白:顯示 waveform,點了進語音對話(像 ChatGPT 的語音模式)
                Icon(
                    Icons.Filled.GraphicEq, contentDescription = "Voice",
                    tint = if (isSending) theme.secondaryText.copy(alpha = theme.secondaryText.alpha * 0.4f) else AppColors.blue,
                    modifier = Modifier.size(32.dp).tap(enabled = !isSending) {
                        focusManager.clearFocus()
                        if (current == null) startGeneralChat()
                        showVoice = true
                    },
                )
            } else {
                Icon(
                    Icons.Filled.ArrowCircleUp, contentDescription = "Send",
                    tint = if (canSend) AppColors.blue else theme.secondaryText.copy(alpha = theme.secondaryText.alpha * 0.4f),
                    modifier = Modifier.size(32.dp).tap(enabled = canSend) { send() },
                )
            }
        }
    }

    // ================= 左側欄 =================
    @Composable
    fun sidebarRow(chat: SavedChat) {
        val isActive = current?.id == chat.id
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(if (isActive) AppColors.blue.copy(alpha = 0.15f) else Color.Transparent)
                .border(1.dp, theme.divider, RoundedCornerShape(10.dp))
                .padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(
                Modifier.weight(1f).tap { load(chat); showSidebar = false },
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(displayName(chat), fontSize = 15.sp, fontWeight = FontWeight.Bold, color = theme.primaryText,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(lastPreview(chat) + " · " + relativeTime(chat.date, isZh),
                    fontSize = 11.sp, color = theme.secondaryText, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            // 個別刪除:先確認再刪
            Icon(Icons.Outlined.Delete, contentDescription = "Delete", tint = AppColors.red,
                modifier = Modifier.size(18.dp).tap { chatToDelete = chat })
        }
    }

    @Composable
    fun sidebar() {
        Column(
            Modifier.fillMaxHeight().width(SIDEBAR_WIDTH).background(theme.cardBackground)
                .tap { }   // 吃掉點擊,避免穿透到遮罩
        ) {
            Row(
                Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(if (isZh) "對話紀錄" else "History", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = theme.primaryText)
                Spacer(Modifier.weight(1f))
                Icon(Icons.Filled.AddCircle, contentDescription = "New chat", tint = AppColors.blue,
                    modifier = Modifier.size(24.dp).tap { startGeneralChat() })
                Icon(Icons.Filled.ChevronLeft, contentDescription = "Close", tint = theme.secondaryText,
                    modifier = Modifier.size(22.dp).tap { showSidebar = false })
            }

            // 搜尋框:快速找對話(代碼或標題)
            if (chats.isNotEmpty()) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = 12.dp, end = 12.dp, bottom = 8.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(theme.appBackground)
                        .border(1.dp, theme.divider, RoundedCornerShape(10.dp))
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon(Icons.Filled.Search, contentDescription = null, tint = theme.secondaryText, modifier = Modifier.size(14.dp))
                    PlainTextField(
                        value = searchText, onValueChange = { searchText = it },
                        placeholder = if (isZh) "搜尋對話…" else "Search…",
                        textColor = theme.primaryText, placeholderColor = theme.secondaryText,
                        fontSize = 15.sp, modifier = Modifier.weight(1f),
                    )
                    if (searchText.isNotEmpty()) {
                        Icon(Icons.Filled.Cancel, contentDescription = "Clear", tint = theme.secondaryText,
                            modifier = Modifier.size(14.dp).tap { searchText = "" })
                    }
                }
            }

            when {
                chats.isEmpty() -> Column(
                    Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
                ) {
                    Icon(Icons.Outlined.Inbox, contentDescription = null,
                        tint = theme.secondaryText.copy(alpha = theme.secondaryText.alpha * 0.5f), modifier = Modifier.size(28.dp))
                    Text(if (isZh) "還沒有對話" else "No conversations", fontSize = 12.sp, color = theme.secondaryText)
                }
                filteredChats.isEmpty() -> Column(
                    Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
                ) {
                    Icon(Icons.Filled.Search, contentDescription = null,
                        tint = theme.secondaryText.copy(alpha = theme.secondaryText.alpha * 0.5f), modifier = Modifier.size(28.dp))
                    Text(if (isZh) "找不到符合的對話" else "No matches", fontSize = 12.sp, color = theme.secondaryText)
                }
                else -> LazyColumn(
                    Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 4.dp, bottom = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(filteredChats, key = { it.id }) { chat -> sidebarRow(chat) }
                }
            }
        }
    }

    // ================= 刪除確認 =================
    @Composable
    fun deleteConfirm(target: SavedChat) {
        Box(
            Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f)).tap { chatToDelete = null },
            contentAlignment = Alignment.Center,
        ) {
            Column(
                Modifier
                    .padding(40.dp)
                    .widthIn(max = 300.dp)
                    .clip(RoundedCornerShape(18.dp))
                    .background(theme.appBackground)
                    .border(1.dp, theme.divider, RoundedCornerShape(18.dp))
                    .tap { }   // 吃掉點擊,避免穿透到遮罩
                    .padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(if (isZh) "確定刪除嗎?" else "Delete this conversation?",
                    fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = theme.primaryText)
                Text(
                    if (isZh) "將刪除「${target.symbol}」的對話,無法復原。"
                    else "This will delete the ${target.symbol} conversation.",
                    fontSize = 15.sp, color = theme.secondaryText, textAlign = TextAlign.Center,
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(
                        Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(12.dp))
                            .background(AppColors.red)
                            .tap {
                                ChatStore.delete(target)
                                if (current?.id == target.id) clear()
                                chatToDelete = null
                            }
                            .padding(vertical = 11.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(if (isZh) "刪除" else "Delete", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                    }
                    Box(
                        Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(12.dp))
                            .background(theme.cardBackground)
                            .border(1.dp, theme.divider, RoundedCornerShape(12.dp))
                            .tap { chatToDelete = null }
                            .padding(vertical = 11.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(if (isZh) "取消" else "Cancel", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = theme.primaryText)
                    }
                }
            }
        }
    }

    // ================= 主聊天區 =================
    @Composable
    fun chatPane() {
        Column(Modifier.fillMaxSize().imePadding()) {
            // 標題列:側欄開關 + 標題 + 訊息搜尋
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(
                    Icons.Outlined.ViewSidebar, contentDescription = "Sidebar", tint = theme.primaryText,
                    modifier = Modifier.size(24.dp).tap { showSidebar = !showSidebar },
                )
                Text(
                    current?.let { displayName(it) } ?: (if (isZh) "對話" else "Conversations"),
                    fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = theme.primaryText,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                )
                if (current != null) {
                    Icon(
                        Icons.Filled.Search, contentDescription = "Search",
                        tint = if (showMsgSearch) AppColors.blue else theme.primaryText,
                        modifier = Modifier.size(24.dp).tap {
                            showMsgSearch = !showMsgSearch
                            if (!showMsgSearch) msgSearch = ""
                        },
                    )
                }
            }

            // 對話內搜尋:在這段對話找含關鍵字的訊息(例:eps)
            AnimatedVisibility(visible = showMsgSearch && current != null) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = 12.dp, end = 12.dp, bottom = 6.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(theme.cardBackground)
                        .border(1.dp, theme.divider, RoundedCornerShape(10.dp))
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon(Icons.Filled.Search, contentDescription = null, tint = theme.secondaryText, modifier = Modifier.size(14.dp))
                    PlainTextField(
                        value = msgSearch, onValueChange = { msgSearch = it },
                        placeholder = if (isZh) "在這段對話搜尋…" else "Search in this chat…",
                        textColor = theme.primaryText, placeholderColor = theme.secondaryText,
                        fontSize = 15.sp, modifier = Modifier.weight(1f),
                    )
                    if (msgSearch.isNotEmpty()) {
                        Text("${displayedMessages.size}", fontSize = 11.sp, color = theme.secondaryText)
                        Icon(Icons.Filled.Cancel, contentDescription = "Clear", tint = theme.secondaryText,
                            modifier = Modifier.size(14.dp).tap { msgSearch = "" })
                    }
                }
            }

            HorizontalDivider(color = theme.divider)

            if (current == null) {
                emptyState()
            } else {
                val listState = rememberLazyListState()
                // 訊息數 / 送出狀態改變 → 捲到最底
                LaunchedEffect(messages.size, isSending) {
                    val lastIdx = if (isSending) displayedMessages.size else displayedMessages.lastIndex
                    if (lastIdx >= 0) listState.animateScrollToItem(lastIdx)
                }
                LazyColumn(
                    state = listState,
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .tap { focusManager.clearFocus() },   // 點訊息區空白收鍵盤
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(displayedMessages, key = { it.id }) { msg ->
                        bubble(role = msg.role, text = msg.content)
                    }
                    if (isSending) {
                        item(key = "thinking") {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                CircularProgressIndicator(modifier = Modifier.size(16.dp), color = theme.primaryText, strokeWidth = 2.dp)
                                Text(if (isZh) "思考中…" else "Thinking…", fontSize = 12.sp, color = theme.secondaryText)
                            }
                        }
                    }
                }
                inputBar()
            }
        }
    }

    // ================= 組合(對應 iOS ZStack) =================
    Box(Modifier.fillMaxSize()) {
        chatPane()

        // 半透明遮罩:點擊關閉側欄
        AnimatedVisibility(
            visible = showSidebar,
            enter = fadeIn(tween(ANIM_MS)), exit = fadeOut(tween(ANIM_MS)),
        ) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.35f)).tap { showSidebar = false })
        }
        // 側欄:由左滑入
        AnimatedVisibility(
            visible = showSidebar,
            enter = slideInHorizontally(tween(ANIM_MS)) { -it },
            exit = slideOutHorizontally(tween(ANIM_MS)) { -it },
        ) {
            sidebar()
        }

        chatToDelete?.let { deleteConfirm(it) }
    }

    // 全螢幕語音對話(對應 iOS fullScreenCover):每完成一輪就 append 進 messages 並存檔
    if (showVoice) {
        Dialog(
            onDismissRequest = { showVoice = false; voiceAutoText = null },
            properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
        ) {
            VoiceChatScreen(
                symbol = current?.symbol ?: "",
                history = messages.toList(),
                watchlist = watchlistSymbols,
                onExchange = { user, reply ->
                    messages.add(AIChatMessage(role = "user", content = user))
                    messages.add(AIChatMessage(role = "assistant", content = reply))
                    save()
                },
                onClose = { showVoice = false; voiceAutoText = null },
                autoText = voiceAutoText,
            )
        }
    }
}

// ================= 訊息氣泡 =================

@Composable
private fun bubble(role: String, text: String) {
    val theme = LocalAppSettings.current.theme
    val isUser = role == "user"
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        if (isUser) Spacer(Modifier.width(40.dp))   // Spacer(minLength: 40)
        Text(
            text, fontSize = 15.sp,
            color = if (isUser) Color.White else theme.primaryText,
            modifier = Modifier
                .weight(1f, fill = false)
                .clip(RoundedCornerShape(16.dp))
                .background(if (isUser) AppColors.blue else theme.cardBackground)
                .border(1.dp, if (isUser) Color.Transparent else theme.divider, RoundedCornerShape(16.dp))
                .padding(horizontal = 13.dp, vertical = 10.dp),
        )
        if (!isUser) Spacer(Modifier.width(40.dp))
    }
}

// ================= 純文字輸入框(對應 iOS TextField,無 Material 外框) =================

@Composable
private fun PlainTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    textColor: Color,
    placeholderColor: Color,
    fontSize: TextUnit,
    modifier: Modifier = Modifier,
    maxLines: Int = 1,
) {
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier,
        textStyle = TextStyle(color = textColor, fontSize = fontSize),
        cursorBrush = SolidColor(AppColors.blue),
        singleLine = maxLines == 1,
        maxLines = maxLines,
        keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
        decorationBox = { inner ->
            Box(contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty()) Text(placeholder, color = placeholderColor, fontSize = fontSize, maxLines = 1)
                inner()
            }
        },
    )
}

// ================= 相對時間(對應 iOS RelativeDateTimeFormatter,zh_TW / en_US) =================

private fun relativeTime(epochMillis: Long, isZh: Boolean): String {
    val diffSec = ((System.currentTimeMillis() - epochMillis) / 1000).coerceAtLeast(0)
    val min = diffSec / 60
    val hour = min / 60
    val day = hour / 24
    val week = day / 7
    val month = day / 30
    val year = day / 365
    fun en(n: Long, unit: String) = "$n $unit${if (n == 1L) "" else "s"} ago"
    return when {
        diffSec < 60 -> if (isZh) "$diffSec 秒前" else en(diffSec, "second")
        min < 60 -> if (isZh) "$min 分鐘前" else en(min, "minute")
        hour < 24 -> if (isZh) "$hour 小時前" else en(hour, "hour")
        day < 7 -> if (isZh) "$day 天前" else en(day, "day")
        day < 30 -> if (isZh) "$week 週前" else en(week, "week")
        day < 365 -> if (isZh) "$month 個月前" else en(month, "month")
        else -> if (isZh) "$year 年前" else en(year, "year")
    }
}
