package com.catinsight.app.ui.sheets

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.StopCircle
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.catinsight.app.ui.LocalAppSettings
import com.catinsight.app.ui.theme.AppColors
import com.catinsight.app.ui.theme.AppTheme
import com.catinsight.app.ui.voice.VoicePrefs
import java.util.Locale

// 對應 iOS VoiceSettingsView:設定 → 語音聲音。列出手機 TTS 引擎的中文/英文聲音,可試聽、選擇,並調語速。

private const val ZH_SAMPLE = "你好，我是你的股票助理，今天想聊哪一支股票？"
private const val EN_SAMPLE = "Hi, I'm your stock assistant. Which stock shall we talk about today?"

/** 一列可選的聲音:Google 的 voice.name 很醜,顯示成「語言名稱 + 編號」,副標列 locale / 是否需網路 / 品質。 */
private data class VoiceOption(val voice: Voice, val title: String, val subtitle: String)

@Composable
fun VoiceSettingsContent() {
    val s = LocalAppSettings.current
    val theme = s.theme
    val isZh = s.isZh
    val context = LocalContext.current

    val previewer = remember { VoicePreviewer(context, isZh) }
    DisposableEffect(Unit) { onDispose { previewer.release() } }

    var rateKey by remember { mutableStateOf(VoicePrefs.rateKey) }
    var zhName by remember { mutableStateOf(VoicePrefs.voiceName(forCJK = true)) }
    var enName by remember { mutableStateOf(VoicePrefs.voiceName(forCJK = false)) }

    /** 語速試聽用目前語言選的聲音(沒選就引擎預設)。 */
    fun previewRate() {
        val name = if (isZh) zhName else enName
        val voice = (if (isZh) previewer.zhVoices else previewer.enVoices).firstOrNull { it.voice.name == name }?.voice
        previewer.play(
            text = if (isZh) "這是語速試聽。" else "This is a speed preview.",
            voice = voice, forCJK = isZh, key = "rate",
        )
    }

    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(if (isZh) "語音聲音" else "Voice", color = theme.primaryText, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Text(
            if (isZh) "語音對話時 AI 用哪個聲音說話。按 ▶ 試聽。想要更自然的聲音,到「設定 → 系統 → 語言 → 文字轉語音輸出」安裝 Google 語音資料。"
            else "Which voice the AI speaks with. Tap ▶ to preview. For more natural voices, install voice data under Settings → System → Languages → Text-to-speech output.",
            color = theme.secondaryText, fontSize = 12.sp, lineHeight = 17.sp,
        )

        // ---- 語速 ----
        SectionLabel(if (isZh) "語速" else "Speed", theme)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("slow" to (if (isZh) "慢" else "Slow"), "normal" to (if (isZh) "正常" else "Normal"), "fast" to (if (isZh) "快" else "Fast"))
                .forEach { (key, label) ->
                    val selected = rateKey == key
                    val shape = RoundedCornerShape(12.dp)
                    Box(
                        Modifier
                            .weight(1f)
                            .clip(shape)
                            .background(if (selected) AppColors.blue else theme.cardBackground)
                            .border(1.dp, if (selected) AppColors.blue else theme.divider, shape)
                            .plainClick {
                                rateKey = key
                                VoicePrefs.setRateKey(key)
                                previewRate()   // 按下就試唸一句
                            }
                            .padding(vertical = 10.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(label, fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
                            color = if (selected) Color.White else theme.primaryText)
                    }
                }
        }

        // ---- 引擎初始化中 / 失敗 ----
        if (!previewer.ready) {
            if (previewer.failed) {
                Text(if (isZh) "這支手機沒有可用的文字轉語音引擎。" else "No text-to-speech engine available on this device.",
                    color = theme.secondaryText, fontSize = 12.sp)
            } else {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), color = theme.primaryText, strokeWidth = 2.dp)
                    Text(if (isZh) "載入語音引擎…" else "Loading speech engine…", color = theme.secondaryText, fontSize = 12.sp)
                }
            }
            return@Column
        }

        // ---- 中文聲音 ----
        SectionLabel(if (isZh) "中文聲音" else "Chinese voice", theme)
        if (previewer.zhVoices.isEmpty()) {
            Text(if (isZh) "這支手機沒有安裝中文聲音。" else "No Chinese voices installed.", color = theme.secondaryText, fontSize = 12.sp)
        }
        previewer.zhVoices.forEach { opt ->
            VoiceRow(
                opt = opt, theme = theme,
                selected = zhName == opt.voice.name || (zhName.isEmpty() && opt.voice.name == previewer.defaultZhName),
                playing = previewer.playingKey == opt.voice.name,
                onPreview = { previewer.play(ZH_SAMPLE, opt.voice, forCJK = true, key = opt.voice.name) },
                onSelect = { zhName = opt.voice.name; VoicePrefs.setVoiceName(forCJK = true, name = opt.voice.name) },
            )
        }

        // ---- 英文聲音 ----
        SectionLabel(if (isZh) "英文聲音" else "English voice", theme)
        if (previewer.enVoices.isEmpty()) {
            Text(if (isZh) "這支手機沒有安裝英文聲音。" else "No English voices installed.", color = theme.secondaryText, fontSize = 12.sp)
        }
        previewer.enVoices.forEach { opt ->
            VoiceRow(
                opt = opt, theme = theme,
                selected = enName == opt.voice.name || (enName.isEmpty() && opt.voice.name == previewer.defaultEnName),
                playing = previewer.playingKey == opt.voice.name,
                onPreview = { previewer.play(EN_SAMPLE, opt.voice, forCJK = false, key = opt.voice.name) },
                onSelect = { enName = opt.voice.name; VoicePrefs.setVoiceName(forCJK = false, name = opt.voice.name) },
            )
        }
        Spacer(Modifier.size(8.dp))
    }
}

