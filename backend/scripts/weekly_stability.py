"""每週一次進場的穩定度測試：2026 1-5月，每7天進場，看勝率穩不穩。"""
import sys, json
from pathlib import Path
from datetime import date, timedelta
sys.path.insert(0, "."); sys.path.insert(0, "./scripts")
import joblib, numpy as np, pandas as pd
from backtest_lambdamart import _build_features_as_of, is_speculative_excluded
from rank_today_fast import EXCLUDE_SYMBOLS
from train_classifier_xgb import _load_fundamentals, load_analyst_cache, HISTORY_10Y_DIR, FUNDAMENTALS_DIR, ANALYST_DIR
from market_context import load_market_context
from earnings_features import load_earnings_cache

HOLD = 90  # 日曆日
ec = load_earnings_cache(Path("./data/earnings")); hist = HISTORY_10Y_DIR
mc = load_market_context(hist); fu = _load_fundamentals(FUNDAMENTALS_DIR); ac = load_analyst_cache(ANALYST_DIR)
rk = joblib.load("models/ranker_lambdamart_h1_202511.joblib")
rmodel = rk["model"]; RFC = rk["metadata"]["featureNames"]; rclip = rk["metadata"].get("clipBounds", {})

all_rows = {}
for p in sorted(hist.glob("*.json")):
    sym = p.stem.upper()
    if sym in EXCLUDE_SYMBOLS or sym.startswith("_"):
        continue
    rows = sorted([x for x in json.load(open(p)) if x.get("date") and x.get("close")], key=lambda x: x["date"])
    if rows:
        all_rows[sym] = rows
data_last = max(r[-1]["date"] for r in all_rows.values())

# 每週一進場日（2026-01-05 起每7天到 2026-05-25）
mondays = []
d = date(2026, 1, 5)
while d <= date(2026, 5, 25):
    mondays.append(d.isoformat()); d += timedelta(days=7)

def clipX(X):
    for c, bd in rclip.items():
        if c in X.columns and bd.get("lo") is not None:
            X[c] = X[c].clip(lower=bd["lo"], upper=bd["hi"])
    return X

results = []
all_picks_win = []  # 所有股票的勝負(總勝率用)
for entry in mondays:
    # 進場：找 >= entry 的最近交易日
    feats = []; syms = []
    for sym, rows in all_rows.items():
        if is_speculative_excluded(sym):
            continue
        idx = next((j for j, r in enumerate(rows) if r["date"] >= entry), None)
        if idx is None or idx < 1:
            continue
        edate = rows[idx]["date"]
        f = _build_features_as_of(sym, rows, edate, mc, fu, ac, ec)
        if not f:
            continue
        # 過濾：無財報 / 腰斬 / 接刀
        _hf = any(f.get(k) for k in ("profit_margin", "gross_margin", "revenue_growth"))
        _he = any(f.get(k) for k in ("eps_yoy", "beat_streak", "eps_surprise_pct"))
        if not _hf and not _he:
            continue
        _p52 = f.get("price_to_52w_high", 1.0) or 1.0; _m20 = f.get("momentum_20", 0.0) or 0.0
        if _p52 < 0.35 or (_p52 < 0.45 and _m20 < -0.15):
            continue
        _rsi = f.get("rsi", 50) or 50; _su = f.get("vol_surge_20_60", 1.0) or 1.0; _bt = f.get("beta_60d", 1.0) or 1.0
        if _rsi < 30 and _m20 < 0 and _su < 0.90 and _bt > 2.5:
            continue
        feats.append((sym, rows, idx, f)); syms.append(sym)
    if not feats:
        continue
    X = clipX(pd.DataFrame([{c: (f.get(c) or 0.0) for c in RFC} for s, rw, ix, f in feats]))
    sc = rmodel.predict(X)
    order = np.argsort(-sc)[:20]
    target_exit = (date.fromisoformat(feats[order[0]][1][feats[order[0]][2]]["date"]) + timedelta(days=HOLD)).isoformat()
    rets = []
    for i in order:
        sym, rows, idx, _f = feats[i]
        entry_px = rows[idx - 1]["close"]
        exit_rows = [r for r in rows[idx:] if r["date"] <= target_exit]
        if not exit_rows:
            continue
        rets.append((exit_rows[-1]["close"] - entry_px) / entry_px)
    if not rets:
        continue
    rets = np.array(rets)
    full = target_exit <= data_last
    wr = (rets > 0).mean()
    results.append((entry, rets.mean(), wr, len(rets), full))
    all_picks_win.extend((rets > 0).tolist())

print(f"{'進場週':<12}{'平均報酬':>9}{'勝率':>7}{'檔數':>5}  {'狀態'}")
print("-" * 48)
for entry, avg, wr, n, full in results:
    print(f"{entry:<12}{avg:>+9.1%}{wr:>7.0%}{n:>5}  {'完整90天' if full else '⚠️未滿'}")

full_res = [r for r in results if r[4]]
wins = sum(all_picks_win); total = len(all_picks_win)
print("-" * 48)
print(f"\n【穩定度統計】共 {len(results)} 週")
wrs = np.array([r[2] for r in results])
print(f"  個別勝率: 平均 {wrs.mean():.0%}  最低 {wrs.min():.0%}  最高 {wrs.max():.0%}  標準差 {wrs.std():.0%}")
print(f"  總共勝率(全部 {total} 個選股): {wins}/{total} = {wins/total:.1%}")
avgs = np.array([r[1] for r in results])
print(f"  週報酬: 平均 {avgs.mean():+.1%}  最低 {avgs.min():+.1%}  最高 {avgs.max():+.1%}")
if full_res:
    fwrs = np.array([r[2] for r in full_res])
    print(f"\n  只算完整90天的 {len(full_res)} 週:")
    print(f"    個別勝率 平均 {fwrs.mean():.0%}  最低 {fwrs.min():.0%}  最高 {fwrs.max():.0%}  標準差 {fwrs.std():.0%}")
