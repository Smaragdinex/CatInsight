"""
tts_server.py — MyStockApp 高音質語音服務(port 8004)
  英文:Kokoro-82M(af_heart)         中文 / 中英夾雜:CosyVoice 2 官方參考聲音(tts_assets/official_prompt.*)
  由 main.py(8003)的 /tts 代理給 App 用。要用 cosy-venv 跑:
    cd ~/Desktop/wei/stock-api && ../cosy-mps/bin/uvicorn tts_server:app --host 127.0.0.1 --port 8004   (cosy-mps:Py3.11 + torch 2.12,MPS)
"""
import io, os, re, sys, threading, time, logging
from pathlib import Path

import numpy as np
import soundfile as sf
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")   # 少數 op 在 MPS 沒實作時退回 CPU 算
import torch
if torch.backends.mps.is_available():
    os.environ.setdefault("COSY_DEVICE", "mps")             # CosyVoice 跑 Apple GPU(需 torch ≥2.12 的 cosy-mps 環境;CPU 只有 0.5x,MPS 約 1.1x)
from fastapi import FastAPI, HTTPException, Request
import asyncio
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from zhconv import convert as zhconvert

COSY_DIR = os.environ.get("COSY_DIR", str(Path.home() / "Desktop/wei/CosyVoice"))
sys.path.insert(0, COSY_DIR); sys.path.append(os.path.join(COSY_DIR, "third_party/Matcha-TTS"))
ASSETS = Path(__file__).parent / "tts_assets"
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
log = logging.getLogger("tts"); logging.basicConfig(level=logging.INFO)

app = FastAPI()

VOICES = {
    "en-heart":   {"engine": "kokoro", "lang": "a", "voice": "af_heart", "name": "Heart", "desc": "English · natural"},
    "zh-official": {"engine": "cosy",  "spk": "official",                "name": "貓咪助理", "desc": "中文 / 中英夾雜"},
}
DEFAULT_ZH = "zh-official"     # 2026-09-27 使用者決定中文只用官方聲音(複製聲音那條路已移除)

# ---------- 文字前處理 ----------
TICKER_RE = re.compile(r"\b([A-Z]{2,5})\b")          # NVDA → N V D A(股票代號逐字母唸)
TW_RE = re.compile(r"\b(\d{4})\.TW\b")
COMPANY_ZH = {  # 中文句子裡的英文公司名換成中文譯名(CosyVoice 中文模式唸英文專有名詞會壞)
    "NVIDIA": "輝達", "Nvidia": "輝達", "Apple": "蘋果", "Tesla": "特斯拉", "Microsoft": "微軟", "Google": "谷歌",
    "Alphabet": "谷歌", "Amazon": "亞馬遜", "Netflix": "網飛", "Broadcom": "博通", "Palantir": "帕蘭泰爾",
    "TSMC": "台積電", "MediaTek": "聯發科", "Foxconn": "鴻海", "Intel": "英特爾", "Qualcomm": "高通",
}
HAS_CJK = re.compile(r"[一-鿿]")
# 股票代號唸成公司名(使用者要求:不要唸 N-V-D-A,唸 NVIDIA / 輝達);表裡沒有的代號才逐字母唸
TICKER_EN = {"NVDA": "NVIDIA", "AAPL": "Apple", "TSLA": "Tesla", "MSFT": "Microsoft", "AMZN": "Amazon", "GOOGL": "Google", "GOOG": "Google",
             "META": "Meta", "AVGO": "Broadcom", "NFLX": "Netflix", "PLTR": "Palantir", "INTC": "Intel", "QCOM": "Qualcomm", "MU": "Micron",
             "ORCL": "Oracle", "TSM": "TSMC", "VRT": "Vertiv", "DELL": "Dell", "MRVL": "Marvell", "COHR": "Coherent", "AMD": "AMD",
             "CRM": "Salesforce", "ADBE": "Adobe", "COST": "Costco", "WMT": "Walmart", "JPM": "JPMorgan", "UBER": "Uber",
             "SMCI": "Supermicro", "ARM": "Arm", "ASML": "ASML", "LLY": "Eli Lilly", "NVO": "Novo Nordisk", "BABA": "Alibaba", "PDD": "Pinduoduo",
             "2330.TW": "TSMC", "2454.TW": "MediaTek", "2317.TW": "Foxconn", "2308.TW": "Delta Electronics", "2382.TW": "Quanta", "3008.TW": "Largan"}
