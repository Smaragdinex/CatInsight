"""全樣本驗證:景氣循環/regime 曝險訊號是否真能防禦熊市又不誤殺多頭。
比較 buy&hold SPY vs 訊號為 risk-off 時空手(現金)。無前視:t 日訊號決定 t+1 日部位。"""
import json, math
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent / "data" / "history_10y"

def load(sym):
    rows = json.loads((BASE / f"{sym}.json").read_text())
    return [(r["date"], float(r["close"])) for r in rows if r.get("close")]

spy = load("SPY"); vix = load("VIX")
vixd = dict(vix)
dates = [d for d, _ in spy]
px = [c for _, c in spy]
n = len(px)

def sma(i, w):
    if i + 1 < w: return None
    return sum(px[i+1-w:i+1]) / w

def mom(i, w):
    if i - w < 0 or px[i-w] == 0: return None
    return px[i] / px[i-w] - 1.0

# 候選訊號:回傳 True = risk-off(該空手)
def sig_A(i):  # SPY < 200MA
    m = sma(i, 200); return m is not None and px[i] < m
def sig_B(i):  # 死亡交叉 50MA < 200MA
    a, b = sma(i, 50), sma(i, 200); return a is not None and b is not None and a < b
def sig_C(i):  # SPY<200MA 且 VIX>20
    m = sma(i, 200); v = vixd.get(dates[i])
    return m is not None and v is not None and px[i] < m and v > 20
def sig_D(i):  # 60日動能<0 且 VIX>25
    mm = mom(i, 60); v = vixd.get(dates[i])
    return mm is not None and v is not None and mm < 0 and v > 25

SIGS = {"A: SPY<200MA": sig_A, "B: 50/200死叉": sig_B,
        "C: SPY<200MA & VIX>20": sig_C, "D: 動能<0 & VIX>25": sig_D}

def backtest(sig):
    eq_bh = 1.0; eq_rg = 1.0
    peak_bh = peak_rg = 1.0; mdd_bh = mdd_rg = 0.0
    yearly_bh = {}; yearly_rg = {}
    days_out = 0
    for i in range(200, n - 1):
        ret = px[i+1] / px[i] - 1.0  # 隔日報酬
        riskoff = sig(i)
        if riskoff: days_out += 1
        eq_bh *= (1 + ret)
        eq_rg *= (1 + (0.0 if riskoff else ret))
        peak_bh = max(peak_bh, eq_bh); mdd_bh = min(mdd_bh, eq_bh/peak_bh - 1)
        peak_rg = max(peak_rg, eq_rg); mdd_rg = min(mdd_rg, eq_rg/peak_rg - 1)
        y = dates[i+1][:4]
        yearly_bh[y] = yearly_bh.get(y, 1.0) * (1 + ret)
        yearly_rg[y] = yearly_rg.get(y, 1.0) * (1 + (0.0 if riskoff else ret))
    return eq_bh, eq_rg, mdd_bh, mdd_rg, yearly_bh, yearly_rg, days_out

bh_total = None
print(f"樣本: {dates[200]} ~ {dates[-1]}  ({n} 交易日)\n")
for name, sig in SIGS.items():
    bh, rg, mdd_bh, mdd_rg, ybh, yrg, out = backtest(sig)
    bh_total = bh
    print(f"=== 訊號 {name} ===")
    print(f"  總報酬   買進持有 {(bh-1)*100:+.0f}%   |  regime {(rg-1)*100:+.0f}%")
    print(f"  最大回撤 買進持有 {mdd_bh*100:.1f}%  |  regime {mdd_rg*100:.1f}%")
    print(f"  空手天數 {out} / {n-201} ({out/(n-201)*100:.0f}%)")
    print(f"  分年報酬 (買持 vs regime):")
    for y in sorted(ybh):
        print(f"    {y}: {(ybh[y]-1)*100:+6.1f}%  vs  {(yrg[y]-1)*100:+6.1f}%")
    print()
