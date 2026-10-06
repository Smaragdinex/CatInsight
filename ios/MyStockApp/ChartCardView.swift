import SwiftUI
import Charts

/// 看盤軟體風格的價格圖(Yahoo Finance / Robinhood):
/// - x 軸按「第幾筆」排列,週末與休市不佔寬度;1D 固定整段交易時段的格數,盤中未走完的部分留白
/// - 一條線 + 淡漸層、昨收(1D)/期初虛線基準、右側 3 個價位、底部 4~5 個時間;不畫直格線、不畫均線
/// - 長按拖曳出十字線,上方顯示日期與價格(K 線模式顯示開高低收)
struct ChartCardView: View {
    let chartPoints: [ChartPoint]
    let selectedPeriod: String
    let trendColor: Color
    let yMin: Double
    let yMax: Double
    let livePoint: ChartPoint?
    let baseline: Double?
    let slotCount: Int
    let dividerColor: Color
    let axisColor: Color
    let primaryColor: Color
    let secondaryColor: Color
    let themeBackground: Color
    let axisLabel: (Date) -> String
    let tooltipLabel: (Date) -> String
    var candles: [ChartCandle] = []
    var isCandle: Bool = false
    var upColor: Color = .green
    var downColor: Color = .red

    @State private var selectedIndex: Int? = nil

    private var pointCount: Int { isCandle ? candles.count : chartPoints.count }
    private var domainMax: Double { Double(max(slotCount, pointCount) - 1) }
    private var yTicks: [Double] { niceTicks(min: yMin, max: yMax, desired: 3) }

    /// x 軸標籤的索引:1D 每 1.5 小時(美股)/ 1 小時(台股)一個,其他期間平均取 5 個。
    private var xTickIndices: [Double] {
        let n = max(slotCount, pointCount)
        guard n > 1 else { return [0] }
        if selectedPeriod == "1d" {
            // 每 1.5 小時(美股)/ 1 小時(台股)一個;最後一段不標,避免最右邊的標籤被裁掉
            let step = n >= 70 ? 18 : 12
            return stride(from: 0, to: n - step / 2, by: step).map(Double.init)
        }
        if selectedPeriod == "5d" {
            // 1W:每個交易日的第一根標一次日期
            // 即時點(isLivePoint)不算新的一天,否則會多出一個今天的標籤
            let dates = isCandle ? candles.map(\.date) : chartPoints.filter { !$0.isLivePoint }.map(\.date)
            let cal = Calendar.current
            var out: [Double] = []
            var lastDay: Int? = nil
            for (i, d) in dates.enumerated() {
                let day = cal.ordinality(of: .day, in: .era, for: d) ?? 0
                if day != lastDay { out.append(Double(i)); lastDay = day }
            }
            return out
        }
        let step = max(1, n / 5)
        return stride(from: 0, to: n, by: step).map(Double.init)
    }

    private func dateAt(index: Int) -> Date? {
        let dates = isCandle ? candles.map(\.date) : chartPoints.map(\.date)
        if index < dates.count { return dates[index] }
        // 1D 資料還沒走完:用第一筆時間 + 5 分鐘 × 索引 推出標籤
        guard selectedPeriod == "1d", let first = dates.first else { return nil }
        return first.addingTimeInterval(Double(index) * 300)
    }

    private func xLabel(_ value: Double) -> String {
        dateAt(index: Int(value.rounded())).map(axisLabel) ?? ""
    }

    private func priceText(_ v: Double) -> String {
        (yMax - yMin) >= 10 ? String(format: "%.0f", v) : String(format: "%.2f", v)
    }

    private var tooltipText: String? {
        guard let i = selectedIndex, i >= 0, i < pointCount, let date = dateAt(index: i) else { return nil }
        if isCandle {
            let c = candles[i]
            return "\(tooltipLabel(date))   O \(String(format: "%.2f", c.open))  H \(String(format: "%.2f", c.high))  L \(String(format: "%.2f", c.low))  C \(String(format: "%.2f", c.close))"
        }
        return "\(tooltipLabel(date))   $\(String(format: "%.2f", chartPoints[i].price))"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // 十字線資訊列(固定高度,避免出現/消失時版面跳動)
            HStack {
                Spacer()
                Text(tooltipText ?? " ")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(primaryColor)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Spacer()
            }
            .frame(height: 22)

            if isCandle {
                candleChart
                volumeChart
            } else {
                lineChart
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 12)
        .background(themeBackground)
    }

    // MARK: - 折線

