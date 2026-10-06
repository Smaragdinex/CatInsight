package com.catinsight.app.ui.voice

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.catinsight.app.BuildConfig
import com.catinsight.app.data.AIChatMessage
import com.catinsight.app.ui.LocalAppSettings
import com.catinsight.app.ui.theme.AppColors

/** iOS systemPurple 近似值(AppColors 沒有紫色)。 */
private val purple = Color(0xFFAF52DE)

/**
 * 對應 iOS VoiceChatView:全螢幕語音對話。
 * 中間會呼吸的圓(聽藍/想紫/說綠,依音量縮放),點一下可打斷 AI 或提早送出;右上角 X 離開。
 * [autoText] 只在 DEBUG 生效:跳過麥克風直接把這句當使用者輸入(模擬器沒麥克風)。
 */
@Composable
fun VoiceChatScreen(
    symbol: String,
    history: List<AIChatMessage>,
    watchlist: List<String>,
    onExchange: (String, String) -> Unit,
    onClose: () -> Unit,
    autoText: String? = null,
) {
    val s = LocalAppSettings.current
    val theme = s.theme
    val isZh = s.isZh
    val context = LocalContext.current

    // 回呼用 rememberUpdatedState 讀最新值,session 只建一次
    val onExchangeState = rememberUpdatedState(onExchange)
    val onCloseState = rememberUpdatedState(onClose)
    val session = remember {
        VoiceSession(context, symbol, isZh, history, watchlist) { user, reply -> onExchangeState.value(user, reply) }
    }

    // 權限:進畫面時要 RECORD_AUDIO,拒絕就顯示錯誤字
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) session.start() else session.failPermissionDenied()
    }
    LaunchedEffect(Unit) {
        if (BuildConfig.DEBUG && !autoText.isNullOrEmpty()) {
            session.start(autoText)
            return@LaunchedEffect
        }
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (granted) session.start() else permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
    }
    // 離開畫面:釋放 recognizer 與 tts
    DisposableEffect(Unit) { onDispose { session.release() } }

    val orbColor = when (session.phase) {
        VoiceSession.Phase.LISTENING -> AppColors.blue
        VoiceSession.Phase.THINKING -> purple
        VoiceSession.Phase.SPEAKING -> AppColors.green
        VoiceSession.Phase.IDLE, VoiceSession.Phase.ERROR -> theme.secondaryText
    }
    val statusText = when (session.phase) {
        VoiceSession.Phase.IDLE -> if (isZh) "準備中…" else "Getting ready…"
        VoiceSession.Phase.LISTENING -> if (isZh) "聆聽中…" else "Listening…"
        VoiceSession.Phase.THINKING -> if (isZh) "思考中…" else "Thinking…"
        VoiceSession.Phase.SPEAKING -> if (isZh) "回答中(點一下打斷)" else "Speaking (tap to interrupt)"
        VoiceSession.Phase.ERROR -> if (isZh) "出了點問題" else "Something went wrong"
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(theme.appBackground)
            .statusBarsPadding()
            .navigationBarsPadding(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // 標題列:股票代碼(或「語音對話」)+ 右上角 X
        Row(
            Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                if (symbol.isEmpty()) (if (isZh) "語音對話" else "Voice chat") else symbol,
                fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = theme.secondaryText,
            )
            Spacer(Modifier.weight(1f))
            Box(
                Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(theme.cardBackground)
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                        session.stop()
                        onCloseState.value()
                    },
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Close, contentDescription = "Close", tint = theme.primaryText, modifier = Modifier.size(20.dp))
            }
        }

        Spacer(Modifier.weight(1f))

        // 中間的圓:依狀態呼吸/脈動,點一下打斷或提早送出
        VoiceOrb(level = session.level, color = orbColor, onTap = { session.interrupt() })

        Spacer(Modifier.height(20.dp))
        Text(statusText, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = theme.primaryText)

        Spacer(Modifier.weight(1f))

        // 字幕:你說的(靠右)+ AI 說的(靠左、可捲)
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (session.transcript.isNotEmpty()) {
                Text(
                    session.transcript, fontSize = 15.sp, color = theme.secondaryText,
                    textAlign = TextAlign.End, modifier = Modifier.fillMaxWidth(),
                )
            }
            if (session.replyText.isNotEmpty()) {
                val scroll = rememberScrollState()
                // 回覆逐段長出來時跟著捲到最底
                LaunchedEffect(session.replyText) { scroll.scrollTo(scroll.maxValue) }
                Box(Modifier.fillMaxWidth().heightIn(max = 160.dp).verticalScroll(scroll)) {
                    Text(session.replyText, fontSize = 16.sp, color = theme.primaryText, modifier = Modifier.fillMaxWidth())
                }
            }
            session.errorText?.let { err ->
                Text(err, fontSize = 12.sp, color = AppColors.red)
            }
        }

        Spacer(Modifier.height(20.dp))
        Text(
            if (isZh) "點圓圈可打斷 AI,講完停一下會自動送出" else "Tap the orb to interrupt · pause to send",
            fontSize = 11.sp, color = theme.secondaryText.copy(alpha = theme.secondaryText.alpha * 0.7f),
            modifier = Modifier.padding(bottom = 24.dp),
        )
    }
}

/**
 * 對應 iOS VoiceOrb:三層圓。
 * 外層 0.95↔1.25 來回呼吸(1.6 秒);中層依音量 0.85+level*0.35;內層漸層 0.6+level*0.15。
 * 基準半徑 90dp(iOS frame 180),畫布放大到 240dp 讓呼吸放大時不被裁掉。
 */
@Composable
private fun VoiceOrb(level: Float, color: Color, onTap: () -> Unit) {
    val transition = rememberInfiniteTransition(label = "orbBreathe")
    val breathe by transition.animateFloat(
        initialValue = 0.95f, targetValue = 1.25f,
        animationSpec = infiniteRepeatable(tween(1600, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "breathe",
    )
    val lvl by animateFloatAsState(targetValue = level, animationSpec = tween(120), label = "level")

    Canvas(
        Modifier
            .size(240.dp)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onTap),
    ) {
        val r = 90.dp.toPx()
        val c = center
        drawCircle(color = color.copy(alpha = 0.18f), radius = r * breathe, center = c)
        drawCircle(color = color.copy(alpha = 0.30f), radius = r * (0.85f + lvl * 0.35f), center = c)
        val inner = r * (0.6f + lvl * 0.15f)
        drawCircle(
            brush = Brush.linearGradient(
                colors = listOf(color.copy(alpha = 0.95f), color.copy(alpha = 0.6f)),
                start = Offset(c.x - inner, c.y - inner),
                end = Offset(c.x + inner, c.y + inner),
            ),
            radius = inner, center = c,
        )
    }
}
