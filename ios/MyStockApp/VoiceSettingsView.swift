import SwiftUI
import AVFoundation
import Combine

/// 語音對話用的聲音偏好(存 UserDefaults):中文聲音、英文聲音、語速。
enum VoicePrefs {
    static let zhKey = "voice.zh.identifier"
    static let enKey = "voice.en.identifier"
    static let rateKey = "voice.rate"   // "slow" / "normal" / "fast"
    static let bargeInKey = "voice.bargeIn"   // AI 講話時一開口就打斷(預設開)
    static let hqKey = "voice.hq"             // 高音質語音(後端 /tts:英文 Kokoro、中文貓咪助理複製聲音),預設開;離線自動退回內建

    /// 高音質語音一律開(2026-09-27 拿掉開關與聲音挑選:依 App 語言自動用中文貓咪助理 / 英文 Heart,離線才退回內建)
    static var hqEnabled: Bool { true }

    /// 給後端 /tts 的語速倍率(對應 rate 設定)
    static var hqSpeed: Float {
        switch UserDefaults.standard.string(forKey: rateKey) ?? "normal" {
        case "slow": return 0.88
        case "fast": return 1.15
        default: return 1.0
        }
    }

    static var bargeInEnabled: Bool {
        UserDefaults.standard.object(forKey: bargeInKey) == nil ? true : UserDefaults.standard.bool(forKey: bargeInKey)
    }

    /// 依內容語言挑聲音:有使用者選的就用,否則系統預設。
    static func voice(forCJK isCJK: Bool) -> AVSpeechSynthesisVoice? {
        let key = isCJK ? zhKey : enKey
        if let id = UserDefaults.standard.string(forKey: key), let v = AVSpeechSynthesisVoice(identifier: id) {
            return v
        }
        return AVSpeechSynthesisVoice(language: isCJK ? "zh-TW" : "en-US")
    }

    static var rate: Float {
        switch UserDefaults.standard.string(forKey: rateKey) ?? "normal" {
        case "slow": return AVSpeechUtteranceDefaultSpeechRate * 0.88
        case "fast": return AVSpeechUtteranceDefaultSpeechRate * 1.15
        default: return AVSpeechUtteranceDefaultSpeechRate
        }
    }
}

/// 設定 → 語音聲音:列出手機上所有中文/英文聲音,可試聽、選擇,並調語速。
struct VoiceSettingsView: View {
    let theme: AppTheme
    let isZh: Bool

    @AppStorage(VoicePrefs.rateKey) private var rateRaw: String = "normal"
    @AppStorage(VoicePrefs.bargeInKey) private var bargeIn: Bool = true

    @StateObject private var previewer = VoicePreviewer()

