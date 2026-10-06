import SwiftUI

struct PulseDotView: View {
    @State private var animate = false
    let color: Color

    var body: some View {
        ZStack {
            Circle()
                .fill(color.opacity(0.22))
                .frame(width: 26, height: 26)
                .scaleEffect(animate ? 1.7 : 0.7)
                .opacity(animate ? 0 : 0.9)

            Circle()
                .fill(color)
                .frame(width: 10, height: 10)
                .overlay(Circle().stroke(Color.white.opacity(0.9), lineWidth: 2))
        }
        .onAppear {
            withAnimation(.easeOut(duration: 1.2).repeatForever(autoreverses: false)) {
                animate = true
            }
        }
    }
}
