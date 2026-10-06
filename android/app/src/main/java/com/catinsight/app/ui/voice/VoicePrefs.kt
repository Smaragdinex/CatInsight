package com.catinsight.app.ui.voice

import android.speech.tts.TextToSpeech
import android.speech.tts.Voice
import com.catinsight.app.data.Prefs
import java.util.Locale

/**
 * 對應 iOS VoicePrefs:語音對話用的聲音偏好(存 SharedPreferences)。
 * - voice.zh.name / voice.en.name:使用者選的 TTS Voice.name(空字串 = 引擎預設)
 * - voice.rate:slow / normal / fast
 */
object VoicePrefs {
    const val ZH_KEY = "voice.zh.name"
    const val EN_KEY = "voice.en.name"
    const val RATE_KEY = "voice.rate"

    /** 英文聲音只列這些地區(對應 iOS 只列指定幾個名字)。順序即排序優先權,en-US 最前。 */
    val englishLocaleTags = listOf("en-US", "en-GB", "en-AU", "en-IE", "en-IN", "en-ZA")

    val rateKey: String get() = Prefs.getString(RATE_KEY, "normal")

    fun setRateKey(v: String) = Prefs.putString(RATE_KEY, v)

    /** 對應 iOS 的 0.88 / 1 / 1.15 倍速。 */
    val speechRate: Float
        get() = when (rateKey) {
            "slow" -> 0.88f
            "fast" -> 1.15f
            else -> 1f
        }

    fun voiceName(forCJK: Boolean): String = Prefs.getString(if (forCJK) ZH_KEY else EN_KEY, "")

    fun setVoiceName(forCJK: Boolean, name: String) = Prefs.putString(if (forCJK) ZH_KEY else EN_KEY, name)

    /** 依內容語言決定 TTS 語言:有中文字 → zh-TW,否則 en-US。 */
    fun locale(forCJK: Boolean): Locale = if (forCJK) Locale.TAIWAN else Locale.US

    /** 字串是否含 CJK(對應 iOS 的 0x4E00~0x9FFF 判斷)。 */
    fun hasCJK(text: String): Boolean = text.any { it.code in 0x4E00..0x9FFF }

    /** 在引擎的聲音清單裡找名字;`tts.voices` 在部分裝置會丟例外,所以包起來。 */
    fun findVoice(tts: TextToSpeech, name: String): Voice? {
        if (name.isEmpty()) return null
        return runCatching { tts.voices }.getOrNull()?.firstOrNull { it.name == name }
    }

    /**
     * 把偏好套到引擎上:先設語言,再套使用者選的聲音(找不到就維持該語言的預設),最後設語速。
     * 每次講一段前呼叫;呼叫端可自行快取避免重複套用。
     */
    fun apply(tts: TextToSpeech, forCJK: Boolean) {
        runCatching { tts.setLanguage(locale(forCJK)) }
        val v = findVoice(tts, voiceName(forCJK))
        if (v != null) runCatching { tts.setVoice(v) }
        tts.setSpeechRate(speechRate)
    }
}
