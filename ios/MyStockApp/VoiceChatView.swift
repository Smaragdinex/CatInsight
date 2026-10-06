import SwiftUI
import Speech
import AVFoundation
import Combine

/// 語音對話(像 ChatGPT 的語音模式):
/// 聽(SFSpeechRecognizer)→ 停頓約 1.3 秒自動送出 → AI 串流回覆 → 遇到標點就交給 AVSpeechSynthesizer 唸 → 唸完自動再聽。
/// 點中間的圓可以打斷 AI(或提早送出);右上角 X 離開。
struct VoiceChatView: View {
    let theme: AppTheme
    let isZh: Bool
    let symbol: String
    let history: [AIChatMessage]
    let watchlist: [String]
    /// 每完成一輪(使用者說的話, AI 回覆)就回呼,讓對話頁存起來。
    let onExchange: (String, String) -> Void
    let onClose: () -> Void

    @StateObject private var session = VoiceSession()

    var body: some View {
        ZStack {
            spotifyBlue.ignoresSafeArea()
            VStack(spacing: 20) {
                HStack {
                    Text(symbol.isEmpty ? (isZh ? "語音對話" : "Voice chat") : symbol)
                        .font(.headline).foregroundColor(.white.opacity(0.85))
                    Spacer()
                    Button {
                        session.stop()
                        onClose()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.headline).foregroundColor(.white)
                            .padding(10).background(Color.white.opacity(0.15)).clipShape(Circle())
                    }
                }
                .padding(.horizontal, 20).padding(.top, 8)

                Spacer()

                // 中間的圓:依狀態呼吸/脈動,點一下打斷或提早送出
                VoiceOrb(phase: session.phase, level: session.level, speakPulse: session.speakPulse, color: orbColor)
                    .frame(width: 360, height: 360)
                    .contentShape(Circle())
                    .onTapGesture { session.interrupt() }

                Text(statusText)
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(.white)

                Spacer()

                // 字幕:你說的 + AI 說的
                VStack(alignment: .leading, spacing: 10) {
                    if !session.transcript.isEmpty {
                        Text(session.transcript)
                            .font(.subheadline).foregroundColor(.white.opacity(0.75))
                            .frame(maxWidth: .infinity, alignment: .trailing)
                            .multilineTextAlignment(.trailing)
                    }
                    if !session.replyText.isEmpty {
                        ScrollView {
                            Text(session.replyText)
                                .font(.body).foregroundColor(.white)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .frame(maxHeight: 160)
                    }
                    if let err = session.errorText {
                        Text(err).font(.caption).foregroundColor(Color(red: 1, green: 0.75, blue: 0.75))
                    }
                }
                .padding(.horizontal, 24)

                Text(isZh ? "點圓圈可打斷 AI,講完停一下會自動送出" : "Tap the orb to interrupt · pause to send")
                    .font(.caption2).foregroundColor(.white.opacity(0.6))
                    .padding(.bottom, 24)
            }
        }
        .onAppear {
            session.configure(symbol: symbol, isZh: isZh, history: history, watchlist: watchlist, onExchange: onExchange)
            session.start()
            #if DEBUG
            if let sec = ProcessInfo.processInfo.environment["AUTO_INTERRUPT_AFTER"], let d = Double(sec) {   // 測試用:N 秒後模擬點圓圈
                DispatchQueue.main.asyncAfter(deadline: .now() + d) { session.interrupt() }
            }
            #endif
        }
        .onDisappear { session.stop() }
    }

    private let spotifyBlue = Color(red: 0.043, green: 0.055, blue: 0.09)   // 深色(和網頁版能量球頁同色 #0b0e17)

    private var orbColor: Color {
        switch session.phase {
        case .error: return .white.opacity(0.5)
        default: return Color(red: 0.55, green: 0.49, blue: 1)   // 紫(能量球主色)
        }
    }

