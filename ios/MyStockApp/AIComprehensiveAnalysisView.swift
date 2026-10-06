import SwiftUI

private struct PulsingStatusDotView: View {
    let color: Color
    @State private var animate = false

    var body: some View {
        ZStack {
            Circle()
                .fill(color.opacity(animate ? 0.18 : 0.06))
                .frame(width: 12, height: 12)
                .scaleEffect(animate ? 1.45 : 0.9)
            Circle()
                .fill(color.opacity(animate ? 1.0 : 0.45))
                .frame(width: 7, height: 7)
        }
        .animation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true), value: animate)
        .onAppear { animate = true }
    }
}

private struct AnimatedBiasIndicatorView: View {
    enum Direction {
        case bullish, bearish, neutral
    }

    let direction: Direction
    let bullishColor: Color
    let bearishColor: Color
    @State private var animate = false

    private var color: Color {
        switch direction {
        case .bullish: return bullishColor
        case .bearish: return bearishColor
        case .neutral: return .yellow
        }
    }

    private var symbolName: String {
        switch direction {
        case .bullish: return "arrow.up.circle.fill"
        case .bearish: return "pause.circle.fill"
        case .neutral: return "pause.circle.fill"
        }
    }

    private var offset: CGSize {
        switch direction {
        case .bullish: return CGSize(width: 0, height: animate ? -3 : 1)
        case .bearish: return CGSize(width: 0, height: animate ? 3 : -1)
        case .neutral: return CGSize(width: 0, height: animate ? -2 : 2)
        }
    }

    var body: some View {
        Image(systemName: symbolName)
            .font(.headline)
            .foregroundColor(color)
            .offset(offset)
            .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: animate)
            .onAppear { animate = true }
    }
}

struct AIComprehensiveAnalysisView: View {
    let title: String
    let isEnglish: Bool
    let bullishColor: Color
    let bearishColor: Color
    let confidence: String
    let confidenceSegments: Int
    let lowPriceText: String
    let lowPercentText: String?
    let lowPercentColor: Color
    let highPriceText: String
    let highPercentText: String?
    let highPercentColor: Color
    let rangeProgress: Double?
    let currentPriceText: String?
    let isOutOfRange: Bool
    let biasText: String
    let biasColor: Color
    let technicalItems: [String]
    let sentimentLabel: String
    let sentimentIndicatorColor: Color
    let sentimentItems: [String]
    let watchItems: [String]
    let theme: AppTheme

    private var bannerTextColor: Color { biasColor }

    private var biasDirection: AnimatedBiasIndicatorView.Direction {
        let lower = biasText.lowercased()
        if biasText.contains("建議買") || biasText.contains("看多") || lower.contains("buy") || lower.contains("bull") {
            return .bullish
        }
        if biasText.contains("觀望") || biasText.contains("看空") || lower.contains("notbuy") || lower.contains("bear") || lower.contains("avoid") {
            return .bearish
        }
        return .neutral
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                Text(title)
                    .font(.headline)
                    .foregroundColor(theme.primaryText)
                Spacer()
            }

            HStack(alignment: .center, spacing: 26) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(isEnglish ? "Bias" : "走勢")
                        .font(.caption)
                        .foregroundColor(theme.secondaryText)
                    HStack(spacing: 8) {
                        AnimatedBiasIndicatorView(direction: biasDirection, bullishColor: bullishColor, bearishColor: bearishColor)
                        Text(biasText)
                            .font(.title3)
                            .fontWeight(.bold)
                            .foregroundColor(biasColor)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                VStack(alignment: .trailing, spacing: 6) {
                    Text(isEnglish ? "Confidence" : "信心度")
                        .font(.caption)
                        .foregroundColor(theme.secondaryText)
                    HStack(spacing: 4) {
                        ForEach(0..<3, id: \.self) { index in
                            RoundedRectangle(cornerRadius: 3)
                                .fill(index < confidenceSegments ? Color.blue : theme.divider.opacity(0.8))
                                .frame(width: 16, height: 6)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
            }

            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 14) {
                    rangeLowBlock
                    currentGaugeBlock
                    rangeHighBlock
                }

                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 14) {
                        rangeLowBlock
                        rangeHighBlock
                    }
                    currentGaugeBlock
                }
            }

            Divider().overlay(theme.divider)

            section(title: isEnglish ? "Technical" : "技術面", items: technicalItems)
            section(title: isEnglish ? "Sentiment" : "情緒面", subtitle: sentimentLabel, subtitleColor: sentimentIndicatorColor, items: sentimentItems)
            section(title: isEnglish ? "Watch" : "觀察點", items: watchItems)
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 28)
        .background(theme.appBackground)
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }

    private var rangeLowBlock: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(isEnglish ? "Range Low" : "區間低點")
                .font(.caption2)
                .foregroundColor(theme.secondaryText)
            Text(lowPriceText)
                .font(.callout)
                .fontWeight(.bold)
                .foregroundColor(theme.primaryText)
                .minimumScaleFactor(0.5)
            if let lowPercentText {
                Text(lowPercentText)
                    .font(.caption)
                    .foregroundColor(lowPercentColor)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var currentGaugeBlock: some View {
        VStack(spacing: 2) {
            Text(isEnglish ? "Now" : "現價")
                .font(.caption2)
                .foregroundColor(theme.secondaryText)
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(theme.divider.opacity(0.6))
                        .frame(height: 4)
                    if let rangeProgress {
                        PulseDotView(color: .blue)
                            .frame(width: 14, height: 14)
                            .offset(x: max(0, min(geometry.size.width - 14, geometry.size.width * rangeProgress - 7)))
                    }
                }
            }
            .frame(maxWidth: .infinity, minHeight: 14, maxHeight: 14)
            if let currentPriceText {
                Text(currentPriceText)
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundColor(theme.primaryText)
                    .minimumScaleFactor(0.5)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var rangeHighBlock: some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(isEnglish ? "Range High" : "區間高點")
                .font(.caption2)
                .foregroundColor(theme.secondaryText)
            Text(highPriceText)
                .font(.callout)
                .fontWeight(.bold)
                .foregroundColor(theme.primaryText)
                .minimumScaleFactor(0.5)
            if let highPercentText {
                Text(highPercentText)
                    .font(.caption)
                    .foregroundColor(highPercentColor)
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    @ViewBuilder
    private func section(title: String, subtitle: String? = nil, subtitleColor: Color = .clear, items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color.blue)
                    .frame(width: 3, height: 14)
                Text(title)
                    .font(.caption)
                    .foregroundColor(theme.secondaryText)
                if let subtitle {
                    HStack(spacing: 5) {
                        PulsingStatusDotView(color: subtitleColor)
                        Text(subtitle)
                            .font(.caption)
                            .foregroundColor(theme.secondaryText.opacity(0.7))
                    }
                }
            }
            ForEach(items, id: \.self) { item in
                HStack(alignment: .top, spacing: 8) {
                    Circle()
                        .fill(theme.secondaryText.opacity(0.7))
                        .frame(width: 5, height: 5)
                        .padding(.top, 7)
                    Text(item)
                        .font(.subheadline)
                        .foregroundColor(theme.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}
