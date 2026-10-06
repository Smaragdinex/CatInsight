import SwiftUI

struct RatingBarView: View {
    let label: String
    let percent: Int
    let color: Color
    let primaryText: Color
    let secondaryText: Color
    let divider: Color

    var body: some View {
        HStack(spacing: 10) {
            Text(label)
                .font(.subheadline)
                .foregroundColor(primaryText)
                .frame(minWidth: 44, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)

            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(divider)
                        .frame(height: 10)
                    Capsule()
                        .fill(color)
                        .frame(width: geometry.size.width * CGFloat(percent) / 100, height: 10)
                }
            }
            .frame(height: 10)

            Text("\(percent)%")
                .font(.caption)
                .foregroundColor(secondaryText)
                .frame(minWidth: 42, alignment: .trailing)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