    private var statusText: String {
        switch session.phase {
        case .idle: return isZh ? "準備中…" : "Getting ready…"
        case .listening: return isZh ? "聆聽中…" : "Listening…"
        case .thinking: return isZh ? "思考中…" : "Thinking…"
        case .speaking: return isZh ? "回答中(點一下打斷)" : "Speaking (tap to interrupt)"
        case .error: return isZh ? "出了點問題" : "Something went wrong"
        }
    }
}

/// 科技感能量球(和網頁版 /catinsight-3d 的「Talk to the AI」同款):
/// 藍紫粉漸層的半透明球體、內部流動的光線、青→粉邊緣光、左上高光、外圈三條像電流的環(抖動、發光、亮點繞行)。
/// 聆聽 / 思考 / 閒置:正圓、外圈是安靜的細環;AI 講話時球體不變形,改由外圈出現電流(毛邊抖動 + 亮段繞行),內部光線波動也加大。
private struct VoiceOrb: View {
    let phase: VoiceSession.Phase
    let level: CGFloat          // 麥克風音量 0~1
    let speakPulse: CGFloat     // 朗讀時每個字的脈衝 0~1
    let color: Color

    private let samples = 160
    private let bumpAngle: Double = -0.55   // 凹口固定在右上(螢幕座標 y 向下所以是負的)

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            Canvas { ctx, size in
                let c = CGPoint(x: size.width / 2, y: size.height / 2)
                let speaking = phase == .speaking
                let env: Double = speaking ? 0.45 + 0.55 * Double(speakPulse) : 0.12 + 0.08 * sin(t * 1.6)
                let r = min(size.width, size.height) * 0.27 * (1 + 0.03 * sin(t * 1.6) + (speaking ? 0.02 * Double(speakPulse) : 0))
                let dentDepth = 0.0                                          // 不內凹(使用者要求:講話時改用外圈電流表現)
                let spark = speaking ? 1.0 : 0.0                             // 講話時外圈才有電流通過(固定亮度、固定速度,不閃跳)
                let body = spherePath(center: c, r: r, dent: dentDepth)

                // 光暈
                let halo = Path(ellipseIn: CGRect(x: c.x - r * 1.8, y: c.y - r * 1.8, width: r * 3.6, height: r * 3.6))   // 不能超出畫布,否則邊緣變方
                ctx.fill(halo, with: .radialGradient(Gradient(stops: [
                    .init(color: Color(red: 0.35, green: 0.5, blue: 1).opacity(0.36), location: 0),
                    .init(color: Color(red: 0.47, green: 0.31, blue: 1).opacity(0.12), location: 0.5),
                    .init(color: .clear, location: 1)]), center: c, startRadius: r * 0.7, endRadius: r * 1.8))

                // 外圈電流環:抖動的環線 + 一段頭亮尾淡的電流沿環繞行 + 亮點
                // 三圈同方向、同速度(2.5 秒一圈)平穩繞 360°,但三道電流錯開 120°,各在不同位置轉
                let rings: [(k: Double, a: Double, spd: Double, col: Color, off: Double)] = [
                    (1.3, 0.55, 2.5, Color(red: 0.47, green: 0.78, blue: 1), 0),
                    (1.52, 0.38, 2.5, Color(red: 0.7, green: 0.55, blue: 1), 2 * .pi / 3),
                    (1.75, 0.25, 2.5, Color(red: 1, green: 0.55, blue: 0.94), 4 * .pi / 3),
                ]
                for ring in rings {
                    let rr = r * ring.k
                    let flick = speaking ? 1.0 : 0.6                          // 不閃爍
                    var p = Path()
                    for i in 0...140 {
                        let ang = Double(i) / 140 * 2 * .pi
                        // 不講話:平滑的細環;講話:環線有電流毛邊抖動
                        let jit = sin(ang * 9 + t * 2.0 + ring.off) * r * 0.008 * spark   // 講話時只有很輕、很慢的起伏,不抖
                        let pt = CGPoint(x: c.x + cos(ang) * (rr + jit), y: c.y + sin(ang) * (rr + jit) * 0.92)
                        i == 0 ? p.move(to: pt) : p.addLine(to: pt)
                    }
                    p.closeSubpath()
                    ctx.stroke(p, with: .color(ring.col.opacity(ring.a * flick * (speaking ? 0.55 : 0.35))), lineWidth: 1)
                    guard spark > 0 else { continue }                        // 沒講話就沒有電流繞行
                    let head = t * ring.spd + ring.off                        // 固定速度繞行
                    for sgm in 0..<4 {                                        // 拖尾約 90°,頭亮尾淡
                        let a0 = head - Double(sgm + 1) * 0.4, a1 = head - Double(sgm) * 0.4
                        var sp = Path()
                        for i in 0...12 {
                            let ang = a0 + (a1 - a0) * Double(i) / 12
                            let jit = sin(ang * 9 + t * 2.0 + ring.off) * r * 0.008
                            let pt = CGPoint(x: c.x + cos(ang) * (rr + jit), y: c.y + sin(ang) * (rr + jit) * 0.92)
                            i == 0 ? sp.move(to: pt) : sp.addLine(to: pt)
                        }
                        ctx.drawLayer { l in
                            l.addFilter(.shadow(color: ring.col, radius: 6))
                            l.stroke(sp, with: .color(ring.col.opacity(min(1, (ring.a + 0.35) * (1 - Double(sgm) * 0.24)))), style: StrokeStyle(lineWidth: 2.6 - Double(sgm) * 0.5, lineCap: .round))
                        }
                    }
                    let hp = CGPoint(x: c.x + cos(head) * rr, y: c.y + sin(head) * rr * 0.92)
                    ctx.drawLayer { l in
                        l.addFilter(.shadow(color: ring.col, radius: 8))
                        l.fill(Path(ellipseIn: CGRect(x: hp.x - 2.2, y: hp.y - 2.2, width: 4.4, height: 4.4)), with: .color(.white.opacity(0.85 * flick)))
                    }
                }

                // 球體本體(藍 → 紫 → 粉)
                ctx.fill(body, with: .radialGradient(Gradient(stops: [
                    .init(color: Color(red: 0.27, green: 0.35, blue: 0.9).opacity(0.85), location: 0),
                    .init(color: Color(red: 0.43, green: 0.24, blue: 0.82).opacity(0.9), location: 0.55),
                    .init(color: Color(red: 0.78, green: 0.35, blue: 0.9).opacity(0.92), location: 0.9),
                    .init(color: Color(red: 1, green: 0.47, blue: 0.92), location: 1)]),
                    center: CGPoint(x: c.x - r * 0.25, y: c.y - r * 0.25), startRadius: r * 0.05, endRadius: r))

                // 內部流動光線(裁在球內、加亮混合);說話時波動加大
                ctx.drawLayer { l in
                    l.clip(to: body)
                    l.blendMode = .plusLighter
                    for i in 0..<6 {
                        let ph = t * (0.9 + Double(i) * 0.18) + Double(i) * 1.3
                        let amp = r * (0.22 + 0.4 * env) * (0.6 + 0.4 * sin(Double(i) * 1.7 + t * 0.5))
                        let col = i % 2 == 1 ? Color(red: 1, green: 0.51, blue: 0.96) : Color(red: 0.47, green: 0.82, blue: 1)
                        var lp = Path()
                        var x = -r
                        var first = true
                        while x <= r + 1 {
                            let u = x / r
                            let y = sin(u * 2.4 + ph) * amp * cos(u * 0.8) + sin(u * 5 + ph * 1.6) * amp * 0.25 + sin(ph * 0.35 + Double(i)) * r * 0.28 * ((Double(i) - 2.5) / 2.5)
                            let pt = CGPoint(x: c.x + x, y: c.y + y)
                            first ? lp.move(to: pt) : lp.addLine(to: pt)
                            first = false
                            x += 5
                        }
                        l.drawLayer { g in
                            g.addFilter(.shadow(color: col.opacity(0.95), radius: 8))
                            g.stroke(lp, with: .color(col.opacity(0.5)), style: StrokeStyle(lineWidth: 1.2 + Double(i % 3) * 0.8, lineCap: .round))
                        }
                    }
                }

                // 邊緣光(青 → 粉)
                ctx.drawLayer { l in
                    l.blendMode = .plusLighter
                    l.addFilter(.shadow(color: Color(red: 0.6, green: 0.65, blue: 1).opacity(0.9), radius: 9))
                    l.stroke(body, with: .linearGradient(Gradient(colors: [Color(red: 0.47, green: 0.88, blue: 1).opacity(0.95), Color(red: 0.6, green: 0.47, blue: 1).opacity(0.3), Color(red: 1, green: 0.55, blue: 0.94).opacity(0.95)]),
                                                         startPoint: CGPoint(x: c.x - r, y: c.y - r), endPoint: CGPoint(x: c.x + r, y: c.y + r)), lineWidth: 2.2)
                }

                // 左上高光
                ctx.fill(body, with: .radialGradient(Gradient(colors: [.white.opacity(0.22), .clear]),
                                                     center: CGPoint(x: c.x - r * 0.35, y: c.y - r * 0.4), startRadius: 0, endRadius: r * 0.7))
            }
        }
    }

    /// 球體輪廓:正圓;講話時右上方往內凹(升餘弦缺口,兩側平滑接回圓)
    private func spherePath(center: CGPoint, r: CGFloat, dent depth: Double) -> Path {
        var path = Path()
        let halfWidth = 0.42 * Double.pi
        for i in 0...samples {
            let a = Double(i) / Double(samples) * 2 * .pi
            var rr = r
            if depth > 0 {
                let diff = atan2(sin(a - bumpAngle), cos(a - bumpAngle))
                let x = abs(diff) / halfWidth
                let d = x < 1 ? depth * 0.5 * (1 + cos(.pi * x)) : 0
                rr = r * CGFloat(1 - d)
            }
            let pnt = CGPoint(x: center.x + cos(a) * rr, y: center.y + sin(a) * rr)
            i == 0 ? path.move(to: pnt) : path.addLine(to: pnt)
        }
        path.closeSubpath()
        return path
    }
}

