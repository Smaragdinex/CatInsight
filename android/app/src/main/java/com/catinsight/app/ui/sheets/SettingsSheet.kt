package com.catinsight.app.ui.sheets

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Brush
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.GppMaybe
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.catinsight.app.ui.LocalAppSettings
import com.catinsight.app.ui.theme.AppColors
import com.catinsight.app.ui.theme.AppLanguage
import com.catinsight.app.ui.theme.AppTheme
import com.catinsight.app.ui.theme.CopySet
import com.catinsight.app.ui.theme.MarketColorMode

/** 對應 iOS ContentView.SettingsSection:設定面板的子頁。 */
enum class SettingsSection { LANGUAGE, THEME, MARKET_COLORS, VOICE, DISCLAIMER }

/**
 * 對應 iOS SettingsSheetView:
 * 主選單五項(語言 / 主題 / 漲跌顏色 / 語音聲音 / 免責聲明)→ 點進子頁;子頁左上有返回,右上一律有「關閉」。
 * 外層 ModalBottomSheet 由 AppRoot 提供,這裡只畫內容。
 */
@Composable
fun SettingsSheetContent(onDismiss: () -> Unit) {
    val s = LocalAppSettings.current
    val theme = s.theme
    val text = s.text
    val isZh = s.isZh
    // 對應 iOS 的 activeSettingsSection(nil = 主選單)
    var section by remember { mutableStateOf<SettingsSection?>(null) }

    // Android 實體返回鍵:在子頁時先回主選單,不直接關閉面板
    BackHandler(enabled = section != null) { section = null }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .fillMaxHeight(0.62f)   // 近似 iOS presentationDetents(.medium)
            .background(theme.appBackground)
    ) {
        // 工具列:左「返回」(僅子頁)、右「關閉」
        Box(modifier = Modifier.fillMaxWidth().height(44.dp)) {
            if (section != null) {
                IconButton(onClick = { section = null }, modifier = Modifier.align(Alignment.CenterStart)) {
                    Icon(Icons.Filled.ChevronLeft, contentDescription = "Back", tint = theme.primaryText)
                }
            }
            TextButton(
                onClick = { section = null; onDismiss() },
                modifier = Modifier.align(Alignment.CenterEnd).padding(end = 4.dp),
            ) {
                Text(text.closeButton, color = theme.primaryText, fontSize = 17.sp)
            }
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            when (section) {
                null -> SettingsMenu(theme = theme, isZh = isZh, text = text, onSelect = { section = it })
                SettingsSection.LANGUAGE -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    SectionTitle(text.languageTitle, theme)
                    AppLanguage.entries.forEach { lang ->
                        SelectionRow(
                            title = lang.title, subtitle = null,
                            selected = s.language == lang, theme = theme,
                        ) { s.setLanguage(lang) }
                    }
                }
                SettingsSection.THEME -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    SectionTitle(text.themeTitle, theme)
                    AppTheme.entries.forEach { t ->
                        SelectionRow(
                            title = if (t == AppTheme.DARK) text.darkThemeTitle else text.lightThemeTitle,
                            subtitle = if (t == AppTheme.DARK) text.darkThemeSubtitle else text.lightThemeSubtitle,
                            selected = s.theme == t, theme = theme,
                        ) { s.setTheme(t) }
                    }
                }
                SettingsSection.MARKET_COLORS -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    SectionTitle(if (isZh) "漲跌顏色" else "Market Colors", theme)
                    MarketColorMode.entries.forEach { mode ->
                        SelectionRow(
                            title = if (mode == MarketColorMode.TAIWAN) (if (isZh) "台股" else "Taiwan Market")
                                    else (if (isZh) "美股" else "US Market"),
                            subtitle = if (mode == MarketColorMode.TAIWAN)
                                (if (isZh) "上漲紅、下跌綠（依昨收）" else "Up red, down green (vs previous close)")
                            else
                                (if (isZh) "上漲綠、下跌紅（依昨收）" else "Up green, down red (vs previous close)"),
                            selected = s.marketColorMode == mode, theme = theme,
                        ) { s.setMarketColorMode(mode) }
                    }
                }
                SettingsSection.VOICE -> VoiceSettingsContent()
                SettingsSection.DISCLAIMER -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    SectionTitle(if (isZh) "免責聲明" else "Disclaimer", theme)
                    Text(
                        text = disclaimerText(isZh),
                        color = theme.secondaryText,
                        fontSize = 15.sp,
                        lineHeight = 21.sp,
                    )
                }
            }
        }
    }
}

