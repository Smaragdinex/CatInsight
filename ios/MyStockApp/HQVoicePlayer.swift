import Foundation
import AVFoundation

/// 高音質語音(串流版):每一句文字送到後端 `/tts/stream`,伺服器邊生成邊送 raw PCM16 mono 24kHz,
/// 這裡用 AVAudioEngine + AVAudioPlayerNode 邊收邊播,首句約 1~2 秒就出聲;多句依序接著播,不留空檔。
/// 拿不到(離線、逾時、5xx)就呼叫 onFallback,讓 VoiceSession 用手機內建聲音唸那一句。
@MainActor
final class HQVoicePlayer: NSObject {
    var onItemFinished: (() -> Void)?        // 每句結束(播完或失敗跳過)
    var onFallback: ((String) -> Void)?      // 這句拿不到高音質音檔,請改用內建 TTS
    var onPulse: ((CGFloat) -> Void)?        // 播放中的音量(0~1),給圓圈動畫
    var onPlaybackStarted: (() -> Void)?     // 真的開始出聲(打斷偵測的背景校正從這一刻算)
    var onItemStarted: ((String) -> Void)?   // 某一句開始出聲(字幕跟著這一刻顯示,和聲音同步)

    private final class Item {
        let id = UUID(); let text: String
        var pending = Data()                 // 收到但還沒排進播放的 bytes
        var scheduledFrames = 0              // 已排進 player node 的 frame 數
        var playedFrames = 0                 // 已播完的 frame 數
        var downloadDone = false
        var failed = false
        var notified = false
        var task: URLSessionDataTask?
        let first: Bool                      // 這一輪的第一句:用 stream 模式(首段最快);其他句用 whole(吞吐較好)
        let speed: Float
        let voice: String                    // 依 App 語言:中文 zh-official、英文 en-heart
        init(text: String, first: Bool, speed: Float, voice: String) { self.text = text; self.first = first; self.speed = speed; self.voice = voice }
    }

