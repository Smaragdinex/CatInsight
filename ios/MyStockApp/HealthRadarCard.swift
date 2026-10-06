import SwiftUI

// 個股「一鍵量化體檢」雷達卡:把模型 6 大因子的全市場百分位畫成雷達圖,
// 並以總分百分位當頭條(擊敗 X% 美股)。資料來自後端 /health/{symbol}。
struct HealthRadarCard: View {
    let health: HealthResponse
    let theme: AppTheme
    let isZh: Bool

    private let gold = Color(red: 0.902, green: 0.753, blue: 0.322)
    private let goodGreen = Color(red: 0.122, green: 0.682, blue: 0.337)

    private var factors: [HealthFactor] { health.factors ?? [] }
    private var overall: Int { health.overall ?? 0 }

    private func tierColor(_ v: Int) -> Color {
        if v >= 67 { return goodGreen }
        if v >= 34 { return gold }
        return Color(red: 0.890, green: 0.290, blue: 0.302)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(isZh ? "量化體檢" : "Stock Health")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(theme.primaryText)
                Spacer()
                if let asOf = health.asOf {
                    Text(asOf)
                        .font(.system(size: 11))
                        .foregroundColor(theme.secondaryText)
                }
            }

            VStack(spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text("\(overall)")
                        .font(.system(size: 44, weight: .bold))
                        .foregroundColor(theme.primaryText)
                    Text(isZh ? "百分位" : "th pct")
                        .font(.system(size: 14))
                        .foregroundColor(theme.secondaryText)
                }
                Text(isZh ? "擊敗 \(overall)% 美股" : "Beats \(overall)% of US stocks")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(goodGreen)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 5)
                    .background(goodGreen.opacity(0.15))
                    .clipShape(Capsule())
            }
            .frame(maxWidth: .infinity, alignment: .center)

            radar
                .frame(height: 250)
        }
        .padding(16)
        .background(theme.cardBackground)
        .cornerRadius(16)
    }

    private var radar: some View {
        GeometryReader { geo in
            let c = CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)
            let maxR = min(geo.size.width, geo.size.height) / 2 - 44
            ZStack {
                Canvas { ctx, size in
                    let center = CGPoint(x: size.width / 2, y: size.height / 2)
                    let r = min(size.width, size.height) / 2 - 44
                    let grid = theme.primaryText.opacity(0.14)

                    for ring in [1.0 / 3.0, 2.0 / 3.0, 1.0] {
                        var p = Path()
                        for i in 0..<factors.count {
                            let pt = Self.vertex(center, r * ring, i, factors.count)
                            if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
                        }
                        p.closeSubpath()
                        ctx.stroke(p, with: .color(grid), lineWidth: 1)
                    }
                    for i in 0..<factors.count {
                        var p = Path()
                        p.move(to: center)
                        p.addLine(to: Self.vertex(center, r, i, factors.count))
                        ctx.stroke(p, with: .color(grid.opacity(0.7)), lineWidth: 0.8)
                    }

                    var dp = Path()
                    for (i, f) in factors.enumerated() {
                        let pt = Self.vertex(center, r * CGFloat(f.value) / 100.0, i, factors.count)
                        if i == 0 { dp.move(to: pt) } else { dp.addLine(to: pt) }
                    }
                    dp.closeSubpath()
                    ctx.fill(dp, with: .color(gold.opacity(0.22)))
                    ctx.stroke(dp, with: .color(gold.opacity(0.35)), lineWidth: 5)
                    ctx.stroke(dp, with: .color(gold), lineWidth: 2)

                    for (i, f) in factors.enumerated() {
                        let pt = Self.vertex(center, r * CGFloat(f.value) / 100.0, i, factors.count)
                        let dot = CGRect(x: pt.x - 3.2, y: pt.y - 3.2, width: 6.4, height: 6.4)
                        ctx.fill(Path(ellipseIn: dot), with: .color(gold))
                    }
                }

                ForEach(Array(factors.enumerated()), id: \.offset) { idx, f in
                    let pt = Self.vertex(c, maxR + 22, idx, factors.count)
                    VStack(spacing: 1) {
                        Text(f.labelEn)
                            .font(.system(size: 9))
                            .foregroundColor(theme.secondaryText.opacity(0.7))
                        HStack(spacing: 3) {
                            Text(f.labelZh)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(theme.secondaryText)
                            Text("\(f.value)")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundColor(tierColor(f.value))
                        }
                    }
                    .fixedSize()
                    .position(x: pt.x, y: pt.y)
                }
            }
        }
    }

    private static func vertex(_ c: CGPoint, _ r: CGFloat, _ i: Int, _ n: Int) -> CGPoint {
        let angle = (-90.0 + 360.0 / Double(max(n, 1)) * Double(i)) * .pi / 180.0
        return CGPoint(x: c.x + r * CGFloat(cos(angle)), y: c.y + r * CGFloat(sin(angle)))
    }
}