/** 主選單五個入口(對應 settingsMenuView)。 */
@Composable
private fun SettingsMenu(theme: AppTheme, isZh: Boolean, text: CopySet, onSelect: (SettingsSection) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SettingsEntryButton(Icons.Filled.Language, text.languageTitle, text.languageSubtitle, theme) {
            onSelect(SettingsSection.LANGUAGE)
        }
        SettingsEntryButton(Icons.Filled.Palette, text.themeTitle, text.themeSubtitle, theme) {
            onSelect(SettingsSection.THEME)
        }
        SettingsEntryButton(
            Icons.Filled.Brush,
            if (isZh) "漲跌顏色" else "Market Colors",
            if (isZh) "選擇台股或美股的紅綠規則（依昨收）" else "Choose Taiwan or US color rules (vs previous close)",
            theme,
        ) { onSelect(SettingsSection.MARKET_COLORS) }
        SettingsEntryButton(
            Icons.Filled.GraphicEq,
            if (isZh) "語音聲音" else "Voice",
            if (isZh) "語音對話用的聲音與語速,可試聽" else "Voice and speed for voice chat, with preview",
            theme,
        ) { onSelect(SettingsSection.VOICE) }
        SettingsEntryButton(
            Icons.Filled.GppMaybe,
            if (isZh) "免責聲明" else "Disclaimer",
            if (isZh) "本 App 為量化數據工具,非投資建議" else "Quantitative data tool, not investment advice",
            theme,
        ) { onSelect(SettingsSection.DISCLAIMER) }
    }
}

/** 子頁標題(iOS .title3 bold)。 */
@Composable
private fun SectionTitle(title: String, theme: AppTheme) {
    Text(title, color = theme.primaryText, fontSize = 20.sp, fontWeight = FontWeight.Bold)
}

/** 對應 settingsEntryButton:藍色圖示 + 標題/副標 + 右側 chevron,卡片底、圓角 16、1px 邊框。 */
@Composable
private fun SettingsEntryButton(icon: ImageVector, title: String, subtitle: String, theme: AppTheme, onClick: () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(theme.cardBackground)
            .border(1.dp, theme.divider, shape)
            .clickable(onClick = onClick)
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.width(28.dp), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = AppColors.blue, modifier = Modifier.size(22.dp))
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, color = theme.primaryText, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            Text(subtitle, color = theme.secondaryText, fontSize = 12.sp)
        }
        Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = theme.secondaryText)
    }
}

/** 對應 selectionRow:標題/副標 + 右側勾選圈;選中時邊框與圖示為藍色。 */
@Composable
private fun SelectionRow(title: String, subtitle: String?, selected: Boolean, theme: AppTheme, onClick: () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(theme.cardBackground)
            .border(1.dp, if (selected) AppColors.blue else theme.divider, shape)
            .clickable(onClick = onClick)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, color = theme.primaryText, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            if (subtitle != null) Text(subtitle, color = theme.secondaryText, fontSize = 12.sp)
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

/** 免責聲明全文(中/英),照 iOS 原文。 */
private fun disclaimerText(isZh: Boolean): String = if (isZh)
"""本 App 為純粹的量化數據與技術分析「工具」,所有排序、評分、估值情境、技術指標與 AI 文字內容,皆由演算法依公開市場資料計算產生,僅供研究與參考。

• 本 App 不提供、也不構成任何形式的投資建議、買賣推薦或招攬。
• 所有數據可能有誤差或延遲,不保證準確、完整或即時。
• 任何投資決策應由您自行判斷,並自負盈虧;過去表現不代表未來結果。
• 本 App 並非經許可之證券投資顧問事業,內容不得視為投顧服務。

使用本 App 即表示您已了解並同意以上條款。"""
else
"""This app is a quantitative data and technical-analysis TOOL. All rankings, scores, valuation scenarios, technical indicators and AI-generated text are produced by algorithms from public market data, for research and reference only.

• It does NOT provide and does NOT constitute investment advice, buy/sell recommendations, or solicitation.
• Data may contain errors or delays and is not guaranteed to be accurate, complete, or real-time.
• All investment decisions are your own responsibility; you bear all gains and losses. Past performance does not indicate future results.
• This app is not a licensed investment advisory service.

By using this app you acknowledge and agree to the above."""