    private var zhVoices: [AVSpeechSynthesisVoice] {
        AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.hasPrefix("zh") }
            .sorted { a, b in
                // zh-TW 優先,再依品質高→低,再名稱
                let la = a.language == "zh-TW" ? 0 : 1, lb = b.language == "zh-TW" ? 0 : 1
                if la != lb { return la < lb }
                if a.quality != b.quality { return a.quality.rawValue > b.quality.rawValue }
                return a.name < b.name
            }
    }

    /// 英文只列這幾個(使用者指定):Samantha 排最前,其餘照這個順序;同名的增強版/高品質版也一起列。
    private static let allowedEnglishNames = ["Samantha", "Daniel", "Karen", "Moira", "Rishi", "Tessa"]

    private var enVoices: [AVSpeechSynthesisVoice] {
        AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.hasPrefix("en") && Self.allowedEnglishNames.contains($0.name) }
            .sorted { a, b in
                let ia = Self.allowedEnglishNames.firstIndex(of: a.name) ?? 99
                let ib = Self.allowedEnglishNames.firstIndex(of: b.name) ?? 99
                if ia != ib { return ia < ib }
                return a.quality.rawValue > b.quality.rawValue
            }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(isZh ? "語音" : "Voice")
                    .font(.title3).fontWeight(.bold).foregroundColor(theme.primaryText)
                Text(isZh ? "AI 的聲音會跟著 App 語言自動切換:中文用貓咪助理、英文用 Heart,由伺服器生成。離線時改用手機內建聲音。"
                          : "The AI's voice follows the app language: the CatInsight assistant for Chinese and Heart for English, generated on our server. Falls back to the phone's built-in voice when offline.")
                    .font(.caption).foregroundColor(theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)

                // 語速
                sectionTitle(isZh ? "語速" : "Speed")
                HStack(spacing: 8) {
                    ForEach([("slow", isZh ? "慢" : "Slow"), ("normal", isZh ? "正常" : "Normal"), ("fast", isZh ? "快" : "Fast")], id: \.0) { key, label in
                        Button {
                            rateRaw = key
                            previewer.play(isZh ? "這是語速試聽。" : "This is a speed preview.", voice: VoicePrefs.voice(forCJK: isZh), rate: VoicePrefs.rate)
                        } label: {
                            Text(label)
                                .font(.subheadline.weight(.semibold))
                                .foregroundColor(rateRaw == key ? .white : theme.primaryText)
                                .frame(maxWidth: .infinity).padding(.vertical, 10)
                                .background(rateRaw == key ? Color.blue : theme.cardBackground)
                                .cornerRadius(12)
                                .overlay(RoundedRectangle(cornerRadius: 12).stroke(rateRaw == key ? Color.blue : theme.divider, lineWidth: 1))
                        }
                    }
                }

                sectionTitle(isZh ? "打斷" : "Interrupt")
                Toggle(isOn: $bargeIn) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(isZh ? "一開口就打斷 AI" : "Speak to interrupt")
                            .fontWeight(.semibold).foregroundColor(theme.primaryText)
                        Text(isZh ? "AI 回答時你直接講話,它會停下來聽。關掉的話要點圓圈才能打斷。"
                                  : "Start talking while the AI speaks and it stops to listen. If off, tap the orb to interrupt.")
                            .font(.caption).foregroundColor(theme.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .tint(.blue)
                .padding(12)
                .background(theme.cardBackground)
                .cornerRadius(14)
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(theme.divider, lineWidth: 1))

            }
            .padding(.bottom, 24)
        }
        .onDisappear { previewer.stop() }
    }

    private func sectionTitle(_ s: String) -> some View {
        Text(s).font(.subheadline.weight(.semibold)).foregroundColor(theme.secondaryText).padding(.top, 6)
    }

    private func voiceRow(_ v: AVSpeechSynthesisVoice, selected: Bool, sample: String, onSelect: @escaping () -> Void) -> some View {
        HStack(spacing: 10) {
            // 試聽
            Button {
                previewer.play(sample, voice: v, rate: VoicePrefs.rate)
            } label: {
                Image(systemName: previewer.playingID == v.identifier ? "stop.circle.fill" : "play.circle.fill")
                    .font(.system(size: 28)).foregroundColor(.blue)
            }
            .buttonStyle(.plain)

            Button(action: onSelect) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(v.name).fontWeight(.semibold).foregroundColor(theme.primaryText)
                        Text(subtitle(for: v)).font(.caption).foregroundColor(theme.secondaryText)
                    }
                    Spacer()
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .font(.title3).foregroundColor(selected ? .blue : theme.secondaryText)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .background(theme.cardBackground)
        .cornerRadius(14)
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(selected ? Color.blue : theme.divider, lineWidth: 1))
    }

    private func subtitle(for v: AVSpeechSynthesisVoice) -> String {
        var parts: [String] = [v.language]
        switch v.gender {
        case .female: parts.append(isZh ? "女聲" : "Female")
        case .male: parts.append(isZh ? "男聲" : "Male")
        default: break
        }
        switch v.quality {
        case .premium: parts.append(isZh ? "高品質" : "Premium")
        case .enhanced: parts.append(isZh ? "增強版" : "Enhanced")
        default: parts.append(isZh ? "標準" : "Standard")
        }
        return parts.joined(separator: " · ")
    }
}

/// 試聽用的合成器(同時只放一個)。
@MainActor
final class VoicePreviewer: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    @Published var playingID: String? = nil
    private let synth = AVSpeechSynthesizer()

    override init() {
        super.init()
        synth.delegate = self
    }

    func play(_ text: String, voice: AVSpeechSynthesisVoice?, rate: Float) {
        if synth.isSpeaking {
            let wasPlaying = playingID
            synth.stopSpeaking(at: .immediate)
            playingID = nil
            if wasPlaying == voice?.identifier { return }   // 再按一次 = 停止
        }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        let u = AVSpeechUtterance(string: text)
        u.voice = voice
        u.rate = rate
        playingID = voice?.identifier
        synth.speak(u)
    }

    func stop() {
        synth.stopSpeaking(at: .immediate)
        playingID = nil
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.playingID = nil }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.playingID = nil }
    }
}
