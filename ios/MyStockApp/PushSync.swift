import Foundation
import UIKit
import UserNotifications
import Combine

/// 推播:拿到 APNs 裝置 token 後註冊到後端,並把提醒與自選同步上去,讓伺服器在 App 關閉時也能發通知。
@MainActor
final class PushSync: NSObject, ObservableObject {
    static let shared = PushSync()

    private let tokenKey = "push.deviceToken"
    private let apiService = StockAPIService()
    private var syncTask: Task<Void, Never>?

    /// 使用者點通知進來時要打開的股票(ContentView 監聽)
    @Published var pendingSymbol: String?

    var deviceToken: String? { UserDefaults.standard.string(forKey: tokenKey) }

    /// 要通知權限;拿到後向系統註冊遠端推播(token 由 AppDelegate 回來)。
    func requestPermissionAndRegister() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            Task { @MainActor in UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    func didReceive(deviceToken data: Data) {
        let token = data.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(token, forKey: tokenKey)
        let lang = UserDefaults.standard.string(forKey: "selectedLanguage") ?? "zh"
        NSLog("PushSync: got APNs token %@…", String(token.prefix(12)))
        Task {
            do {
                try await apiService.registerPush(token: token, languageCode: lang)
                NSLog("PushSync: registered with backend")
            } catch {
                NSLog("PushSync: register failed: %@", error.localizedDescription)
            }
            await MainActor.run { self.syncAlerts() }
        }
    }

    /// 把目前所有提醒 + 自選代碼送到後端(整組覆蓋)。提醒/自選有變就呼叫;合併 1 秒內的連續呼叫。
    func syncAlerts() {
        guard let token = deviceToken else { return }
        syncTask?.cancel()
        syncTask = Task {
            try? await Task.sleep(for: .seconds(1))
            if Task.isCancelled { return }
            let alerts = AlertCenter.shared.alerts
            let watchlist = UserDefaults.standard.codableArray(forKey: "watchlist.items", as: WatchlistItem.self).map(\.symbol)
            do {
                try await apiService.syncPushAlerts(token: token, alerts: alerts, watchlist: watchlist)
                NSLog("PushSync: synced %d alerts, %d watchlist", alerts.count, watchlist.count)
            } catch {
                NSLog("PushSync: sync failed: %@", error.localizedDescription)
            }
        }
    }
}

/// 接 APNs token 與通知點擊。
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // 之前已授權過的話,啟動就重新註冊(token 可能會換)
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            NSLog("PushSync: notification auth status = %d", settings.authorizationStatus.rawValue)
            if settings.authorizationStatus == .authorized {
                Task { @MainActor in UIApplication.shared.registerForRemoteNotifications() }
            }
        }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in PushSync.shared.didReceive(deviceToken: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NSLog("PushSync: APNs register failed: %@", error.localizedDescription)
    }

    // App 在前景時也顯示橫幅
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    // 點通知 → 打開該股
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        if let sym = response.notification.request.content.userInfo["symbol"] as? String, !sym.isEmpty {
            await MainActor.run { PushSync.shared.pendingSymbol = sym.uppercased() }
        }
    }
}