    private var lineChart: some View {
        Chart {
            ForEach(Array(chartPoints.enumerated()), id: \.offset) { i, p in
                AreaMark(x: .value("i", Double(i)), yStart: .value("Bottom", yMin), yEnd: .value("Price", p.price))
                    .foregroundStyle(LinearGradient(colors: [trendColor.opacity(0.28), trendColor.opacity(0.0)], startPoint: .top, endPoint: .bottom))
                LineMark(x: .value("i", Double(i)), y: .value("Price", p.price))
                    .foregroundStyle(trendColor)
                    .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            }
            if let baseline {
                RuleMark(y: .value("Baseline", baseline))
                    .foregroundStyle(secondaryColor.opacity(0.45))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 4]))
            }
            if let selectedIndex, selectedIndex < chartPoints.count {
                RuleMark(x: .value("sel", Double(selectedIndex)))
                    .foregroundStyle(secondaryColor.opacity(0.6))
                    .lineStyle(StrokeStyle(lineWidth: 1))
                PointMark(x: .value("sel", Double(selectedIndex)), y: .value("Price", chartPoints[selectedIndex].price))
                    .foregroundStyle(trendColor)
                    .symbolSize(70)
            }
        }
        .chartXScale(domain: 0...max(domainMax, 1))
        .chartYScale(domain: yMin...yMax)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .chartOverlay { proxy in overlay(proxy: proxy, showLiveDot: true) }
        .frame(height: 240)
    }

    // MARK: - K 線 + 成交量

    private var candleChart: some View {
        Chart {
            ForEach(Array(candles.enumerated()), id: \.offset) { i, c in
                let col = c.close >= c.open ? upColor : downColor
                RuleMark(x: .value("i", Double(i)), yStart: .value("Low", c.low), yEnd: .value("High", c.high))
                    .foregroundStyle(col).lineStyle(StrokeStyle(lineWidth: 1))
                RectangleMark(xStart: .value("a", Double(i) - 0.3), xEnd: .value("b", Double(i) + 0.3),
                              yStart: .value("Open", c.open), yEnd: .value("Close", c.close))
                    .foregroundStyle(col)
            }
            if let selectedIndex, selectedIndex < candles.count {
                RuleMark(x: .value("sel", Double(selectedIndex)))
                    .foregroundStyle(secondaryColor.opacity(0.6))
                    .lineStyle(StrokeStyle(lineWidth: 1))
            }
        }
        .chartXScale(domain: -0.5...(max(domainMax, 1) + 0.5))
        .chartYScale(domain: yMin...yMax)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .chartOverlay { proxy in overlay(proxy: proxy, showLiveDot: false) }
        .frame(height: 220)
    }

    private var volumeChart: some View {
        Chart {
            ForEach(Array(candles.enumerated()), id: \.offset) { i, c in
                RectangleMark(xStart: .value("a", Double(i) - 0.3), xEnd: .value("b", Double(i) + 0.3),
                              yStart: .value("zero", 0.0), yEnd: .value("Volume", c.volume))
                    .foregroundStyle((c.close >= c.open ? upColor : downColor).opacity(0.5))
            }
        }
        .chartXScale(domain: -0.5...(max(domainMax, 1) + 0.5))
        .chartYScale(domain: 0...max((candles.map(\.volume).max() ?? 1) * 1.1, 1))
        .chartXAxis(.hidden)
        .chartYAxis {
            AxisMarks(position: .trailing, values: .automatic(desiredCount: 2)) { value in
                AxisValueLabel {
                    if let v = value.as(Double.self) { Text(volumeLabel(v)).font(.caption2).foregroundColor(axisColor) }
                }
            }
        }
        .frame(height: 56)
    }

    private func volumeLabel(_ v: Double) -> String {
        if v >= 1e9 { return String(format: "%.0fB", v / 1e9) }
        if v >= 1e6 { return String(format: "%.0fM", v / 1e6) }
        return String(format: "%.0fK", v / 1e3)
    }

    // MARK: - 軸

    @AxisContentBuilder private var xAxis: some AxisContent {
        AxisMarks(values: xTickIndices) { value in
            AxisValueLabel {
                if let v = value.as(Double.self) { Text(xLabel(v)).font(.caption2).foregroundColor(axisColor) }
            }
        }
    }

    @AxisContentBuilder private var yAxis: some AxisContent {
        AxisMarks(position: .trailing, values: yTicks) { value in
            AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5)).foregroundStyle(dividerColor)
            AxisValueLabel {
                if let v = value.as(Double.self) { Text(priceText(v)).font(.caption2).foregroundColor(axisColor) }
            }
        }
    }

    // MARK: - 十字線手勢 + 即時點

    private func overlay(proxy: ChartProxy, showLiveDot: Bool) -> some View {
        GeometryReader { geo in
            let plotRect: CGRect = proxy.plotFrame.map { geo[$0] } ?? .zero
            ZStack(alignment: .topLeading) {
                Rectangle().fill(Color.clear).contentShape(Rectangle())
                    .gesture(
                        LongPressGesture(minimumDuration: 0.15)
                            .sequenced(before: DragGesture(minimumDistance: 0, coordinateSpace: .local))
                            .onChanged { value in
                                guard case .second(true, let drag?) = value, plotRect.width > 0, pointCount > 0 else { return }
                                let ratio = (drag.location.x - plotRect.minX) / plotRect.width
                                let idx = Int((ratio * domainMax).rounded())
                                selectedIndex = min(max(idx, 0), pointCount - 1)
                            }
                            .onEnded { _ in selectedIndex = nil }
                    )
                if showLiveDot, selectedIndex == nil, let lp = livePoint,
                   let liveIndex = chartPoints.lastIndex(where: \.isLivePoint),
                   let px = proxy.position(forX: Double(liveIndex)),
                   let py = proxy.position(forY: lp.price) {
                    PulseDotView(color: trendColor)
                        .position(x: px + plotRect.minX, y: py + plotRect.minY)
                        .allowsHitTesting(false)
                }
            }
        }
    }
}

/// 在 [min, max] 內取「好看」的刻度(1/2/5 × 10^k)。
private func niceTicks(min: Double, max: Double, desired: Int) -> [Double] {
    let range = max - min
    guard range > 0, desired > 0 else { return [min] }
    let raw = range / Double(desired)
    let magnitude = pow(10.0, floor(log10(raw)))
    let normalized = raw / magnitude
    let step = (normalized < 1.5 ? 1.0 : normalized < 3.0 ? 2.0 : normalized < 7.0 ? 5.0 : 10.0) * magnitude
    var result: [Double] = []
    var v = ceil(min / step) * step
    while v <= max + step * 1e-6 && result.count < 50 {
        result.append(v)
        v += step
    }
    return result
}
