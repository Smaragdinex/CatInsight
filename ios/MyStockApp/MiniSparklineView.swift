import SwiftUI

struct MiniSparklineView: View {
    let values: [Double]
    let color: Color
    /// 虛線基準(通常為昨收價)。給定時虛線畫在此值;線在其上=漲、其下=跌,與卡片顏色一致。
    /// 不給(nil)沿用舊行為:以走勢第一點為基準。
    var baseline: Double? = nil

    var body: some View {
        GeometryReader { geometry in
            let baselineValue = baseline ?? values.first ?? 0
            // 把基準也納入範圍,確保昨收虛線一定在圖內可見
            let minValue = min(values.min() ?? 0, baselineValue)
            let maxValue = max(values.max() ?? 1, baselineValue)
            let range = max(maxValue - minValue, 0.0001)
            let width = geometry.size.width
            let height = geometry.size.height
            let baselineY = height * CGFloat(1 - ((baselineValue - minValue) / range))

            ZStack {
                if !values.isEmpty {
                    Path { path in
                        path.move(to: CGPoint(x: 0, y: baselineY))
                        path.addLine(to: CGPoint(x: width, y: baselineY))
                    }
                    .stroke(
                        Color.white.opacity(0.5),
                        style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [4, 3])
                    )
                }

                Path { path in
                    guard !values.isEmpty else { return }
                    for (index, value) in values.enumerated() {
                        let x = width * CGFloat(index) / CGFloat(max(values.count - 1, 1))
                        let y = height * CGFloat(1 - ((value - minValue) / range))
                        if index == 0 {
                            path.move(to: CGPoint(x: x, y: y))
                        } else {
                            path.addLine(to: CGPoint(x: x, y: y))
                        }
                    }
                }
                .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            }
        }
        .frame(width: 92, height: 34)
    }
}
