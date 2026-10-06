import Foundation
import StoreKit
import SwiftUI

/// 在使用者剛完成一件開心的事之後,適時請他評分(走 Apple 官方的 requestReview)。
/// Apple 本身一年最多只會真的跳 3 次,這裡再自己把關:
/// - 安裝滿 2 天才會問
/// - 每 60 天最多問一次
/// - 只在「好時機」問:加到第 3 支自選股、第 2 次收到 AI 回覆、第 5 次打開個股頁
enum ReviewPrompter {
    enum Moment { case watchlistAdded(count: Int), aiReplied, detailOpened }

    private static let firstLaunchKey = "review.firstLaunch"
    private static let lastPromptKey = "review.lastPrompt"
    private static let aiReplyCountKey = "review.aiReplyCount"
    private static let detailOpenCountKey = "review.detailOpenCount"

    private static let minDaysSinceInstall: TimeInterval = 2
    private static let minDaysBetweenPrompts: TimeInterval = 60

    static func noteFirstLaunchIfNeeded() {
        let d = UserDefaults.standard
        if d.object(forKey: firstLaunchKey) == nil { d.set(Date(), forKey: firstLaunchKey) }
    }

    /// 記錄事件;回傳 true 表示「現在是好時機,可以問」。呼叫端拿到 true 再去 requestReview。
    static func shouldPrompt(after moment: Moment) -> Bool {
        let d = UserDefaults.standard
        noteFirstLaunchIfNeeded()

        let isGoodMoment: Bool
        switch moment {
        case .watchlistAdded(let count):
            isGoodMoment = count == 3
        case .aiReplied:
            let n = d.integer(forKey: aiReplyCountKey) + 1
            d.set(n, forKey: aiReplyCountKey)
            isGoodMoment = n == 2
        case .detailOpened:
            let n = d.integer(forKey: detailOpenCountKey) + 1
            d.set(n, forKey: detailOpenCountKey)
            isGoodMoment = n == 5
        }
        guard isGoodMoment else { return false }

        let day: TimeInterval = 86_400
        if let first = d.object(forKey: firstLaunchKey) as? Date,
           Date().timeIntervalSince(first) < minDaysSinceInstall * day {
            #if DEBUG
            return true   // 開發時方便看到對話框
            #else
            return false
            #endif
        }
        if let last = d.object(forKey: lastPromptKey) as? Date,
           Date().timeIntervalSince(last) < minDaysBetweenPrompts * day {
            return false
        }
        d.set(Date(), forKey: lastPromptKey)
        return true
    }
}

/// 給 SwiftUI 用:`@Environment(\.requestReview)` 只能在 View 裡拿,所以包一個 modifier 監聽觸發。
struct ReviewPromptModifier: ViewModifier {
    @Binding var trigger: Int
    @Environment(\.requestReview) private var requestReview

    func body(content: Content) -> some View {
        content.onChange(of: trigger) { _, _ in
            // 等畫面安定 1.5 秒再跳,不要跟動畫打架
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { requestReview() }
        }
    }
}

extension View {
    func reviewPrompt(trigger: Binding<Int>) -> some View { modifier(ReviewPromptModifier(trigger: trigger)) }
}