/** 區段小標(iOS subheadline semibold、secondaryText)。 */
@Composable
private fun SectionLabel(title: String, theme: AppTheme) {
    Text(title, color = theme.secondaryText, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 6.dp))
}

/** 對應 iOS voiceRow:▶ 試聽 + 名稱/副標 + 勾選;選中時邊框藍色。 */
@Composable
private fun VoiceRow(
    opt: VoiceOption, theme: AppTheme, selected: Boolean, playing: Boolean,
    onPreview: () -> Unit, onSelect: () -> Unit,
) {
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(theme.cardBackground)
            .border(1.dp, if (selected) AppColors.blue else theme.divider, shape)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            if (playing) Icons.Filled.StopCircle else Icons.Filled.PlayCircle,
            contentDescription = "Preview", tint = AppColors.blue,
            modifier = Modifier.size(28.dp).plainClick(onPreview),
        )
        Row(Modifier.weight(1f).plainClick(onSelect), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(opt.title, color = theme.primaryText, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                Text(opt.subtitle, color = theme.secondaryText, fontSize = 12.sp)
            }
            Spacer(Modifier.width(8.dp))
            Icon(
                if (selected) Icons.Filled.CheckCircle else Icons.Outlined.Circle,
                contentDescription = null,
                tint = if (selected) AppColors.blue else theme.secondaryText,
                modifier = Modifier.size(22.dp),
            )
        }
    }
}

/** 無漣漪的點擊(對應 iOS Button(.plain))。 */
private fun Modifier.plainClick(onClick: () -> Unit): Modifier = this.then(
    Modifier.clickable(interactionSource = MutableInteractionSource(), indication = null, onClick = onClick)
)

/**
 * 對應 iOS VoicePreviewer:試聽用的合成器(同時只放一個)。
 * TTS 引擎初始化是非同步的,就緒後才整理聲音清單並把 ready 設為 true。
 */
private class VoicePreviewer(context: Context, private val isZh: Boolean) {
    var ready by mutableStateOf(false); private set
    var failed by mutableStateOf(false); private set
    var playingKey by mutableStateOf<String?>(null); private set
    var zhVoices by mutableStateOf<List<VoiceOption>>(emptyList()); private set
    var enVoices by mutableStateOf<List<VoiceOption>>(emptyList()); private set
    var defaultZhName = ""; private set
    var defaultEnName = ""; private set

    private val handler = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null

    init {
        tts = TextToSpeech(context.applicationContext) { status -> handler.post { onInit(status) } }
    }

