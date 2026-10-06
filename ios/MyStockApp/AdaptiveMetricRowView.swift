import SwiftUI

struct AdaptiveMetricRowView<Content: View>: View {
    let spacing: CGFloat
    @ViewBuilder let content: () -> Content

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: spacing) {
                content()
            }
            VStack(alignment: .leading, spacing: spacing) {
                content()
            }
        }
    }
}
