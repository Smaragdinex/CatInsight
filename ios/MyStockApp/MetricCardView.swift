import SwiftUI

struct MetricCardView: View {
    let title: String
    let value: String
    let primaryText: Color
    let secondaryText: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.caption)
                .foregroundColor(secondaryText)
                .fixedSize(horizontal: false, vertical: true)

            Text(value)
                .font(.headline)
                .fontWeight(.semibold)
                .foregroundColor(primaryText)
                .minimumScaleFactor(0.5)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 10)
        .padding(.horizontal, 4)
    }
}