    private fun onInit(status: Int) {
        val engine = tts ?: return
        if (status != TextToSpeech.SUCCESS) { failed = true; return }
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit
            override fun onDone(utteranceId: String?) { handler.post { clearIfPlaying(utteranceId) } }
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) { handler.post { clearIfPlaying(utteranceId) } }
            override fun onError(utteranceId: String?, errorCode: Int) { handler.post { clearIfPlaying(utteranceId) } }
            override fun onStop(utteranceId: String?, interrupted: Boolean) { handler.post { clearIfPlaying(utteranceId) } }
        })

        // 排除引擎有列出但沒安裝資料的聲音
        val all = runCatching { engine.voices }.getOrNull().orEmpty()
            .filter { v -> v.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) != true }

        // 中文:zh-TW 優先,再品質高→低,再名稱
        val zh = all.filter { it.locale.language == "zh" }.sortedWith(
            compareBy<Voice> { if (it.locale.country == "TW") 0 else 1 }
                .thenByDescending { it.quality }
                .thenBy { it.name }
        )
        // 英文:只列指定地區,依 englishLocaleTags 順序(en-US 最前),再品質高→低,再名稱
        val tags = VoicePrefs.englishLocaleTags
        val en = all.filter { it.locale.toLanguageTag() in tags }.sortedWith(
            compareBy<Voice> { tags.indexOf(it.locale.toLanguageTag()) }
                .thenByDescending { it.quality }
                .thenBy { it.name }
        )
        zhVoices = toOptions(zh)
        enVoices = toOptions(en)
        defaultZhName = defaultName(engine, Locale.TAIWAN)
        defaultEnName = defaultName(engine, Locale.US)
        ready = true
    }

    /** 沒選聲音時引擎會用哪一個:設語言後讀回目前 voice。 */
    private fun defaultName(engine: TextToSpeech, locale: Locale): String =
        runCatching { engine.setLanguage(locale); engine.voice?.name ?: "" }.getOrDefault("")

    /** 顯示名稱:同 locale 的聲音依序編號,例如「中文 (台灣) 1」。 */
    private fun toOptions(list: List<Voice>): List<VoiceOption> {
        val counters = HashMap<String, Int>()
        val displayLocale = if (isZh) Locale.TAIWAN else Locale.US
        return list.map { v ->
            val tag = v.locale.toLanguageTag()
            val n = (counters[tag] ?: 0) + 1
            counters[tag] = n
            val display = v.locale.getDisplayName(displayLocale).ifEmpty { tag }
            val network = if (v.isNetworkConnectionRequired) (if (isZh) "需網路" else "Online") else (if (isZh) "離線" else "Offline")
            val quality = when {
                v.quality >= Voice.QUALITY_VERY_HIGH -> if (isZh) "品質極高" else "Very high quality"
                v.quality >= Voice.QUALITY_HIGH -> if (isZh) "品質高" else "High quality"
                v.quality >= Voice.QUALITY_NORMAL -> if (isZh) "品質標準" else "Normal quality"
                else -> if (isZh) "品質低" else "Low quality"
            }
            VoiceOption(v, "$display $n", "$tag · $network · $quality")
        }
    }

    /** 播放樣本;再按同一個 = 停止。 */
    fun play(text: String, voice: Voice?, forCJK: Boolean, key: String) {
        val engine = tts ?: return
        if (!ready) return
        if (playingKey != null) {
            runCatching { engine.stop() }
            val was = playingKey
            playingKey = null
            if (was == key) return
        }
        runCatching { engine.setLanguage(VoicePrefs.locale(forCJK)) }
        if (voice != null) runCatching { engine.setVoice(voice) }
        engine.setSpeechRate(VoicePrefs.speechRate)
        playingKey = key
        val r = runCatching { engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, key) }.getOrDefault(TextToSpeech.ERROR)
        if (r != TextToSpeech.SUCCESS) playingKey = null
    }

    private fun clearIfPlaying(id: String?) {
        if (id != null && playingKey == id) playingKey = null
    }

    fun release() {
        runCatching { tts?.stop() }
        runCatching { tts?.shutdown() }
        tts = null
        playingKey = null
    }
}