TICKER_ZH = {"NVDA": "輝達", "AAPL": "蘋果", "TSLA": "特斯拉", "MSFT": "微軟", "AMZN": "亞馬遜", "GOOGL": "谷歌", "GOOG": "谷歌", "META": "Meta",
             "AVGO": "博通", "NFLX": "網飛", "PLTR": "帕蘭泰爾", "INTC": "英特爾", "QCOM": "高通", "MU": "美光", "ORCL": "甲骨文", "TSM": "台積電",
             "VRT": "Vertiv", "DELL": "戴爾", "MRVL": "邁威爾", "COHR": "Coherent", "AMD": "超微", "CRM": "Salesforce", "ADBE": "Adobe",
             "COST": "好市多", "WMT": "沃爾瑪", "JPM": "摩根大通", "UBER": "Uber", "SMCI": "美超微", "ARM": "安謀", "ASML": "艾司摩爾",
             "LLY": "禮來", "BABA": "阿里巴巴", "2330.TW": "台積電", "2454.TW": "聯發科", "2317.TW": "鴻海", "2308.TW": "台達電", "2382.TW": "廣達", "3008.TW": "大立光",
             "2330": "台積電", "2454": "聯發科", "2317": "鴻海", "2308": "台達電", "2382": "廣達", "3008": "大立光"}
TICKER_TOKEN = re.compile(r"(?<![A-Za-z0-9])(\d{4}(?:\.TW)?|[A-Z]{1,5})(?![A-Za-z0-9])")

def prep_en(t: str) -> str:
    t = TICKER_TOKEN.sub(lambda m: TICKER_EN.get(m.group(1), m.group(1)), t)       # NVDA → NVIDIA
    t = TW_RE.sub(r"\1 T W", t)
    return TICKER_RE.sub(lambda m: " ".join(m.group(1)), t)                          # 其他代號逐字母

def prep_zh(t: str) -> str:
    t = TICKER_TOKEN.sub(lambda m: TICKER_ZH.get(m.group(1), m.group(1)), t)       # NVDA → 輝達、2330.TW → 台積電
    for k, v in COMPANY_ZH.items():
        t = t.replace(k, v)
    t = re.sub(r"(\S{2,6})[ ,，、]?\1", r"\1", t)          # 「台積電 2330.TW」換完變「台積電 台積電」→ 去掉重複
    t = TW_RE.sub(r"\1", t)                            # 台股代號只唸數字
    t = TICKER_RE.sub(lambda m: " ".join(m.group(1)), t)
    t = t.replace("%", "%")
    return zhconvert(t, "zh-cn")                        # CosyVoice 是簡體訓練的,繁體會唸壞;發音不變

# ---------- 音量:模型輸出偏小(中文 peak 約 -18 dBFS、英文 -9),各乘一個增益再軟限幅,手機上才夠大聲 ----------
GAIN = {"kokoro": 2.2, "cosy": 5.0}
def apply_gain(a: np.ndarray, g: float) -> np.ndarray:
    x = np.asarray(a, dtype=np.float32) * g
    m = np.abs(x); knee = 0.9
    over = m > knee
    x[over] = np.sign(x[over]) * (knee + 0.1 * np.tanh((m[over] - knee) / 0.1))   # 超過 0.9 的部分軟壓,不會爆音
    return x

# ---------- 引擎(延遲載入、單一鎖:模型不是 thread-safe)----------
_lock = threading.Lock()
_kokoro = None
_cosy = None