    private let baseURL: String
    private let sampleRate: Double = 24000
    private let engine = AVAudioEngine()
    private let node = AVAudioPlayerNode()
    private lazy var format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false)!
    private var queue: [Item] = []           // 依序;queue[0] 是正在排播的那句(後面的同時在下載)
    private var generation = 0               // stopAll 後遞增,舊的網路回應就丟掉
    private var started = false              // 這一輪已經出過聲(onPlaybackStarted 只叫一次)
    private lazy var session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 30        // 30 秒沒有任何資料才算失敗(串流中間會一直有資料)
        cfg.timeoutIntervalForResource = 120
        return URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }()
    private var itemsByTask: [Int: Item] = [:]

    init(baseURL: String) {
        self.baseURL = baseURL
        super.init()
        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: format)
        engine.mainMixerNode.outputVolume = 1.0
        node.volume = 1.0
        // 播放中的音量 → 圓圈脈衝
        node.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buf, _ in
            guard let ch = buf.floatChannelData?[0] else { return }
            let n = Int(buf.frameLength); var sum: Float = 0
            for i in 0..<n { sum += ch[i] * ch[i] }
            let rms = n > 0 ? sqrt(sum / Float(n)) : 0
            let v = CGFloat(min(1, rms * 6))
            Task { @MainActor in self?.onPulse?(v) }
        }
    }

    var isBusy: Bool { !queue.isEmpty }

    func enqueue(_ text: String, speed: Float, first: Bool = false, voice: String = "auto") {
        queue.append(Item(text: text, first: first, speed: speed, voice: voice))
        pumpDownloads()
    }

    /// 一次只讓一句在下載:第 1 句先拿到伺服器(伺服器一次只算一句,同時丟 6 句會亂序,第 1 句反而等最久);
    /// 前一句下載完(不用等播完)就開始下一句,讓後面的句子在前一句播放時先算好
    private func pumpDownloads() {
        guard !queue.contains(where: { $0.task != nil && !$0.downloadDone && !$0.failed }) else { return }
        guard let next = queue.first(where: { $0.task == nil && !$0.failed }) else { return }
        guard let url = URL(string: baseURL + "/tts/stream") else { next.failed = true; drain(); return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["text": next.text, "voice": next.voice, "speed": next.speed, "mode": next.first ? "stream" : "whole"])
        let task = session.dataTask(with: req)
        next.task = task
        itemsByTask[task.taskIdentifier] = next
        task.resume()
    }

    func stopAll() {
        generation += 1
        for it in queue { it.task?.cancel() }
        queue.removeAll(); itemsByTask.removeAll()
        node.stop()
        if engine.isRunning { engine.stop() }              // 完全停掉(不是 pause),把音訊 IO 讓給麥克風那顆 engine
        engine.reset()
        started = false
        onPulse?(0)
    }

    // MARK: - 排播

    /// 把 queue[0] 收到的資料切成 0.2 秒一塊排進 player node;它下載完就換下一句
    private func drain() {
        guard let head = queue.first else { return }
        if head.failed {
            queue.removeFirst()
            onFallback?(head.text)                        // VoiceSession 用內建聲音唸,唸完會自己回報 finished
            drain(); return
        }
        let chunkBytes = Int(sampleRate * 0.2) * 2        // 0.2 秒 PCM16
        while head.pending.count >= chunkBytes || (head.downloadDone && head.pending.count >= 2) {
            let take = head.downloadDone ? (head.pending.count / 2) * 2 : chunkBytes
            let bytes = head.pending.prefix(take); head.pending.removeFirst(take)
            schedule(bytes, for: head)
        }
        if head.downloadDone && head.pending.count < 2 {
            queue.removeFirst()                            // 這句全排進去了(不一定播完),接著排下一句
            checkFinished(head)
            drain()
        }
    }

    private func schedule(_ bytes: Data, for item: Item) {
        let frames = bytes.count / 2
        guard frames > 0, let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)) else { return }
        buf.frameLength = AVAudioFrameCount(frames)
        let dst = buf.floatChannelData![0]
        bytes.withUnsafeBytes { raw in
            let src = raw.bindMemory(to: Int16.self)
            for i in 0..<frames { dst[i] = Float(src[i]) / 32768 }
        }
        if !engine.isRunning { try? engine.start() }
        if !node.isPlaying { node.play() }
        if !started { started = true; onPlaybackStarted?() }
        if item.scheduledFrames == 0 { onItemStarted?(item.text) }
        item.scheduledFrames += frames
        let gen = generation
        node.scheduleBuffer(buf, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            Task { @MainActor in
                guard let self, gen == self.generation else { return }
                item.playedFrames += frames
                self.checkFinished(item)
            }
        }
    }

    private func checkFinished(_ item: Item) {
        guard !item.notified, item.downloadDone, item.playedFrames >= item.scheduledFrames else { return }
        item.notified = true
        onItemFinished?()
        if queue.isEmpty { onPulse?(0) }
    }

    // MARK: - 網路回應(delegate 在背景 queue,轉回 main)

    private func onData(taskID: Int, data: Data) {
        guard let item = itemsByTask[taskID] else { return }
        item.pending.append(data)
        if queue.first === item { drain() }
    }

    private func onComplete(taskID: Int, error: Error?, status: Int) {
        guard let item = itemsByTask.removeValue(forKey: taskID) else { return }
        let gotAny = item.scheduledFrames > 0 || item.pending.count >= 2
        if error != nil || status != 200 || !gotAny {
            NSLog("[hq-tts] stream failed status=\(status) err=\(error?.localizedDescription ?? "-") got=\(gotAny) \"\(item.text.prefix(24))\"")
            if gotAny { item.downloadDone = true } else { item.failed = true }
        } else {
            item.downloadDone = true
            NSLog("[hq-tts] stream done \(String(format: "%.1f", Double(item.scheduledFrames + item.pending.count / 2) / sampleRate))s \"\(item.text.prefix(24))\"")
        }
        if queue.first === item { drain() }
        pumpDownloads()                                     // 這句下載完了 → 開始下一句
    }
}

extension HQVoicePlayer: URLSessionDataDelegate {
    nonisolated func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        let id = dataTask.taskIdentifier
        Task { @MainActor in self.onData(taskID: id, data: data) }
    }
    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let id = task.taskIdentifier
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        Task { @MainActor in self.onComplete(taskID: id, error: error, status: status) }
    }
}
