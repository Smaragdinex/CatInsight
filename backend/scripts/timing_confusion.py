"""階段2時機模型驗證：2026 1-5月，每5交易日，混淆矩陣 + 機率圖。

預測：時機模型 normalized dip < waitThreshold → 🔴看跌(等回檔)；否則 🟢看漲(現在進)
實際：該股未來 5 交易日報酬 < 0 → 跌；否則 漲
"""
import sys, json
from pathlib import Path
sys.path.insert(0, "."); sys.path.insert(0, "./scripts")
import joblib, numpy as np, pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from backtest_lambdamart import _build_features_as_of
from train_classifier_xgb import _load_fundamentals, load_analyst_cache, HISTORY_10Y_DIR, FUNDAMENTALS_DIR, ANALYST_DIR
from market_context import load_market_context
from earnings_features import load_earnings_cache

FWD = 5
ec = load_earnings_cache(Path("./data/earnings"))
hist = HISTORY_10Y_DIR
mc = load_market_context(hist); fu = _load_fundamentals(FUNDAMENTALS_DIR); ac = load_analyst_cache(ANALYST_DIR)
b = joblib.load("models/timing_xgb_w10_202511.joblib")
model = b["model"]; FC = b["metadata"]["featureNames"]; clip = b["metadata"]["clipBounds"]; THR = b["metadata"]["waitThreshold"]

# 載入所有股票
all_rows = {}
for p in sorted(hist.glob("*.json")):
    items = json.loads(p.read_text())
    rows = sorted([x for x in items if x.get("date") and x.get("close")], key=lambda x: x["date"])
    if len(rows) > 250:
        all_rows[p.stem.upper()] = rows

# SPY 交易日序列，取 2026 1-5月每5天
spy_dates = sorted(mc.get("SPY", {}).keys())
win = [d for d in spy_dates if "2026-01-01" <= d <= "2026-05-31"]
si = spy_dates.index(win[0]); ei = spy_dates.index(win[-1])
test_dates = [spy_dates[i] for i in range(si, ei, 5)]
print(f"測試日: {len(test_dates)} 個 ({test_dates[0]} ~ {test_dates[-1]})", flush=True)

preds = []; actuals = []; scores = []
for di, d in enumerate(test_dates):
    feats = []; fwd_rets = []
    for sym, rows in all_rows.items():
        # 找 as-of date 的索引
        idx = None
        for j, r in enumerate(rows):
            if r["date"] > d:
                idx = j; break
        if idx is None or idx < 1 or idx + FWD >= len(rows):
            continue
        f = _build_features_as_of(sym, rows, d, mc, fu, ac, ec)
        if not f:
            continue
        p0 = rows[idx - 1]["close"]; p1 = rows[idx - 1 + FWD]["close"]
        feats.append(f); fwd_rets.append((p1 - p0) / p0)
    if not feats:
        continue
    X = pd.DataFrame([{c: (ft.get(c) or 0.0) for c in FC} for ft in feats])
    for c, bd in clip.items():
        if c in X.columns and bd.get("lo") is not None:
            X[c] = X[c].clip(lower=bd["lo"], upper=bd["hi"])
    sc = model.predict(X)
    for s, fr in zip(sc, fwd_rets):
        scores.append(float(s)); preds.append(1 if s < THR else 0); actuals.append(1 if fr < 0 else 0)
    print(f"  {d}: 累計樣本 {len(preds)}", flush=True)

preds = np.array(preds); actuals = np.array(actuals); scores = np.array(scores)
# 1=看跌/實際跌, 0=看漲/實際漲
tp = int(np.sum((preds == 1) & (actuals == 1)))
fp = int(np.sum((preds == 1) & (actuals == 0)))
fn = int(np.sum((preds == 0) & (actuals == 1)))
tn = int(np.sum((preds == 0) & (actuals == 0)))
n = len(preds)
prec = tp / (tp + fp) if (tp + fp) else 0
rec = tp / (tp + fn) if (tp + fn) else 0
acc = (tp + tn) / n if n else 0
base_down = (actuals == 1).mean()
print(f"\n總樣本 n={n}  實際下跌基準率={base_down:.1%}")
print(f"混淆矩陣:")
print(f"                實際跌    實際漲")
print(f"  預測看跌🔴    {tp:>6}   {fp:>6}")
print(f"  預測看漲🟢    {fn:>6}   {tn:>6}")
print(f"\n準確率={acc:.1%}  看跌precision={prec:.1%}(說跌真的跌)  看跌recall={rec:.1%}")

# ── 圖：混淆矩陣熱圖 + 分數分佈 ──
fig, axes = plt.subplots(1, 2, figsize=(13, 5))
cm = np.array([[tp, fp], [fn, tn]])
ax = axes[0]
im = ax.imshow(cm, cmap="Blues")
ax.set_xticks([0, 1]); ax.set_xticklabels(["實際跌", "實際漲"])
ax.set_yticks([0, 1]); ax.set_yticklabels(["預測看跌🔴", "預測看漲🟢"])
for i in range(2):
    for j in range(2):
        ax.text(j, i, f"{cm[i,j]}\n{cm[i,j]/n*100:.1f}%", ha="center", va="center",
                color="white" if cm[i,j] > cm.max()/2 else "black", fontsize=13)
ax.set_title(f"時機模型混淆矩陣 (n={n}, 未來{FWD}天)\n準確率{acc:.1%}")

# 分數分佈：看跌組 vs 看漲組的實際報酬
ax2 = axes[1]
down_scores = scores[actuals == 1]; up_scores = scores[actuals == 0]
ax2.hist(up_scores, bins=40, alpha=0.6, label="實際漲", color="green", density=True)
ax2.hist(down_scores, bins=40, alpha=0.6, label="實際跌", color="red", density=True)
ax2.axvline(THR, color="black", ls="--", label=f"門檻{THR}")
ax2.set_xlabel("時機模型分數 (越負=越看跌)"); ax2.set_ylabel("密度")
ax2.set_title("分數分佈：實際漲 vs 實際跌\n(兩組分開=模型有區分力)")
ax2.legend()
plt.tight_layout()
out = "data/timing_confusion_2026.png"
plt.savefig(out, dpi=110)
print(f"\n圖已存: {out}")