def kokoro():
    global _kokoro
    if _kokoro is None:
        from kokoro import KPipeline
        t0 = time.time(); _kokoro = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M", device=DEVICE)
        log.info("Kokoro ready in %.1fs (%s)", time.time() - t0, DEVICE)
    return _kokoro

def cosy():
    global _cosy
    if _cosy is None:
        from cosyvoice.cli.cosyvoice import CosyVoice2
        t0 = time.time()
        _cosy = CosyVoice2(f"{COSY_DIR}/pretrained_models/CosyVoice2-0.5B", load_jit=False, load_trt=False, load_vllm=False, fp16=False)
        prompt_text = zhconvert((ASSETS / "official_prompt.txt").read_text().strip(), "zh-cn")   # 參考音只算一次
        _cosy.add_zero_shot_spk(prompt_text, str(ASSETS / "official_prompt.wav"), "official")
        log.info("CosyVoice ready in %.1fs (%s)", time.time() - t0, os.environ.get("COSY_DEVICE", "cpu"))
    return _cosy

def warm_up():
    try:
        with _lock:
            kokoro(); cosy()
    except Exception as e:
        log.exception("warm-up failed: %s", e)

threading.Thread(target=warm_up, daemon=True).start()

# ---------- API ----------
class TTSReq(BaseModel):
    text: str
    voice: str = "auto"       # auto:有中文字就用 zh-myvoice,否則 en-heart
    speed: float = 1.0

def pick_voice(req: TTSReq) -> str:
    """App 依使用者選的語言指定:中文 → zh-official、英文 → en-heart;auto 則看內容。
    保護:指定英文聲音(Kokoro)但內容有中文字 → 改用中文聲音,不然 Kokoro 會跳過中文。"""
    if req.voice in VOICES:
        if VOICES[req.voice]["engine"] == "kokoro" and HAS_CJK.search(req.text):
            return DEFAULT_ZH
        return req.voice
    return DEFAULT_ZH if HAS_CJK.search(req.text) else "en-heart"

def synth(text: str, voice: str, speed: float) -> tuple[np.ndarray, int]:
    v = VOICES[voice]
    if v["engine"] == "kokoro":
        parts = [np.asarray(a) for _, _, a in kokoro()(prep_en(text), voice=v["voice"], speed=speed)]
        return apply_gain(np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32), GAIN["kokoro"]), 24000
    cv = cosy()
    parts = [j["tts_speech"] for j in cv.inference_zero_shot(prep_zh(text), "", "", zero_shot_spk_id=v["spk"], stream=False, speed=speed)]
    audio = torch.cat(parts, dim=1)[0].cpu().numpy() if parts else np.zeros(0, dtype=np.float32)
    return apply_gain(audio, GAIN["cosy"]), cv.sample_rate

# ---------- 串流:邊生成邊送 raw PCM16 mono 24kHz(手機邊收邊播,首句延遲降到 1~2 秒)----------
def synth_stream(text: str, voice: str, speed: float, mode: str = "stream"):
    """yield PCM16 bytes。
    mode="stream":CosyVoice 用 stream=True 一段段吐(首段快、但整體只有約 0.6x,適合一輪的第一句)
    mode="whole" :整句算完(約 1.0x)再切 0.5 秒一塊吐(給後面的句子,前一句在播時先算好)"""
    v = VOICES[voice]
    g = GAIN[v["engine"]]
    def to_pcm(a):
        a = apply_gain(np.asarray(a, dtype=np.float32).reshape(-1), g)
        return (np.clip(a, -1, 1) * 32767).astype("<i2").tobytes()
    if v["engine"] == "kokoro":
        for _, _, a in kokoro()(prep_en(text), voice=v["voice"], speed=speed):
            yield to_pcm(a)
        return
    cv = cosy()
    if mode == "whole":
        parts = [j["tts_speech"] for j in cv.inference_zero_shot(prep_zh(text), "", "", zero_shot_spk_id=v["spk"], stream=False, speed=speed)]
        audio = torch.cat(parts, dim=1)[0].cpu().numpy() if parts else np.zeros(0, dtype=np.float32)
        step = int(cv.sample_rate * 0.5)
        for i in range(0, len(audio), step):
            yield to_pcm(audio[i:i + step])
        return
    for j in cv.inference_zero_shot(prep_zh(text), "", "", zero_shot_spk_id=v["spk"], stream=True, speed=speed):
        yield to_pcm(j["tts_speech"][0].cpu().numpy())

