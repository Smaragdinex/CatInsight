import SwiftUI

struct ValuationCardView: View {
    let title: String
    let theme: AppTheme
    let selectedLanguage: AppLanguage
    let valuation: ValuationResponse?
    let currentPrice: Double
    let selectedScenarioId: String
    let onScenarioChange: (String) -> Void
    let formattedCompactNumber: (Double?) -> String
    let currencyPrice: (Double?) -> String
    let percentText: (Double?) -> String
    let multipleText: (Double?) -> String
    let industryBucketText: (String?) -> String
    let expectedReturnColor: (Double?) -> Color

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(title)
                .font(.headline)
                .foregroundColor(theme.primaryText)

            if let valuation, !valuation.scenarios.isEmpty {
                Picker("Scenario", selection: Binding(
                    get: { selectedScenarioId },
                    set: onScenarioChange
                )) {
                    ForEach(valuation.scenarios) { scenario in
                        Text(scenario.label).tag(scenario.id)
                    }
                }
                .pickerStyle(.segmented)

                if let selectedScenario = valuation.scenarios.first(where: { $0.id == selectedScenarioId }) ?? valuation.scenarios.first {
                    let selectedDisplayTarget = valuation.modelType == "revenue_exit_pe" ? (selectedScenario.compositeTargetPrice ?? selectedScenario.targetPrice) : selectedScenario.targetPrice
                    let maxTarget = valuation.modelType == "revenue_exit_pe"
                        ? (valuation.scenarios.compactMap(\.compositeTargetPrice).max() ?? valuation.scenarios.compactMap(\.targetPrice).max() ?? max(currentPrice, 1))
                        : (valuation.scenarios.compactMap(\.targetPrice).max() ?? max(currentPrice, 1))
                    let gaugeRatio = maxTarget > 0 ? min(max((selectedDisplayTarget ?? 0) / maxTarget, 0), 1) : 0

                    VStack(alignment: .leading, spacing: 12) {
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(selectedLanguage == .zh ? "估值參考價格" : "Valuation Reference")
                                    .font(.caption)
                                    .foregroundColor(theme.secondaryText)
                                Text(currencyPrice(selectedDisplayTarget))
                                    .font(.title2)
                                    .fontWeight(.bold)
                                    .foregroundColor(theme.primaryText)
                            }

                            Spacer()

                            VStack(alignment: .trailing, spacing: 4) {
                                Text(selectedLanguage == .zh ? "預期年化報酬率" : "Expected Return")
                                    .font(.caption)
                                    .foregroundColor(theme.secondaryText)
                                Text(percentText(selectedScenario.expectedReturn))
                                    .font(.headline)
                                    .foregroundColor(expectedReturnColor(selectedScenario.expectedReturn))
                            }
                        }

                        GeometryReader { geometry in
                            ZStack(alignment: .leading) {
                                Capsule()
                                    .fill(theme.divider)
                                    .frame(height: 12)

                                Capsule()
                                    .fill(
                                        LinearGradient(
                                            colors: [.orange.opacity(0.75), .green.opacity(0.85)],
                                            startPoint: .leading,
                                            endPoint: .trailing
                                        )
                                    )
                                    .frame(width: geometry.size.width, height: 12)

                                Circle()
                                    .fill(theme.appBackground)
                                    .overlay(Circle().stroke(theme.primaryText, lineWidth: 2))
                                    .frame(width: 24, height: 24)
                                    .offset(x: max(min(geometry.size.width * gaugeRatio - 12, geometry.size.width - 24), 0))
                                    .animation(.easeInOut(duration: 0.35), value: selectedScenarioId)
                            }
                        }
                        .frame(height: 24)

                        HStack {
                            Text(currencyPrice(currentPrice))
                                .font(.caption)
                                .foregroundColor(theme.secondaryText)
                            Spacer()
                            Text(currencyPrice(maxTarget))
                                .font(.caption)
                                .foregroundColor(theme.secondaryText)
                        }

                        if valuation.modelType == "eps_pe" {
                            HStack(spacing: 12) {
                                valuationMetricChip(title: selectedLanguage == .zh ? "預估 EPS" : "Expected EPS", value: formattedCompactNumber(selectedScenario.expectedEPS))
                                valuationMetricChip(title: selectedLanguage == .zh ? "目標本益比" : "Target P/E", value: multipleText(selectedScenario.targetPE))
                                valuationMetricChip(title: selectedLanguage == .zh ? "產業" : "Industry", value: industryBucketText(valuation.industryBucket))
                            }

                            HStack(spacing: 12) {
                                valuationMetricChip(title: selectedLanguage == .zh ? "基準 EPS" : "Base EPS", value: formattedCompactNumber(valuation.baseEPS ?? valuation.forwardEPS ?? valuation.trailingEPS))
                                valuationMetricChip(title: selectedLanguage == .zh ? "現價" : "Current", value: currencyPrice(currentPrice))
                                valuationMetricChip(title: selectedLanguage == .zh ? "模型" : "Model", value: "EPS × P/E")
                            }
                        } else {
                            HStack(spacing: 12) {
                                valuationMetricChip(title: selectedLanguage == .zh ? "營收成長" : "Growth", value: percentText(selectedScenario.revenueGrowthRate))
                                valuationMetricChip(title: selectedLanguage == .zh ? "淨利率" : "Net Margin", value: percentText(selectedScenario.expectedNetMargin))
                                valuationMetricChip(title: selectedLanguage == .zh ? "退出本益比" : "Exit P/E", value: multipleText(selectedScenario.exitPE))
                            }

                            HStack(spacing: 12) {
                                valuationMetricChip(title: selectedLanguage == .zh ? "持有年數" : "Holding", value: "\(valuation.holdingYears)Y")
                                valuationMetricChip(title: selectedLanguage == .zh ? "每股營收" : "Rev/Share", value: formattedCompactNumber(valuation.normalizedRevenuePerShare ?? valuation.currentRevenuePerShare))
                                valuationMetricChip(title: selectedLanguage == .zh ? "現價" : "Current", value: currencyPrice(currentPrice))
                            }

                            HStack(spacing: 12) {
                                valuationMetricChip(title: selectedLanguage == .zh ? "模型價" : "Model", value: currencyPrice(selectedScenario.targetPrice))
                                valuationMetricChip(title: selectedLanguage == .zh ? "分析師均價" : "Analyst Avg", value: currencyPrice(valuation.analystTargetMean))
                                valuationMetricChip(title: selectedLanguage == .zh ? "綜合加權" : "Composite", value: currencyPrice(selectedScenario.compositeTargetPrice))
                            }

                            if let analystCount = valuation.analystCount, analystCount > 0 {
                                HStack(spacing: 12) {
                                    valuationMetricChip(title: selectedLanguage == .zh ? "分析師低標" : "Analyst Low", value: currencyPrice(valuation.analystTargetLow))
                                    valuationMetricChip(title: selectedLanguage == .zh ? "分析師高標" : "Analyst High", value: currencyPrice(valuation.analystTargetHigh))
                                    valuationMetricChip(title: selectedLanguage == .zh ? "分析師數量" : "Analysts", value: "\(analystCount)")
                                }
                            }
                        }

                        if valuation.modelType == "eps_pe",
                           let notes = valuation.notes,
                           !notes.localizedCaseInsensitiveContains("TW v2.1") {
                            Text(notes)
                                .font(.caption)
                                .foregroundColor(theme.secondaryText)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            } else {
                Text(selectedLanguage == .zh ? "目前沒有可用估值資料" : "No valuation inputs available")
                    .font(.subheadline)
                    .foregroundColor(theme.secondaryText)
            }

            Text(selectedLanguage == .zh ? "模型試算,非投資建議" : "Model estimate, not investment advice")
                .font(.caption2)
                .foregroundColor(theme.secondaryText.opacity(0.7))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding()
        .background(theme.appBackground)
    }

    private func valuationMetricChip(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption2)
                .foregroundColor(theme.secondaryText)
            Text(value)
                .font(.subheadline)
                .fontWeight(.semibold)
                .foregroundColor(theme.primaryText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .background(theme.divider.opacity(0.65))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
