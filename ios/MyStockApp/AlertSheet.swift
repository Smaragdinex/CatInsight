import SwiftUI

/// 個股提醒設定(參考 Robinhood):選指標 + 觸發條件 + 目標值,並列出已設定的提醒。
struct AlertSheet: View {
    let symbol: String
    let theme: AppTheme
    let isZh: Bool
    /// 漲/跌色(已依台美切換):above 用漲色、below 用跌色。
    var upColor: Color = .green
    var downColor: Color = .red

    @Environment(\.dismiss) private var dismiss
    @StateObject private var center = AlertCenter.shared

    @State private var metric: AlertMetric = .price
    @State private var direction: AlertDirection = .above
    @State private var targetText: String = ""
    @State private var interval: String = "5 min"
    @State private var showDirOptions = false
    @State private var periodText: String = "14"
    @State private var fastText: String = "12"
    @State private var slowText: String = "26"
    @State private var signalText: String = "9"

    private let intervals = ["5 min", "15 min", "1 hour", "Daily"]
    private var needsTarget: Bool { metric == .price || metric == .rsi }   // 只有 價格/RSI 要輸入數值
    private var needsPeriod: Bool { metric == .rsi || metric == .ma }
    private var needsDirection: Bool { metric != .moneyOutflow }
    private var needsInterval: Bool { metric != .price && metric != .moneyOutflow }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    // 新增提醒
                    VStack(spacing: 0) {
                        row(label: isZh ? "提醒項目" : "Alert for") {
                            Menu {
                                Picker("", selection: $metric) {
                                    Text(isZh ? "價格" : "Price").tag(AlertMetric.price)
                                    Text("RSI").tag(AlertMetric.rsi)
                                    Text(isZh ? "均線 MA" : "MA").tag(AlertMetric.ma)
                                    Text("VWAP").tag(AlertMetric.vwap)
                                    Text("MACD").tag(AlertMetric.macd)
                                    Text(isZh ? "大戶出金" : "Money outflow").tag(AlertMetric.moneyOutflow)
                                }
                            } label: { menuLabel(metricName(metric)) }
                        }
                        // 週期(RSI / MA)
                        if needsPeriod {
                            Divider().overlay(theme.divider)
                            row(label: (metric == .ma ? "MA" : "RSI") + (isZh ? " 週期" : " period")) {
                                TextField(metric == .ma ? "10" : "14", text: $periodText)
                                    .keyboardType(.numberPad)
                                    .multilineTextAlignment(.trailing)
                                    .foregroundColor(theme.primaryText)
                                    .frame(maxWidth: 80)
                            }
                        }
                        // MACD 參數(Fast / Slow / Signal,預設 12/26/9)
                        if metric == .macd {
                            Divider().overlay(theme.divider)
                            row(label: isZh ? "快線週期" : "Fast period") { periodField($fastText, "12") }
                            Divider().overlay(theme.divider)
                            row(label: isZh ? "慢線週期" : "Slow period") { periodField($slowText, "26") }
                            Divider().overlay(theme.divider)
                            row(label: isZh ? "訊號週期" : "Signal period") { periodField($signalText, "9") }
                        }
                        // 觸發條件(除大戶出金外都有)
                        if needsDirection {
                            Divider().overlay(theme.divider)
                            Button { withAnimation(.easeInOut(duration: 0.15)) { showDirOptions.toggle() } } label: {
                                HStack {
                                    Text(isZh ? "觸發條件" : "Trigger").foregroundColor(theme.secondaryText)
                                    Spacer()
                                    dirArrow(direction)
                                    Text(directionName(direction)).foregroundColor(theme.primaryText)
                                    Image(systemName: "chevron.up.chevron.down").font(.caption2).foregroundColor(theme.secondaryText)
                                }
                                .font(.subheadline)
                                .padding(.horizontal, 14).padding(.vertical, 13)
                                .contentShape(Rectangle())
                            }
                            if showDirOptions {
                                dirOption(.above)
                                dirOption(.below)
                            }
                        }
                        // 數值(僅 價格 / RSI)
                        if needsTarget {
                            Divider().overlay(theme.divider)
                            row(label: metric == .rsi ? (isZh ? "門檻值" : "Level") : (isZh ? "目標值" : "Target")) {
                                TextField(metric == .rsi ? (isZh ? "如 70 / 30" : "e.g. 70 / 30") : (isZh ? "價格" : "Price"), text: $targetText)
                                    .keyboardType(.decimalPad)
                                    .multilineTextAlignment(.trailing)
                                    .foregroundColor(theme.primaryText)
                                    .frame(maxWidth: 140)
                            }
                        }
                        if metric == .moneyOutflow {
                            Divider().overlay(theme.divider)
                            row(label: "") {
                                Text(isZh ? "偵測到大戶出金時提醒" : "Notify on big-money outflow")
                                    .font(.caption).foregroundColor(theme.secondaryText)
                            }
                        }
                        // 檢查頻率(技術指標才有,價格/大戶出金不需要)
                        if needsInterval {
                            Divider().overlay(theme.divider)
                            row(label: isZh ? "檢查頻率" : "Interval") {
                                Menu {
                                    Picker("", selection: $interval) {
                                        ForEach(intervals, id: \.self) { Text(intervalName($0)).tag($0) }
                                    }
                                } label: { menuLabel(intervalName(interval)) }
                            }
                        }
                    }
                    .background(theme.cardBackground)
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(theme.divider, lineWidth: 1))
                    .cornerRadius(14)

                    Button { addAlert() } label: {
                        Text(isZh ? "新增提醒" : "Add alert")
                            .font(.subheadline.weight(.semibold)).foregroundColor(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, 12)
                            .background(canAdd ? Color.blue : Color.gray.opacity(0.4))
                            .cornerRadius(12)
                    }
                    .disabled(!canAdd)

                    // 已設定
                    let existing = center.alerts(for: symbol)
                    if !existing.isEmpty {
                        Text(isZh ? "已設定的提醒" : "Your alerts")
                            .font(.headline).foregroundColor(theme.primaryText)
                        ForEach(existing) { a in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(describe(a)).font(.subheadline).foregroundColor(theme.primaryText)
                                    if let t = a.lastTriggered {
                                        Text((isZh ? "上次觸發 " : "Triggered ") + relative(t))
                                            .font(.caption2).foregroundColor(theme.secondaryText)
                                    }
                                }
                                Spacer()
                                Button { center.delete(a) } label: {
                                    Image(systemName: "trash").foregroundColor(.red)
                                }
                            }
                            .padding(12)
                            .background(theme.cardBackground)
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.divider, lineWidth: 1))
                            .cornerRadius(12)
                        }
                    }
                }
                .padding(16)
            }
            .background(theme.appBackground)
            .navigationTitle(isZh ? "\(symbol) 提醒" : "\(symbol) alerts")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(isZh ? "完成" : "Done") { dismiss() }
                }
            }
        }
        .onAppear { center.requestAuthorization() }
    }

    private var canAdd: Bool {
        if !needsTarget { return true }
        return Double(targetText) != nil
    }

    private func addAlert() {
        let target = Double(targetText) ?? 0
        let period = needsPeriod ? (Int(periodText).map { min(max($0, 2), 50) } ?? (metric == .ma ? 10 : 14)) : nil
        let isMacd = metric == .macd
        center.add(StockAlert(id: UUID(), symbol: symbol.uppercased(), metric: metric,
                              direction: direction, target: target, enabled: true,
                              lastTriggered: nil, interval: needsInterval ? interval : nil, period: period,
                              fastPeriod: isMacd ? (Int(fastText) ?? 12) : nil,
                              slowPeriod: isMacd ? (Int(slowText) ?? 26) : nil,
                              signalPeriod: isMacd ? (Int(signalText) ?? 9) : nil))
        targetText = ""
    }

    private func periodField(_ text: Binding<String>, _ placeholder: String) -> some View {
        TextField(placeholder, text: text)
            .keyboardType(.numberPad)
            .multilineTextAlignment(.trailing)
            .foregroundColor(theme.primaryText)
            .frame(maxWidth: 80)
    }

    private func dirArrow(_ d: AlertDirection) -> some View {
        Image(systemName: d == .above ? "arrow.up" : "arrow.down")
            .font(.caption.weight(.bold))
            .foregroundColor(d == .above ? upColor : downColor)
    }

    private func directionName(_ d: AlertDirection) -> String {
        d == .above ? (isZh ? "高於" : "Above") : (isZh ? "低於" : "Below")
    }

    private func dirOption(_ d: AlertDirection) -> some View {
        Button {
            direction = d
            withAnimation(.easeInOut(duration: 0.15)) { showDirOptions = false }
        } label: {
            HStack(spacing: 6) {
                dirArrow(d)
                Text(directionName(d) + (isZh ? "目標" : (d == .above ? " (rises above)" : " (falls below)")))
                    .foregroundColor(theme.primaryText)
                Spacer()
                if direction == d { Image(systemName: "checkmark").font(.caption).foregroundColor(.blue) }
            }
            .font(.subheadline)
            .padding(.horizontal, 22).padding(.vertical, 11)
            .background(direction == d ? Color.blue.opacity(0.10) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func intervalName(_ s: String) -> String {
        guard isZh else { return s }
        switch s {
        case "5 min": return "5 分鐘"
        case "15 min": return "15 分鐘"
        case "1 hour": return "1 小時"
        case "Daily": return "每日"
        default: return s
        }
    }

    @ViewBuilder
    private func row<Content: View>(label: String, @ViewBuilder content: () -> Content) -> some View {
        HStack {
            if !label.isEmpty { Text(label).foregroundColor(theme.secondaryText) }
            Spacer()
            content()
        }
        .font(.subheadline)
        .padding(.horizontal, 14).padding(.vertical, 13)
    }

    private func menuLabel(_ text: String) -> some View {
        HStack(spacing: 4) {
            Text(text).foregroundColor(theme.primaryText)
            Image(systemName: "chevron.up.chevron.down").font(.caption2).foregroundColor(theme.secondaryText)
        }
    }

    private func metricName(_ m: AlertMetric) -> String {
        switch m {
        case .price: return isZh ? "價格" : "Price"
        case .rsi: return "RSI"
        case .ma: return isZh ? "均線 MA" : "MA"
        case .vwap: return "VWAP"
        case .macd: return "MACD"
        case .moneyOutflow: return isZh ? "大戶出金" : "Money outflow"
        }
    }

    private func describe(_ a: StockAlert) -> String {
        switch a.metric {
        case .moneyOutflow: return isZh ? "大戶出金時提醒" : "On money outflow"
        case .price:
            return isZh ? "價格 \(a.direction == .above ? "高於" : "低於") \(fmt(a.target))"
                        : "Price \(a.direction == .above ? "above" : "below") \(fmt(a.target))"
        case .rsi:
            let p = a.period ?? 14
            return isZh ? "RSI(\(p)) \(a.direction == .above ? "高於" : "低於") \(Int(a.target))"
                        : "RSI(\(p)) \(a.direction == .above ? "above" : "below") \(Int(a.target))"
        case .ma:
            let p = a.period ?? 10
            return isZh ? "價格 \(a.direction == .above ? "突破" : "跌破") MA(\(p))"
                        : "Price \(a.direction == .above ? "above" : "below") MA(\(p))"
        case .vwap:
            return isZh ? "價格 \(a.direction == .above ? "高於" : "低於") VWAP"
                        : "Price \(a.direction == .above ? "above" : "below") VWAP"
        case .macd:
            return isZh ? "MACD \(a.direction == .above ? "黃金交叉" : "死亡交叉")"
                        : "MACD \(a.direction == .above ? "bullish cross" : "bearish cross")"
        }
    }

    private func fmt(_ v: Double) -> String { String(format: "%.2f", v) }
    private func relative(_ d: Date) -> String {
        let f = RelativeDateTimeFormatter(); f.locale = Locale(identifier: isZh ? "zh_TW" : "en_US")
        return f.localizedString(for: d, relativeTo: Date())
    }
}