class TTSStreamReq(TTSReq):
    mode: str = "stream"      # "stream"(首段最快)或 "whole"(整句算完再送,吞吐較好)

@app.post("/tts/stream")
async def tts_stream(req: TTSStreamReq, request: Request):
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "empty text")
    if len(text) > 600:
        raise HTTPException(400, "text too long (max 600 chars)")
    voice = pick_voice(req); speed = max(0.6, min(1.6, req.speed)); mode = req.mode if req.mode in ("stream", "whole") else "stream"

    async def gen():
        # 生成跑在背景 thread(佔住模型鎖),這裡邊拿邊送;客戶端斷線(使用者打斷 / 換問題)就設 stop,
        # 生成立刻停、還在等鎖的請求拿到鎖也直接放掉 → 不會讓舊的、已取消的句子卡住新問題(之前首段等了 47 秒就是這樣)
        q: asyncio.Queue = asyncio.Queue(); stop = threading.Event(); loop = asyncio.get_running_loop()
        t0 = time.time(); stats = {"n": 0, "first": None}
        def worker():
            with _lock:
                if stop.is_set():
                    loop.call_soon_threadsafe(q.put_nowait, None); return
                try:
                    for chunk in synth_stream(text, voice, speed, mode):
                        if stop.is_set(): break
                        if stats["first"] is None: stats["first"] = time.time() - t0
                        stats["n"] += len(chunk)
                        loop.call_soon_threadsafe(q.put_nowait, chunk)
                except Exception as e:
                    log.exception("stream failed: %s", e)
            loop.call_soon_threadsafe(q.put_nowait, None)
        threading.Thread(target=worker, daemon=True).start()
        try:
            while True:
                chunk = await q.get()
                if chunk is None: break
                if await request.is_disconnected():
                    stop.set(); break
                yield chunk
        finally:
            stop.set()
            log.info("tts/stream %s %s first %.2fs, %.1fs audio in %.2fs%s | %s", voice, mode, stats["first"] or -1, stats["n"] / 2 / 24000,
                     time.time() - t0, " (client gone)" if await request.is_disconnected() else "", text[:40])
    return StreamingResponse(gen(), media_type="audio/L16", headers={"X-Voice": voice, "X-Sample-Rate": "24000", "X-Channels": "1", "Cache-Control": "no-store"})

@app.get("/tts/health")
def health():
    return {"ok": True, "kokoro": _kokoro is not None, "cosy": _cosy is not None, "device": DEVICE}

@app.get("/tts/voices")
def voices():
    return [{"id": k, "name": v["name"], "desc": v["desc"], "engine": v["engine"]} for k, v in VOICES.items()]

@app.post("/tts")
def tts(req: TTSReq):
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "empty text")
    if len(text) > 600:
        raise HTTPException(400, "text too long (max 600 chars)")
    voice = pick_voice(req)
    t0 = time.time()
    with _lock:
        audio, sr = synth(text, voice, max(0.6, min(1.6, req.speed)))
    buf = io.BytesIO(); sf.write(buf, audio, sr, format="WAV", subtype="PCM_16")
    dur = len(audio) / sr; el = time.time() - t0
    log.info("tts %s %.1fs audio in %.2fs (x%.1f) | %s", voice, dur, el, dur / max(el, 1e-6), text[:40])
    return Response(buf.getvalue(), media_type="audio/wav", headers={"X-Voice": voice, "X-Duration": f"{dur:.2f}", "X-Gen-Seconds": f"{el:.2f}"})
