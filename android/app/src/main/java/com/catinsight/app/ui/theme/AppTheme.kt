package com.catinsight.app.ui.theme

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.graphics.Color
import com.catinsight.app.data.Prefs

/** 對應 iOS AppTheme:深色(灰底白字)/淺色(白底黑字)。顏色值一比一照抄。 */
enum class AppTheme(val key: String) {
    DARK("dark"), LIGHT("light");

    val isDark: Boolean get() = this == DARK

    val appBackground: Color get() = if (isDark) Color(0.10f, 0.10f, 0.12f) else Color(0.96f, 0.97f, 0.98f)
    val cardBackground: Color get() = if (isDark) Color(0.105f, 0.105f, 0.12f) else Color.White
    val chipBackground: Color get() = if (isDark) Color(0.12f, 0.12f, 0.14f) else Color(0.96f, 0.97f, 0.98f)
    val primaryText: Color get() = if (isDark) Color.White else Color.Black
    val secondaryText: Color get() = if (isDark) Color.White.copy(alpha = 0.72f) else Color.Black.copy(alpha = 0.62f)
    val divider: Color get() = if (isDark) Color.White.copy(alpha = 0.06f) else Color.Black.copy(alpha = 0.08f)
    val chartAxis: Color get() = if (isDark) Color.White.copy(alpha = 0.78f) else Color.Black.copy(alpha = 0.72f)

    companion object {
        fun from(key: String) = entries.firstOrNull { it.key == key } ?: DARK
    }
}

enum class AppLanguage(val key: String, val title: String) {
    ZH("zh", "中文"), EN("en", "English");

    val code: String get() = key   // 後端 lang 參數
    companion object { fun from(key: String) = entries.firstOrNull { it.key == key } ?: ZH }
}

/** 漲跌顏色:台灣(漲紅跌綠)/美國(漲綠跌紅)。 */
enum class MarketColorMode(val key: String) {
    TAIWAN("taiwan"), US("us");
    companion object { fun from(key: String) = entries.firstOrNull { it.key == key } ?: TAIWAN }
}

/** 常用色(iOS 系統色近似值)。 */
object AppColors {
    val blue = Color(0xFF0A84FF)
    val green = Color(0xFF30D158)
    val red = Color(0xFFFF453A)
    val orange = Color(0xFFFF9F0A)
    val yellow = Color(0xFFFFD60A)
    val gray = Color(0xFF8E8E93)
    val gold = Color(0.902f, 0.753f, 0.322f)
    val goodGreen = Color(0.122f, 0.682f, 0.337f)
    val badRed = Color(0.890f, 0.290f, 0.302f)
}

/**
 * 對應 iOS 的 @AppStorage:selectedTheme / selectedLanguage / marketColorMode / chart.candle。
 * 以 Compose state 持有,改變即持久化。整個 App 共用同一個實例。
 */
class AppSettings {
    private val themeState = mutableStateOf(AppTheme.from(Prefs.getString("selectedTheme", AppTheme.DARK.key)))
    private val languageState = mutableStateOf(AppLanguage.from(Prefs.getString("selectedLanguage", AppLanguage.ZH.key)))
    private val marketColorModeState = mutableStateOf(MarketColorMode.from(Prefs.getString("marketColorMode", MarketColorMode.TAIWAN.key)))
    private val showCandleState = mutableStateOf(Prefs.getBoolean("chart.candle", false))

    val theme: AppTheme get() = themeState.value
    val language: AppLanguage get() = languageState.value
    val marketColorMode: MarketColorMode get() = marketColorModeState.value
    val showCandle: Boolean get() = showCandleState.value

    val isZh: Boolean get() = language == AppLanguage.ZH
    val langCode: String get() = language.code
    val text: CopySet get() = copySet(language)

    val isUSStyleMarket: Boolean get() = marketColorMode == MarketColorMode.US
    fun risingColor(): Color = if (isUSStyleMarket) AppColors.green else AppColors.red
    fun fallingColor(): Color = if (isUSStyleMarket) AppColors.red else AppColors.green
    fun changeColor(change: Double): Color = if (change >= 0) risingColor() else fallingColor()

    fun setTheme(v: AppTheme) { themeState.value = v; Prefs.putString("selectedTheme", v.key) }
    fun setLanguage(v: AppLanguage) { languageState.value = v; Prefs.putString("selectedLanguage", v.key) }
    fun setMarketColorMode(v: MarketColorMode) { marketColorModeState.value = v; Prefs.putString("marketColorMode", v.key) }
    fun setShowCandle(v: Boolean) { showCandleState.value = v; Prefs.putBoolean("chart.candle", v) }
}
