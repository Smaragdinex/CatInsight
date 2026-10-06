import Foundation
import SwiftUI
import Combine

/// 本機儲存 AI 對話(UserDefaults + Codable)。每位使用者的對話只存在自己手機上。
@MainActor
final class ChatStore: ObservableObject {
    static let shared = ChatStore()

    @Published private(set) var chats: [SavedChat] = []
    private let key = "ai.chats.v1"

    init() { load() }

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: key) else { return }
        if let decoded = try? JSONDecoder().decode([SavedChat].self, from: data) {
            chats = decoded.sorted { $0.date > $1.date }
        }
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(chats) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    /// 新增或更新一段對話(以 id 為準),最新的排在最前。
    func upsert(_ chat: SavedChat) {
        if let idx = chats.firstIndex(where: { $0.id == chat.id }) {
            chats[idx] = chat
        } else {
            chats.append(chat)
        }
        chats.sort { $0.date > $1.date }
        persist()
    }

    func delete(_ chat: SavedChat) {
        chats.removeAll { $0.id == chat.id }
        persist()
    }

    func delete(at offsets: IndexSet) {
        chats.remove(atOffsets: offsets)
        persist()
    }

    func clearAll() {
        chats.removeAll()
        persist()
    }
}
