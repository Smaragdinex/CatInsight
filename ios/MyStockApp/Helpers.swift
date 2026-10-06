import Foundation

extension UserDefaults {
    func codableArray<T: Codable>(forKey key: String, as type: T.Type) -> [T] {
        guard let data = data(forKey: key),
              let decoded = try? JSONDecoder().decode([T].self, from: data) else {
            return []
        }
        return decoded
    }

    func setCodableArray<T: Codable>(_ value: [T], forKey key: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        set(data, forKey: key)
    }

    func codableValue<T: Codable>(forKey key: String, as type: T.Type) -> T? {
        guard let data = data(forKey: key),
              let decoded = try? JSONDecoder().decode(T.self, from: data) else {
            return nil
        }
        return decoded
    }

    func setCodableValue<T: Codable>(_ value: T, forKey key: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        set(data, forKey: key)
    }
}

nonisolated enum StockDateParser {
    private static let isoFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let isoBasic: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private static let fullFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ssZ"
        return formatter
    }()

    private static let fullFormatterNoZone: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter
    }()

    private static let minuteFormatterNoZone: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter
    }()

    private static let dateOnlyFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func parse(_ raw: String) -> Date? {
        if let date = isoFractional.date(from: raw) { return date }
        if let date = isoBasic.date(from: raw) { return date }

        let normalized = raw.replacingOccurrences(of: "T", with: " ")
        if let date = fullFormatter.date(from: normalized) { return date }
        if let date = fullFormatterNoZone.date(from: normalized) { return date }
        if let date = minuteFormatterNoZone.date(from: normalized) { return date }

        let dateOnly = String(raw.prefix(10))
        return dateOnlyFormatter.date(from: dateOnly)
    }
}
