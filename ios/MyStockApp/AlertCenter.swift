import Foundation
import SwiftUI
import Combine
import UserNotifications

/// 本機儲存價格/技術提醒 + 評估觸發 + 發本機通知。
@MainActor
final class AlertCenter: ObservableObject {
    static let shared = AlertCenter()

    @Published private(set) var alerts: [StockAlert] = []
    private let key = "stock.alerts.v1"

    init() { load() }

    // MARK: - 儲存

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: key) else { return }
        if let decoded = try? JSONDecoder().decode([StockAlert].self, from: data) {
            alerts = decoded
        }
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(alerts) {
            UserDefaults.standard.set(data, forKey: key)
        }
        PushSync.shared.syncAlerts()
    }

    func alerts(for symbol: String) -> [StockAlert] {
        alerts.filter { $0.symbol == symbol.uppercased() }
    }

    func add(_ alert: StockAlert) {
        alerts.append(alert)
        persist()
    }

    func update(_ alert: StockAlert) {
        if let i = alerts.firstIndex(where: { $0.id == alert.id }) { alerts[i] = alert; persist() }
    }

    func delete(_ alert: StockAlert) {
        alerts.removeAll { $0.id == alert.id }
        persist()
    }

    func hasAlerts(for symbol: String) -> Bool {
        alerts.contains { $0.symbol == symbol.uppercased() && $0.enabled }
    }

    // MARK: - 通知權限

    func requestAuthorization() {
        // 要權限 + 註冊遠端推播(伺服器在 App 關閉時也能發)
        PushSync.shared.requestPermissionAndRegister()
    }

    private func notify(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let req = UNNotificationRequest(identifier: UUID().uuidString, content: content,
                                        trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false))
        UNUserNotificationCenter.current().add(req)
    }

    // MARK: - 評估(打開個股/刷新時呼叫)

    private let apiService = StockAPIService()

    /// 抓該股訊號,比對其啟用中的提醒,觸發則發通知並記錄(12 小時內不重複)。
    func evaluate(symbol: String, isZh: Bool) {
        let sym = symbol.uppercased()
        let mine = alerts(for: sym).filter { $0.enabled }
        guard !mine.isEmpty else { return }
        Task {
            for var a in mine {
                if let last = a.lastTriggered, Date().timeIntervalSince(last) < 12 * 3600 { continue }
                let period = (a.metric == .rsi || a.metric == .ma) ? (a.period ?? (a.metric == .ma ? 10 : 14)) : (a.metric == .vwap ? 20 : 14)
                let f = a.fastPeriod ?? 12, sl = a.slowPeriod ?? 26, sg = a.signalPeriod ?? 9
                guard let sig = try? await apiService.fetchSignals(symbol: sym, period: period, fast: f, slow: sl, signal: sg) else { continue }
                var hit = false
                var msg = ""
                switch a.metric {
                case .price:
                    if let p = sig.price {
                        hit = a.direction == .above ? (p >= a.target) : (p <= a.target)
                        if hit { msg = isZh ? "\(sym) 價格 \(fmt(p)) \(a.direction == .above ? "突破" : "跌破") \(fmt(a.target))"
                                            : "\(sym) price \(fmt(p)) \(a.direction == .above ? "rose above" : "fell below") \(fmt(a.target))" }
                    }
                case .rsi:
                    if let r = sig.rsi {
                        hit = a.direction == .above ? (r >= a.target) : (r <= a.target)
                        if hit { msg = isZh ? "\(sym) RSI \(Int(r)) \(a.direction == .above ? "高於" : "低於") \(Int(a.target))"
                                            : "\(sym) RSI \(Int(r)) \(a.direction == .above ? "above" : "below") \(Int(a.target))" }
                    }
                case .ma:
                    if let p = sig.price, let m = sig.ma {
                        hit = a.direction == .above ? (p >= m) : (p <= m)
                        if hit { msg = isZh ? "\(sym) 價格 \(fmt(p)) \(a.direction == .above ? "突破" : "跌破") MA(\(period)) \(fmt(m))"
                                            : "\(sym) price \(fmt(p)) \(a.direction == .above ? "above" : "below") MA(\(period)) \(fmt(m))" }
                    }
                case .vwap:
                    if let p = sig.price, let w = sig.vwap {
                        hit = a.direction == .above ? (p >= w) : (p <= w)
                        if hit { msg = isZh ? "\(sym) 價格 \(fmt(p)) \(a.direction == .above ? "高於" : "低於") VWAP \(fmt(w))"
                                            : "\(sym) price \(fmt(p)) \(a.direction == .above ? "above" : "below") VWAP \(fmt(w))" }
                    }
                case .macd:
                    if let m = sig.macd, let s = sig.macdSignal {
                        hit = a.direction == .above ? (m >= s) : (m <= s)
                        if hit { msg = isZh ? "\(sym) MACD \(a.direction == .above ? "黃金交叉(轉多)" : "死亡交叉(轉空)")"
                                            : "\(sym) MACD \(a.direction == .above ? "bullish cross" : "bearish cross")" }
                    }
                case .moneyOutflow:
                    if sig.moneyOutflow == true {
                        hit = true
                        msg = isZh ? "\(sym) 偵測到大戶出金(資金流出)" : "\(sym) big-money outflow detected"
                    }
                }
                if hit {
                    notify(title: isZh ? "📈 股價提醒" : "📈 Stock alert", body: msg)
                    a.lastTriggered = Date()
                    update(a)
                }
            }
        }
    }

    private func fmt(_ v: Double) -> String { String(format: "%.2f", v) }
}
