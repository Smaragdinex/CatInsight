"""純動能/技術回測(只用價格,不需基本面)——驗證擴張期動能因子是否抓得到飆股。
無前視:在 score_date 用當天以前的資料排序,持有 hold 交易日看實際報酬。"""
import json, sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent / "data" / "history_10y"
SKIP = {"SPY", "VIX", "SOXX", "QQQ", "DIA", "IWM"}

def load(p):
    try:
        rows = json.loads(p.read_text())
        return [(r["date"], float(r["close"])) for r in rows if r.get("close")]
    except Exception:
        return None

SCORE_DATE = sys.argv[1] if len(sys.argv) > 1 else "2020-06-01"
HOLD = int(sys.argv[2]) if len(sys.argv) > 2 else 140
TOP = 20

def idx_on_or_before(dates, t):
    lo = [i for i, d in enumerate(dates) if d <= t]
    return lo[-1] if lo else None

results = []
spy = load(BASE / "SPY.json"); spy_d = [d for d, _ in spy]; spy_c = [c for _, c in spy]

for p in BASE.glob("*.json"):
    sym = p.stem.upper()
    if sym in SKIP or sym.endswith(".TW") or sym.endswith(".TWO"):
        continue
    data = load(p)
    if not data or len(data) < 260:
        continue
    dates = [d for d, _ in data]; closes = [c for _, c in data]
    i = idx_on_or_before(dates, SCORE_DATE)
    if i is None or i < 200:
        continue
    px = closes[i]
    if px <= 0:
        continue
    # 動能特徵(只用 i 以前資料)
    ret63 = px / closes[i-63] - 1 if closes[i-63] > 0 else None
    ret126 = px / closes[i-126] - 1 if closes[i-126] > 0 else None
    ma200 = sum(closes[i-199:i+1]) / 200
    ma50 = sum(closes[i-49:i+1]) / 200 * 4  # quick 50ma
    ma50 = sum(closes[i-49:i+1]) / 50
    if ret63 is None or ret126 is None:
        continue
    uptrend = px > ma200 and ma50 > ma200
    if not uptrend:
        continue
    score = 0.5 * ret126 + 0.5 * ret63   # 動能分數
    # 出場報酬
    j = i + HOLD
    if j >= len(closes):
        continue
    fwd = closes[j] / px - 1
    results.append({"sym": sym, "score": score, "entry": px, "exit": closes[j], "fwd": fwd})

results.sort(key=lambda x: x["score"], reverse=True)
si = idx_on_or_before(spy_d, SCORE_DATE)
spy_fwd = (spy_c[si+HOLD] / spy_c[si] - 1) if si and si+HOLD < len(spy_c) else None

print(f"=== 純動能回測  排序日 {SCORE_DATE}  持有 {HOLD} 交易日 ===")
print(f"宇宙可評分: {len(results)} 支\n")
print(f"{'#':<4}{'SYM':<8}{'進場':>9}{'出場':>9}{'報酬':>9}{'動能分':>9}")
top = results[:TOP]
for k, r in enumerate(top, 1):
    print(f"{k:<4}{r['sym']:<8}{r['entry']:>9.2f}{r['exit']:>9.2f}{r['fwd']*100:>+8.1f}%{r['score']*100:>8.0f}%")

def median(xs):
    s = sorted(xs); n = len(s)
    return s[n//2] if n % 2 else (s[n//2-1] + s[n//2]) / 2

def trimmed_mean(xs, pct=0.10):
    s = sorted(xs); k = int(len(s) * pct)
    core = s[k:len(s)-k] if len(s) - 2*k > 0 else s
    return sum(core) / len(core)

rets = [r["fwd"] for r in top]
avg = sum(rets) / len(rets)
med = median(rets)
trim = trimmed_mean(rets, 0.10)
win = sum(1 for x in rets if x > 0) / len(rets)
allavg = sum(r["fwd"] for r in results) / len(results)
best = max(top, key=lambda r: r["fwd"]); worst = min(top, key=lambda r: r["fwd"])

print(f"\n--- TOP{TOP} 績效(3 種平均對照)---")
print(f"  算術平均:  {avg*100:+.1f}%   ← 易被極端值扭曲")
print(f"  中位數:    {med*100:+.1f}%   ← 典型一支的真實水準")
print(f"  截尾平均:  {trim*100:+.1f}%   ← 去掉最高/最低各10%")
print(f"  勝率: {win*100:.0f}%   最大贏家 {best['sym']} {best['fwd']*100:+.0f}%   最大輸家 {worst['sym']} {worst['fwd']*100:+.0f}%")
if spy_fwd is not None:
    print(f"  SPY: {spy_fwd*100:+.1f}%   全宇宙平均: {allavg*100:+.1f}%")

# 看明星股排名
print("\n📌 明星股當時排名:")
rank = {r["sym"]: (k+1, r["fwd"]) for k, r in enumerate(results)}
for s in ["TSLA", "AMZN", "NVDA", "AMD", "NFLX", "UBER", "MU"]:
    if s in rank:
        print(f"  {s}: #{rank[s][0]} / {len(results)}   報酬 {rank[s][1]*100:+.1f}%")
    else:
        print(f"  {s}: 未入榜(不符上升趨勢或資料不足)")
