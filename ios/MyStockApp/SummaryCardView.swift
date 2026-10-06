import SwiftUI

struct SummaryCardView: View {
    let stock: String
    let companyName: String
    let quoteLoading: Bool
    let priceLabel: String
    let latestPriceText: String
    let priceColor: Color
    let changeText: String?
    let changeColor: Color?
    let fallbackText: String
    let maLabel: String
    let maText: String
    let sessionText: String?
    let sessionColor: Color?
    let theme: AppTheme

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(stock)
                        .font(.caption)
                        .foregroundColor(theme.secondaryText)

                    Text(companyName)
                        .font(.title2)
                        .fontWeight(.bold)
                        .foregroundColor(theme.primaryText)
                        .multilineTextAlignment(.leading)
                }

                Spacer()

                if quoteLoading {
                    ProgressView()
                        .scaleEffect(0.8)
                        .tint(theme.primaryText)
                }
            }

            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(priceLabel)
                        .font(.caption)
                        .foregroundColor(theme.secondaryText)

                    Text(latestPriceText)
                        .font(.title2)
                        .fontWeight(.bold)
                        .foregroundColor(priceColor)
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)

                    if let changeText, let changeColor {
                        Text(changeText)
                            .font(.subheadline)
                            .foregroundColor(changeColor)
                    } else {
                        Text(fallbackText)
                            .font(.caption)
                            .foregroundColor(theme.secondaryText)
                    }
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 6) {
                    Text(maLabel)
                        .font(.caption)
                        .foregroundColor(theme.secondaryText)

                    Text(maText)
                        .font(.headline)
                        .foregroundColor(theme.primaryText)

                    if let sessionText, let sessionColor {
                        Text(sessionText)
                            .font(.caption2)
                            .foregroundColor(sessionColor)
                    }
                }
            }
        }
        .padding()
        .background(theme.appBackground)
    }
}
