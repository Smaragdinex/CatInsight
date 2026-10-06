import SwiftUI

struct SettingsSheetView: View {
    @Binding var showSettings: Bool
    @Binding var activeSettingsSection: ContentView.SettingsSection?
    @Binding var selectedThemeRaw: String
    @Binding var selectedLanguageRaw: String
    @Binding var marketColorModeRaw: String

    let selectedTheme: AppTheme
    let text: CopySet
    let selectedLanguage: AppLanguage

    var body: some View {
        NavigationStack {
            ZStack {
                selectedTheme.appBackground.ignoresSafeArea()

                VStack(alignment: .leading, spacing: 16) {
                    if let activeSettingsSection {
                        settingsDetailView(for: activeSettingsSection)
                    } else {
                        settingsMenuView
                    }
                    Spacer()
                }
                .padding()
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if activeSettingsSection != nil {
                        Button {
                            activeSettingsSection = nil
                        } label: {
                            Image(systemName: "chevron.left")
                        }
                        .tint(selectedTheme.primaryText)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(text.closeButton) {
                        showSettings = false
                        activeSettingsSection = nil
                    }
                    .tint(selectedTheme.primaryText)
                }
            }
            .presentationDetents([.medium, .large])
            .preferredColorScheme(selectedTheme.colorScheme)
        }
    }

    private var settingsMenuView: some View {
        VStack(spacing: 12) {
            settingsEntryButton(icon: "globe", title: text.languageTitle, subtitle: text.languageSubtitle) {
                activeSettingsSection = .language
            }
            settingsEntryButton(icon: "paintpalette.fill", title: text.themeTitle, subtitle: text.themeSubtitle) {
                activeSettingsSection = .theme
            }
            settingsEntryButton(
                icon: "paintbrush.pointed.fill",
                title: selectedLanguage == .zh ? "漲跌顏色" : "Market Colors",
                subtitle: selectedLanguage == .zh ? "選擇台股或美股的紅綠規則（依昨收）" : "Choose Taiwan or US color rules (vs previous close)"
            ) {
                activeSettingsSection = .marketColors
            }
            settingsEntryButton(
                icon: "waveform",
                title: selectedLanguage == .zh ? "語音" : "Voice",
                subtitle: selectedLanguage == .zh ? "語音對話的語速與打斷方式" : "Speed and interruption for voice chat"
            ) {
                activeSettingsSection = .voice
            }
            settingsEntryButton(
                icon: "exclamationmark.shield.fill",
                title: selectedLanguage == .zh ? "免責聲明" : "Disclaimer",
                subtitle: selectedLanguage == .zh ? "本 App 為量化數據工具,非投資建議" : "Quantitative data tool, not investment advice"
            ) {
                activeSettingsSection = .disclaimer
            }
        }
    }

    @ViewBuilder
    private func settingsDetailView(for section: ContentView.SettingsSection) -> some View {
        switch section {
        case .language:
            VStack(alignment: .leading, spacing: 12) {
                Text(text.languageTitle)
                    .font(.title3)
                    .fontWeight(.bold)
                    .foregroundColor(selectedTheme.primaryText)
                ForEach(AppLanguage.allCases) { language in
                    selectionRow(
                        title: language.title,
                        subtitle: nil,
                        selected: selectedLanguageRaw == language.rawValue
                    ) {
                        selectedLanguageRaw = language.rawValue
                    }
                }
            }
        case .theme:
            VStack(alignment: .leading, spacing: 12) {
                Text(text.themeTitle)
                    .font(.title3)
                    .fontWeight(.bold)
                    .foregroundColor(selectedTheme.primaryText)
                ForEach(AppTheme.allCases) { theme in
                    selectionRow(
                        title: theme == .dark ? text.darkThemeTitle : text.lightThemeTitle,
                        subtitle: theme == .dark ? text.darkThemeSubtitle : text.lightThemeSubtitle,
                        selected: selectedThemeRaw == theme.rawValue
                    ) {
                        selectedThemeRaw = theme.rawValue
                    }
                }
            }
        case .marketColors:
            VStack(alignment: .leading, spacing: 12) {
                Text(selectedLanguage == .zh ? "漲跌顏色" : "Market Colors")
                    .font(.title3)
                    .fontWeight(.bold)
                    .foregroundColor(selectedTheme.primaryText)
                ForEach(MarketColorMode.allCases) { mode in
                    selectionRow(
                        title: mode == .taiwan ? (selectedLanguage == .zh ? "台股" : "Taiwan Market") : (selectedLanguage == .zh ? "美股" : "US Market"),
                        subtitle: mode == .taiwan ? (selectedLanguage == .zh ? "上漲紅、下跌綠（依昨收）" : "Up red, down green (vs previous close)") : (selectedLanguage == .zh ? "上漲綠、下跌紅（依昨收）" : "Up green, down red (vs previous close)"),
                        selected: marketColorModeRaw == mode.rawValue
                    ) {
                        marketColorModeRaw = mode.rawValue
                    }
                }
            }
        case .voice:
            VoiceSettingsView(theme: selectedTheme, isZh: selectedLanguage == .zh)
        case .disclaimer:
            VStack(alignment: .leading, spacing: 12) {
                Text(selectedLanguage == .zh ? "免責聲明" : "Disclaimer")
                    .font(.title3).fontWeight(.bold)
                    .foregroundColor(selectedTheme.primaryText)
                Text(disclaimerText)
                    .font(.subheadline)
                    .foregroundColor(selectedTheme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var disclaimerText: String {
        selectedLanguage == .zh ?
"""
本 App 為純粹的量化數據與技術分析「工具」,所有排序、評分、估值情境、技術指標與 AI 文字內容,皆由演算法依公開市場資料計算產生,僅供研究與參考。

• 本 App 不提供、也不構成任何形式的投資建議、買賣推薦或招攬。
• 所有數據可能有誤差或延遲,不保證準確、完整或即時。
• 任何投資決策應由您自行判斷,並自負盈虧;過去表現不代表未來結果。
• 本 App 並非經許可之證券投資顧問事業,內容不得視為投顧服務。

使用本 App 即表示您已了解並同意以上條款。
""" :
"""
This app is a quantitative data and technical-analysis TOOL. All rankings, scores, valuation scenarios, technical indicators and AI-generated text are produced by algorithms from public market data, for research and reference only.

• It does NOT provide and does NOT constitute investment advice, buy/sell recommendations, or solicitation.
• Data may contain errors or delays and is not guaranteed to be accurate, complete, or real-time.
• All investment decisions are your own responsibility; you bear all gains and losses. Past performance does not indicate future results.
• This app is not a licensed investment advisory service.

By using this app you acknowledge and agree to the above.
"""
    }

    private func settingsEntryButton(icon: String, title: String, subtitle: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.title3)
                    .foregroundColor(.blue)
                    .frame(width: 28)

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .fontWeight(.semibold)
                        .foregroundColor(selectedTheme.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundColor(selectedTheme.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundColor(selectedTheme.secondaryText)
            }
            .padding()
            .background(selectedTheme.cardBackground)
            .cornerRadius(16)
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(selectedTheme.divider, lineWidth: 1)
            )
        }
    }

    private func selectionRow(title: String, subtitle: String?, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .fontWeight(.semibold)
                        .foregroundColor(selectedTheme.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                    if let subtitle {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundColor(selectedTheme.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer()
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundColor(selected ? .blue : selectedTheme.secondaryText)
            }
            .padding()
            .background(selectedTheme.cardBackground)
            .cornerRadius(16)
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(selected ? Color.blue : selectedTheme.divider, lineWidth: 1)
            )
        }
    }
}
