package com.catinsight.app.ui.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.catinsight.app.BuildConfig
import com.catinsight.app.data.AIChatMessage
import com.catinsight.app.data.StockApiService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlin.math.max

/**
 * 對應 iOS VoiceSession:語音對話的狀態機。
 * 麥克風(SpeechRecognizer)→ 停頓約 1.3 秒自動送出 → AI 串流回覆 → 遇到標點就交給 TextToSpeech 逐段唸 → 唸完自動再聽。
 * 所有方法都要在主執行緒呼叫;SpeechRecognizer 與 TTS 的回呼統一 post 回主執行緒。
 */
class VoiceSession(
    context: Context,
    private val symbol: String,
    private val isZh: Boolean,
    history: List<AIChatMessage>,
    private val watchlist: List<String>,
    /** 每完成一輪(使用者說的話, AI 回覆)就回呼,讓對話頁存起來。 */
    private val onExchange: (String, String) -> Unit,
) : RecognitionListener {

    enum class Phase { IDLE, LISTENING, THINKING, SPEAKING, ERROR }

    // ---- 給畫面用的狀態(對應 iOS @Published) ----
    var phase by mutableStateOf(Phase.IDLE); private set
    var transcript by mutableStateOf(""); private set      // 使用者正在說的
    var replyText by mutableStateOf(""); private set       // AI 目前回覆(逐段累積)
    var level by mutableFloatStateOf(0f); private set      // 麥克風音量 0~1,給圓圈動畫
    var errorText by mutableStateOf<String?>(null); private set

    private val appContext = context.applicationContext
    private val history = history.toMutableList()
    private val api = StockApiService.default
    private val handler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    // 聽
    private var recognizer: SpeechRecognizer? = null
    private var recognizerListening = false
    private var consecutiveErrors = 0

    // 想 / 說
    private var streamJob: Job? = null
    private var pendingChunk = ""
    private var streamDone = false
    private var queuedUtterances = 0
    private var active = false
    private var lastUserText = ""
    private var generation = 0        // 每輪回覆一個世代號,舊世代的 TTS 回呼一律忽略
    private var utteranceSeq = 0

    // TTS 引擎是非同步初始化的:還沒好就先把段落排隊
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var ttsFailed = false
    private val ttsBacklog = ArrayDeque<String>()
    private var appliedCJK: Boolean? = null   // 上次套用的語言,避免每段都重設聲音

    private val silenceRunnable = Runnable { finalizeUtterance() }
    private val restartRunnable = Runnable { if (active && phase == Phase.LISTENING) startListening() }

    private companion object {
        const val SILENCE_MS = 1300L          // 停頓多久自動送出(對應 iOS silenceSeconds)
        const val RESTART_DELAY_MS = 350L     // 辨識中斷後重新聽的間隔,避免 RECOGNIZER_BUSY
        const val MAX_CONSECUTIVE_ERRORS = 6  // 連續出錯太多次就放棄,不要無限重試
        val HARD_STOPS = setOf('。', '！', '？', '!', '?', '\n')
        val SOFT_STOPS = setOf('，', ',', '；', ';', '、', ':', '：')
    }

    init {
        tts = TextToSpeech(appContext) { status -> handler.post { onTtsInit(status) } }
    }

    // ================= 生命週期 =================

    /**
     * 開始:呼叫前請先確認已拿到 RECORD_AUDIO 權限。
     * [autoText] 只在 DEBUG 生效:跳過麥克風,直接把這句當使用者輸入送出(模擬器沒麥克風)。
     */
    fun start(autoText: String? = null) {
        active = true
        errorText = null
        if (BuildConfig.DEBUG && !autoText.isNullOrEmpty()) {
            transcript = autoText
            send(autoText)
            return
        }
        startListening()
    }

    /** 離開畫面(或暫停)時呼叫:停聽、取消串流、停止朗讀。 */
    fun stop() {
        active = false
        stopListening()
        streamJob?.cancel()
        streamJob = null
        runCatching { tts?.stop() }
        queuedUtterances = 0
        ttsBacklog.clear()
        phase = Phase.IDLE
    }

    /** 釋放 recognizer 與 tts;之後這個物件不能再用。 */
    fun release() {
        stop()
        runCatching { recognizer?.destroy() }
        recognizer = null
        runCatching { tts?.shutdown() }
        tts = null
        scope.cancel()
    }

    /** 點圓圈:AI 在講就打斷並回到聆聽;正在聽且已有字就提早送出。 */
    fun interrupt() {
        when (phase) {
            Phase.SPEAKING, Phase.THINKING -> {
                streamJob?.cancel()
                streamJob = null
                generation += 1
                runCatching { tts?.stop() }
                queuedUtterances = 0
                ttsBacklog.clear()
                streamDone = true
                if (replyText.isNotEmpty()) commitExchange()   // 已收到的回覆先存起來
                startListening()
            }
            Phase.LISTENING -> if (transcript.isNotBlank()) finalizeUtterance()
            else -> Unit
        }
    }

    /** 使用者拒絕麥克風權限。 */
    fun failPermissionDenied() {
        active = false
        fail(if (isZh) "沒有麥克風權限,請到設定開啟。" else "Microphone permission denied.")
    }

    private fun fail(message: String) {
        errorText = message
        phase = Phase.ERROR
        level = 0f
    }

    // ================= 聽(SpeechRecognizer) =================

    private fun startListening() {
        if (!active) return
        stopListening()
        transcript = ""
        replyText = ""
        errorText = null
        phase = Phase.LISTENING

        if (!SpeechRecognizer.isRecognitionAvailable(appContext)) {
            fail(if (isZh) "語音辨識目前無法使用。" else "Speech recognition unavailable.")
            return
        }
        val r = recognizer ?: SpeechRecognizer.createSpeechRecognizer(appContext).also {
            it.setRecognitionListener(this)
            recognizer = it
        }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, if (isZh) "zh-TW" else "en-US")
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, if (isZh) "zh-TW" else "en-US")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, appContext.packageName)
        }
        recognizerListening = true
        try {
            r.startListening(intent)
        } catch (e: Exception) {
            recognizerListening = false
            fail(if (isZh) "麥克風啟動失敗。" else "Could not start microphone.")
        }
    }

    private fun stopListening() {
        handler.removeCallbacks(silenceRunnable)
        handler.removeCallbacks(restartRunnable)
        if (recognizerListening) {
            recognizerListening = false
            runCatching { recognizer?.cancel() }   // cancel() 之後不會再有回呼
        }
        level = 0f
    }

    private fun restartSilenceTimer() {
        handler.removeCallbacks(silenceRunnable)
        handler.postDelayed(silenceRunnable, SILENCE_MS)
    }

    /** 辨識中斷(沒聲音/沒結果)但還沒有字:稍等一下重新聽。 */
    private fun restartListeningSoon() {
        handler.removeCallbacks(restartRunnable)
        handler.postDelayed(restartRunnable, RESTART_DELAY_MS)
    }

    /** 停頓夠久 / 辨識器給最終結果 / 使用者點圓圈 → 把目前的字送出。 */
    private fun finalizeUtterance() {
        if (phase != Phase.LISTENING) return
        val text = transcript.trim()
        if (text.isEmpty()) return
        stopListening()
        send(text)
    }

    private fun bestText(results: Bundle?): String? =
        results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim()

    // ---- RecognitionListener(主執行緒回呼) ----

    override fun onReadyForSpeech(params: Bundle?) { consecutiveErrors = 0 }
    override fun onBeginningOfSpeech() = Unit
    override fun onBufferReceived(buffer: ByteArray?) = Unit
    override fun onEndOfSpeech() = Unit
    override fun onEvent(eventType: Int, params: Bundle?) = Unit

    override fun onRmsChanged(rmsdB: Float) {
        if (phase != Phase.LISTENING) return
        // Google 辨識器的 rms 大約 -2 ~ 10 dB,壓到 0~1
        level = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
    }

    override fun onPartialResults(partialResults: Bundle?) {
        if (phase != Phase.LISTENING) return
        val text = bestText(partialResults) ?: return
        if (text.isNotEmpty() && text != transcript) {
            transcript = text
            consecutiveErrors = 0
            restartSilenceTimer()
        }
    }

    override fun onResults(results: Bundle?) {
        recognizerListening = false
        if (phase != Phase.LISTENING) return
        val text = bestText(results)
        if (!text.isNullOrEmpty()) transcript = text
        // 辨識器自己判定講完了:有字就送,沒字就重新聽
        if (transcript.isBlank()) restartListeningSoon() else finalizeUtterance()
    }

    override fun onError(error: Int) {
        recognizerListening = false
        if (phase != Phase.LISTENING) return
        when (error) {
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> {
                failPermissionDenied(); return
            }
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY, SpeechRecognizer.ERROR_CLIENT -> {
                // 辨識器卡住:整個重建
                runCatching { recognizer?.destroy() }
                recognizer = null
            }
            else -> Unit   // ERROR_NO_MATCH / ERROR_SPEECH_TIMEOUT / 網路等:下面統一處理
        }
        if (transcript.isNotBlank()) { finalizeUtterance(); return }
        consecutiveErrors += 1
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            fail(if (isZh) "語音辨識一直失敗,請檢查網路或麥克風。" else "Speech recognition keeps failing. Check network or microphone.")
            return
        }
        if (active) restartListeningSoon()
    }

    // ================= 問 AI(串流)+ 逐句朗讀 =================

    private fun send(text: String) {
        lastUserText = text
        history.add(AIChatMessage(role = "user", content = text))
        replyText = ""
        pendingChunk = ""
        streamDone = false
        queuedUtterances = 0
        ttsBacklog.clear()
        generation += 1
        phase = Phase.THINKING

        val payload = history.toList()
        streamJob?.cancel()
        streamJob = scope.launch {
            try {
                api.streamAIChat(symbol, if (isZh) "zh" else "en", payload, watchlist, voice = true)
                    .collect { delta ->
                        replyText += delta
                        pendingChunk += delta
                        flushChunk(force = false)
                    }
                streamDone = true
                flushChunk(force = true)
                if (queuedUtterances == 0) finishTurn()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                streamDone = true
                if (replyText.isEmpty()) {
                    val msg = if (isZh) "抱歉,我剛剛沒有連上,再說一次好嗎?" else "Sorry, I lost the connection. Could you say that again?"
                    replyText = msg
                    speak(msg)
                    if (queuedUtterances == 0) finishTurn()   // 沒有 TTS 引擎時不會有 onDone
                } else {
                    flushChunk(force = true)
                    if (queuedUtterances == 0) finishTurn()
                }
            }
        }
    }

    /**
     * 累積到句尾標點(或太長)就交給合成器唸,不等整段生成完。
     * 規則同 iOS:遇到 。！？!?\n 就切;累積 ≥14 字後遇到 ，,；;、:： 也切;超過 60 字沒標點也切。取最後一個切點。
     */
    private fun flushChunk(force: Boolean) {
        val text = pendingChunk
        if (text.isEmpty()) return
        if (force) {
            pendingChunk = ""
            val piece = text.trim()
            if (piece.isNotEmpty()) speak(piece)
            return
        }
        var cut = -1
        for (i in text.indices) {
            val ch = text[i]
            if (ch in HARD_STOPS) cut = i + 1
            else if (ch in SOFT_STOPS && i >= 14) cut = i + 1
        }
        if (cut < 0 && text.length >= 60) cut = text.length
        if (cut < 0) return
        val piece = text.substring(0, cut).trim()
        pendingChunk = text.substring(cut)
        if (piece.isNotEmpty()) speak(piece)
    }

    private fun speak(piece: String) {
        // 唸的時候不能同時聽,否則會把自己的聲音辨識進去
        if (recognizerListening) stopListening()
        phase = Phase.SPEAKING
        if (ttsFailed) return               // 沒有 TTS 引擎:只顯示文字,不計入佇列
        queuedUtterances += 1
        if (!ttsReady) { ttsBacklog.addLast(piece); return }
        enqueue(piece)
    }

    /** 真正丟給引擎(引擎已就緒)。 */
    private fun enqueue(piece: String) {
        val engine = tts ?: return
        val cjk = VoicePrefs.hasCJK(piece)
        if (appliedCJK != cjk) {
            VoicePrefs.apply(engine, cjk)   // 語言 + 使用者選的聲音 + 語速
            appliedCJK = cjk
        }
        val id = "$generation-${utteranceSeq++}"
        val r = runCatching { engine.speak(piece, TextToSpeech.QUEUE_ADD, null, id) }.getOrDefault(TextToSpeech.ERROR)
        if (r != TextToSpeech.SUCCESS) utteranceFinished(id)
    }

    private fun finishTurn() {
        commitExchange()
        if (active) startListening()
    }

    private fun commitExchange() {
        val reply = replyText.trim()
        if (lastUserText.isEmpty() || reply.isEmpty()) return
        history.add(AIChatMessage(role = "assistant", content = reply))
        onExchange(lastUserText, reply)
        lastUserText = ""
    }

    // ================= TTS =================

    private fun onTtsInit(status: Int) {
        val engine = tts ?: return
        if (status != TextToSpeech.SUCCESS) {
            ttsFailed = true
            ttsBacklog.clear()
            queuedUtterances = 0
            if (streamDone && phase == Phase.SPEAKING) finishTurn()
            return
        }
        engine.setOnUtteranceProgressListener(progressListener)
        ttsReady = true
        // 初始化前排隊的段落補唸
        while (ttsBacklog.isNotEmpty()) enqueue(ttsBacklog.removeFirst())
    }

    /** 一個 utterance 唸完/失敗/被停止(主執行緒)。 */
    private fun utteranceFinished(id: String?) {
        val gen = id?.substringBefore('-')?.toIntOrNull() ?: return
        if (gen != generation) return   // 被打斷的舊世代
        queuedUtterances = max(0, queuedUtterances - 1)
        if (queuedUtterances == 0 && streamDone && phase == Phase.SPEAKING) finishTurn()
    }

    private val progressListener = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) = Unit
        override fun onDone(utteranceId: String?) { handler.post { utteranceFinished(utteranceId) } }
        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) { handler.post { utteranceFinished(utteranceId) } }
        override fun onError(utteranceId: String?, errorCode: Int) { handler.post { utteranceFinished(utteranceId) } }
        override fun onStop(utteranceId: String?, interrupted: Boolean) { handler.post { utteranceFinished(utteranceId) } }
    }
}