/// 語音對話的狀態機:麥克風 → 辨識 → 串流回覆 → 逐句朗讀 → 再聽。
@MainActor
final class VoiceSession: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    enum Phase { case idle, listening, thinking, speaking, error }

    @Published var phase: Phase = .idle
    @Published var transcript = ""     // 使用者正在說的
    @Published var replyText = ""      // 畫面上顯示的回覆(高音質模式:哪一句開始唸才顯示哪一句,字幕和聲音同步)
    private var fullReply = ""          // 完整回覆(串流全部收到的),存歷史用
    @Published var level: CGFloat = 0  // 麥克風音量(0~1),給圓圈動畫
    @Published var speakPulse: CGFloat = 0   // 朗讀節奏(0~1):每唸到一個字跳一下,然後衰減
    private var pulseDecayTimer: Timer?
    @Published var errorText: String?

    private var symbol = ""
    private var isZh = true
    private var history: [AIChatMessage] = []
    private var watchlist: [String] = []
    private var onExchange: (String, String) -> Void = { _, _ in }

    private let apiService = StockAPIService()
    private let audioEngine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let synth = AVSpeechSynthesizer()
    private lazy var hq = HQVoicePlayer(baseURL: apiService.baseURL)   // 高音質語音(後端 /tts),取不到就退回 synth
    private var silenceTimer: Timer?
    private var streamTask: Task<Void, Never>?
    private var pendingChunk = ""
    private var streamDone = false
    private var queuedUtterances = 0
    private var chunksThisTurn = 0        // 這一輪已送出的句子數(高音質模式:第一句切短,讓聲音早點出來)
    private var active = false
    private var lastUserText = ""

    private let silenceSeconds: TimeInterval = 1.3

    // 打斷偵測(AI 講話時麥克風持續開著)
    private var bargeInHot = 0            // 連續幾個 buffer 超過門檻
    private var bargeInFloor: Float = 0   // AI 講話時的背景音量(含殘餘回音),用移動平均估
    private var speakingSince: Date?      // 開始講話的時間,前 0.5 秒不判斷(TTS 起音)
    private var micMode: MicMode = .off
    private enum MicMode { case off, recognizing, bargeIn }

    override init() {
        super.init()
        synth.delegate = self
        hq.onItemFinished = { [weak self] in self?.utteranceFinished() }
        hq.onFallback = { [weak self] text in self?.speakWithDevice(text) }
        hq.onPulse = { [weak self] v in self?.speakPulse = v }
        hq.onItemStarted = { [weak self] text in
            guard let self else { return }
            self.replyText += (self.replyText.isEmpty ? "" : " ") + text
        }
        hq.onPlaybackStarted = { [weak self] in
            // 高音質音檔是網路回來才播:打斷偵測的「前 0.5 秒學背景音量」要從真正出聲那一刻重算,
            // 不然校正時是安靜的,一出聲喇叭漏進麥克風就被當成使用者開口而打斷(之前「沒有聲音」就是這樣)
            self?.bargeInFloor = 0
            self?.bargeInHot = 0
            self?.speakingSince = Date()
        }
    }

    func configure(symbol: String, isZh: Bool, history: [AIChatMessage], watchlist: [String], onExchange: @escaping (String, String) -> Void) {
        self.symbol = symbol
        self.isZh = isZh
        self.history = history
        self.watchlist = watchlist
        self.onExchange = onExchange
        recognizer = SFSpeechRecognizer(locale: Locale(identifier: isZh ? "zh-TW" : "en-US"))
    }

    // MARK: - 生命週期

    func start() {
        active = true
        errorText = nil
        #if DEBUG
        // 測試用:模擬器沒有麥克風,用環境變數直接丟一句話進去(xcrun simctl launch 帶 SIMCTL_CHILD_AUTO_VOICE_TEXT)
        if let text = ProcessInfo.processInfo.environment["AUTO_VOICE_TEXT"], !text.isEmpty {
            configureAudioSession()
            transcript = text
            send(text)
            return
        }
        #endif
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            Task { @MainActor in
                guard let self else { return }
                guard status == .authorized else {
                    self.fail(self.isZh ? "沒有語音辨識權限,請到設定開啟。" : "Speech recognition permission denied.")
                    return
                }
                AVAudioApplication.requestRecordPermission { granted in
                    Task { @MainActor in
                        guard granted else {
                            self.fail(self.isZh ? "沒有麥克風權限,請到設定開啟。" : "Microphone permission denied.")
                            return
                        }
                        self.configureAudioSession()
                        self.startListening()
                    }
                }
            }
        }
    }

    func stop() {
        active = false
        stopListening()
        streamTask?.cancel()
        streamTask = nil
        synth.stopSpeaking(at: .immediate)
        hq.stopAll()
        queuedUtterances = 0
        phase = .idle
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// 點圓圈:AI 在講就打斷並回到聆聽;正在聽且已有字就提早送出。
    func interrupt() {
        NSLog("[voice] interrupt in phase=\(phase)")
        switch phase {
        case .speaking, .thinking:
            micMode = .off
            speakingSince = nil
            streamTask?.cancel()
            streamTask = nil
            synth.stopSpeaking(at: .immediate)
            hq.stopAll()
            queuedUtterances = 0
            streamDone = true
            if !fullReply.isEmpty { commitExchange() }
            // 讓喇叭那顆 engine 先完全停掉、音訊 session 穩定,再重新開麥克風(之前點圓圈後偶爾麥克風起不來)
            stopListening()
            phase = .listening
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                guard let self, self.active, self.phase == .listening else { return }
                self.configureAudioSession()
                self.startListening()
            }
        case .listening:
            if !transcript.trimmingCharacters(in: .whitespaces).isEmpty { finalizeUtterance() }
        default:
            break
        }
    }

    private func fail(_ message: String) {
        errorText = message
        phase = .error
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        // voiceChat 模式有回音消除:AI 從喇叭講話時,麥克風收到的自己聲音會被壓掉,才能做「一開口就打斷」
        try? session.setCategory(.playAndRecord, mode: .voiceChat,
                                 options: [.defaultToSpeaker, .allowBluetoothHFP, .duckOthers])
        try? session.setActive(true)
    }

    // MARK: - 聽

    private func startListening() {
        guard active else { return }
        stopListening()
        transcript = ""
        replyText = ""
        fullReply = ""
        errorText = nil
        phase = .listening

        guard let recognizer, recognizer.isAvailable else {
            fail(isZh ? "語音辨識目前無法使用。" : "Speech recognition unavailable.")
            return
        }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.taskHint = .dictation
        request = req

        guard installMicTap(mode: .recognizing, request: req) else {
            NSLog("[voice] mic tap / engine start FAILED")
            fail(isZh ? "麥克風啟動失敗。" : "Could not start microphone.")
            return
        }
        NSLog("[voice] listening: engine running=\(audioEngine.isRunning) format=\(audioEngine.inputNode.outputFormat(forBus: 0))")

        recognitionTask = recognizer.recognitionTask(with: req) { [weak self] result, error in
            Task { @MainActor in
                guard let self, self.phase == .listening else { return }
                if let result {
                    let text = result.bestTranscription.formattedString
                    if text != self.transcript {
                        self.transcript = text
                        self.restartSilenceTimer()
                    }
                    if result.isFinal { self.finalizeUtterance() }
                } else if let error {
                    NSLog("[voice] recognition error: \(error.localizedDescription)")
                    // 辨識中斷(常見於長時間沒聲音):有字就送,沒字就重新聽
                    if !self.transcript.trimmingCharacters(in: .whitespaces).isEmpty { self.finalizeUtterance() }
                    else if self.active { self.startListening() }
                }
            }
        }
    }

    /// 麥克風 tap:辨識模式把聲音餵給 SFSpeech;打斷模式只量音量,超過門檻就打斷 AI。
    @discardableResult
    private func installMicTap(mode: MicMode, request req: SFSpeechAudioBufferRecognitionRequest?) -> Bool {
        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        micMode = mode
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            if mode == .recognizing { req?.append(buffer) }
            guard let ch = buffer.floatChannelData?[0] else { return }
            let n = Int(buffer.frameLength)
            var sum: Float = 0
            for i in stride(from: 0, to: n, by: 8) { sum += ch[i] * ch[i] }
            let rms = sqrt(sum / Float(max(n / 8, 1)))
            Task { @MainActor in
                guard let self, self.micMode == mode else { return }
                switch mode {
                case .recognizing:
                    let target = CGFloat(min(1, rms * 22))
                    // 上升快、下降慢,看起來比較順
                    self.level = target > self.level ? target : self.level * 0.82 + target * 0.18
                case .bargeIn:
                    self.evaluateBargeIn(rms: rms)
                case .off:
                    break
                }
            }
        }
        if !audioEngine.isRunning {
            audioEngine.prepare()
            do { try audioEngine.start() } catch { NSLog("[voice] audioEngine.start error: \(error.localizedDescription)"); return false }
        }
        return true
    }

    /// AI 講話時開麥克風只做打斷偵測(不辨識)。
    private func startBargeInMonitor() {
        guard VoicePrefs.bargeInEnabled else { return }
        bargeInHot = 0
        bargeInFloor = 0
        speakingSince = Date()
        installMicTap(mode: .bargeIn, request: nil)
    }

    /// 打斷判斷:音量要明顯高於「AI 講話時的背景」且連續約 0.25 秒,才算使用者開口。
    private func evaluateBargeIn(rms: Float) {
        guard phase == .speaking, let since = speakingSince else { return }
        // 前 0.5 秒先學背景音量(含喇叭殘餘回音),不判斷
        if Date().timeIntervalSince(since) < 0.5 {
            bargeInFloor = bargeInFloor == 0 ? rms : bargeInFloor * 0.8 + rms * 0.2
            return
        }
        bargeInFloor = bargeInFloor * 0.97 + rms * 0.03
        let threshold = max(0.02, bargeInFloor * 3.0)
        if rms > threshold {
            bargeInHot += 1
            // 1024 frames ≈ 21ms @48kHz;12 個 ≈ 0.25 秒
            if bargeInHot >= 12 {
                bargeInHot = 0
                NSLog("[voice] barge-in triggered rms=%.3f floor=%.3f", rms, bargeInFloor)
                interrupt()
            }
        } else {
            bargeInHot = max(0, bargeInHot - 2)
        }
    }

    /// 只停辨識、不關麥克風(講話時切到打斷偵測用)。
    private func stopRecognitionOnly() {
        silenceTimer?.invalidate()
        silenceTimer = nil
        recognitionTask?.cancel()
        recognitionTask = nil
        request?.endAudio()
        request = nil
        level = 0
    }

    private func restartSilenceTimer() {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: silenceSeconds, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.finalizeUtterance() }
        }
    }

    private func stopListening() {
        silenceTimer?.invalidate()
        silenceTimer = nil
        recognitionTask?.cancel()
        recognitionTask = nil
        request?.endAudio()
        request = nil
        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)
        audioEngine.reset()
        micMode = .off
        level = 0
    }

    private func finalizeUtterance() {
        guard phase == .listening else { return }
        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        stopListening()
        send(text)
    }

    // MARK: - 問 AI(串流)+ 逐句朗讀

    private func send(_ text: String) {
        lastUserText = text
        history.append(AIChatMessage(role: "user", content: text))
        replyText = ""
        fullReply = ""
        pendingChunk = ""
        streamDone = false
        queuedUtterances = 0
        chunksThisTurn = 0
        phase = .thinking

        let payload = history
        streamTask = Task { [weak self] in
            guard let self else { return }
            do {
                let stream = self.apiService.streamAIChat(symbol: self.symbol, languageCode: self.isZh ? "zh" : "en",
                                                          messages: payload, watchlist: self.watchlist, voice: true)
                for try await delta in stream {
                    if Task.isCancelled { return }
                    await MainActor.run {
                        self.fullReply += delta
                        if !VoicePrefs.hqEnabled { self.replyText += delta }   // 高音質模式:等那句開始唸才顯示
                        self.pendingChunk += delta
                        self.flushChunk(force: false)
                    }
                }
                await MainActor.run {
                    self.streamDone = true
                    self.flushChunk(force: true)
                    if self.queuedUtterances == 0 { self.finishTurn() }
                }
            } catch {
                if Task.isCancelled { return }
                await MainActor.run {
                    self.streamDone = true
                    if self.fullReply.isEmpty {
                        let msg = self.isZh ? "抱歉,我剛剛沒有連上,再說一次好嗎?" : "Sorry, I lost the connection. Could you say that again?"
                        self.fullReply = msg
                        if !VoicePrefs.hqEnabled { self.replyText = msg }
                        self.speak(msg)
                    } else {
                        self.flushChunk(force: true)
                        if self.queuedUtterances == 0 { self.finishTurn() }
                    }
                }
            }
        }
    }

    /// 累積到句尾標點(或太長)就交給合成器唸,不等整段生成完。
    private func flushChunk(force: Bool) {
        let text = pendingChunk
        guard !text.isEmpty else { return }
        if force {
            pendingChunk = ""
            speak(text)
            return
        }
        let hardStops: Set<Character> = ["。", "！", "？", "!", "?", "\n"]
        let softStops: Set<Character> = ["，", ",", "；", ";", "、", ":", "："]
        // 高音質模式:後端生成一句約要等它「音長的一倍」時間,所以第一句切得很短(逗號就切、≥6 字)讓聲音早點出來,
        // 之後的句子維持正常長度;沒有標點時的硬上限也縮短
        let hq = VoicePrefs.hqEnabled
        let softMin = hq ? (chunksThisTurn == 0 ? 6 : 14) : 14
        let hardMax = hq ? (chunksThisTurn == 0 ? 24 : 40) : 60
        var cut: String.Index? = nil
        for (i, ch) in zip(text.indices, text) {
            if hardStops.contains(ch) { cut = text.index(after: i) }
            else if softStops.contains(ch), text.distance(from: text.startIndex, to: i) >= softMin { cut = text.index(after: i) }
            if cut != nil, hq, chunksThisTurn == 0 { break }      // 第一句:遇到第一個切點就送,不要等更長的
        }
        if cut == nil, text.count >= hardMax { cut = text.endIndex }
        guard let cut else { return }
        let piece = String(text[text.startIndex..<cut]).trimmingCharacters(in: .whitespacesAndNewlines)
        pendingChunk = String(text[cut...])
        if !piece.isEmpty { speak(piece) }
    }

    private func speak(_ piece: String) {
        // 唸的時候停掉辨識(不然會把自己的聲音辨識進去),但麥克風留著做「一開口就打斷」
        if phase != .speaking {
            if micMode == .recognizing { stopRecognitionOnly() }
            startBargeInMonitor()
        }
        phase = .speaking
        queuedUtterances += 1
        chunksThisTurn += 1
        if VoicePrefs.hqEnabled {
            if !hq.isBusy { speakingSince = nil }              // 還沒出聲前不做打斷判斷(等 onPlaybackStarted)
            // 依使用者選的語言挑聲音:中文 → CosyVoice 官方女聲、英文 → Kokoro Heart(伺服器若發現內容語言不符會自動換)
            hq.enqueue(piece, speed: VoicePrefs.hqSpeed, first: chunksThisTurn == 1, voice: isZh ? "zh-official" : "en-heart")
        } else {
            speakWithDevice(piece)
        }
    }

    /// 手機內建 TTS(高音質關閉、或後端取不到時用)
    private func speakWithDevice(_ piece: String) {
        if VoicePrefs.hqEnabled, !replyText.hasSuffix(piece) { replyText += (replyText.isEmpty ? "" : " ") + piece }   // 退回內建聲音時字幕也要出來
        let hasCJK = piece.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF }
        let utterance = AVSpeechUtterance(string: piece)
        utterance.voice = VoicePrefs.voice(forCJK: hasCJK)   // 設定 → 語音聲音 選的
        utterance.rate = VoicePrefs.rate
        utterance.prefersAssistiveTechnologySettings = false
        synth.speak(utterance)
    }

    /// 一句唸完(不管是高音質還是內建):數量歸零且串流結束就換回聆聽
    private func utteranceFinished() {
        queuedUtterances = max(0, queuedUtterances - 1)
        if queuedUtterances == 0 && streamDone && phase == .speaking {
            finishTurn()
        }
    }

    private func finishTurn() {
        commitExchange()
        if active { startListening() }
    }

    private func commitExchange() {
        let reply = fullReply.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !lastUserText.isEmpty, !reply.isEmpty else { return }
        history.append(AIChatMessage(role: "assistant", content: reply))
        onExchange(lastUserText, reply)
        lastUserText = ""
    }

    // MARK: - AVSpeechSynthesizerDelegate

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.utteranceFinished() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString characterRange: NSRange, utterance: AVSpeechUtterance) {
        Task { @MainActor in
            // 字越長脈衝越大;之後每 50ms 衰減
            self.speakPulse = min(1, 0.55 + CGFloat(characterRange.length) * 0.08)
            self.pulseDecayTimer?.invalidate()
            self.pulseDecayTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] timer in
                Task { @MainActor in
                    guard let self else { timer.invalidate(); return }
                    self.speakPulse = max(0, self.speakPulse - 0.12)
                    if self.speakPulse <= 0 { timer.invalidate() }
                }
            }
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.queuedUtterances = max(0, self.queuedUtterances - 1) }
    }
}
