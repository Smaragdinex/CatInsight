"""台股 v0:技術面 + 法人籌碼 + 融資券 → LambdaMART 排序。自包含(建特徵→訓練→回測)。

資料來源:
  data/history_tw/{code}.TW|.TWO.json   價格/技術
  data/tw_institutional/{code}.json     法人買賣超(foreign/trust/total,股數)
  data/tw_margin/{code}.json            融資券(margin_bal/short_bal)
用法:python scripts/tw_v0.py
"""
import json
from pathlib import Path
import numpy as np
import pandas as pd
import xgboost as xgb

BASE = Path(__file__).resolve().parent.parent
HIST = BASE / "data" / "history_tw"
INST = BASE / "data" / "tw_institutional"
MARG = BASE / "data" / "tw_margin"
REV = BASE / "data" / "tw_revenue"
UNIV = json.loads((BASE / "data" / "tw_universe.json").read_text())
_NAME = {x["code"]: x.get("name", "") for x in json.loads((BASE / "tw_stocks.json").read_text())}

import os as _OS
_ELEC = {"半導體業", "電子零組件業", "光電業", "電腦及週邊設備業", "其他電子業",
         "通信網路業", "資訊服務業", "電子通路業", "數位雲端"}
if _OS.environ.get("ELEC_ONLY") == "1":
    _ind = json.loads((BASE / "data" / "tw_industry.json").read_text())
    UNIV = [c for c in UNIV if _ind.get(c) in _ELEC]
    print(f"[電子聚焦] 池子縮為 {len(UNIV)} 檔電子/半導體", flush=True)

import os as _ENV
FWD = int(_ENV.environ.get("FWD", "20"))   # 前瞻報酬天數(持有),可用 FWD 環境變數調
SAMPLE_EVERY = 5  # 每 5 個交易日取一個樣本
MIN_HIST = 80

FEATURES = [
    "ret_5", "ret_20", "ret_60", "rsi14", "ma20_ratio", "vol20", "vol_ratio",
    "foreign_5", "foreign_20", "trust_5", "trust_20", "total_20",
    "foreign_streak", "chip_vol_ratio", "margin_chg20", "short_ratio", "rev_yoy",
    "trust_streak", "foreign_amt_rank",
]


def _mi(ym):
    return (ym // 100) * 12 + (ym % 100)   # YYYYMM -> 絕對月序


def _rev_yoy(revidx, date):
    """point-in-time 月營收 YoY。revidx: {月序: revenue}。
    sample 月的營收要次月10號才公布 → 安全用 sample月-2 之前的最近月。"""
    if not revidx:
        return 0.0
    smi = (int(date[:4])) * 12 + int(date[5:7])
    cutoff = smi - 2
    avail = [k for k in revidx if k <= cutoff]
    if not avail:
        return 0.0
    last = max(avail)
    prev = last - 12
    if prev in revidx and revidx[prev]:
        return revidx[last] / revidx[prev] - 1.0
    return 0.0


def _load_price(code):
    for suf in (".TW", ".TWO"):
        p = HIST / f"{code}{suf}.json"
        if p.exists():
            try:
                return json.loads(p.read_text())
            except Exception:
                return None
    return None


def _load_map(path):
    try:
        return {r["date"]: r for r in json.loads(path.read_text())}
    except Exception:
        return {}


def _rsi(closes, n=14):
    if len(closes) < n + 1:
        return 50.0
    d = np.diff(closes[-(n + 1):])
    up = d[d > 0].sum() / n
    dn = -d[d < 0].sum() / n
    return 100.0 if dn == 0 else 100.0 - 100.0 / (1.0 + up / dn)


def _feat_at(code, closes, vols, dates, inst, marg, i, revidx=None, want_fwd=True):
    c = closes[i]
    if c <= 0:
        return None
    win_v = vols[i - 20:i] or [1]
    avgv = np.mean(win_v) or 1
    def chip_sum(key, w):
        s = 0.0
        for j in range(i - w, i):
            r = inst.get(dates[j])
            if r and r.get(key) is not None:
                s += r[key]
        return s / (avgv * w) if avgv else 0.0
    streak = 0
    for j in range(i - 1, max(i - 30, -1), -1):
        r = inst.get(dates[j])
        if r and (r.get("foreign") or 0) > 0:
            streak += 1
        else:
            break
    tstreak = 0
    for j in range(i - 1, max(i - 30, -1), -1):
        r = inst.get(dates[j])
        if r and (r.get("trust") or 0) > 0:
            tstreak += 1
        else:
            break
    # 外資近20日買超金額(股數×價,NT$)
    famt = 0.0
    for j in range(i - 20, i):
        r = inst.get(dates[j])
        if r and r.get("foreign") is not None:
            famt += r["foreign"] * closes[j]
    m_now = marg.get(dates[i - 1], {})
    m_20 = marg.get(dates[max(i - 21, 0)], {})
    mbal = m_now.get("margin_bal"); mbal20 = m_20.get("margin_bal")
    margin_chg20 = (mbal / mbal20 - 1.0) if (mbal and mbal20) else 0.0
    sbal = m_now.get("short_bal") or 0
    short_ratio = (sbal / mbal) if mbal else 0.0
    total_chip = chip_sum("total", 20)
    feat = {
        "code": code, "date": dates[i], "price": c,
        "ret_5": c / closes[i - 5] - 1 if closes[i - 5] else 0,
        "ret_20": c / closes[i - 20] - 1 if closes[i - 20] else 0,
        "ret_60": c / closes[i - 60] - 1 if i >= 60 and closes[i - 60] else 0,
        "rsi14": _rsi(closes[:i]),
        "ma20_ratio": c / np.mean(closes[i - 20:i]) if np.mean(closes[i - 20:i]) else 1,
        "vol20": float(np.std(np.diff(closes[i - 20:i]) / closes[i - 20:i - 1])) if i >= 21 else 0,
        "vol_ratio": (vols[i - 1] / avgv) if avgv else 1,
        "foreign_5": chip_sum("foreign", 5), "foreign_20": chip_sum("foreign", 20),
        "trust_5": chip_sum("trust", 5), "trust_20": chip_sum("trust", 20),
        "total_20": total_chip, "foreign_streak": float(streak),
        "chip_vol_ratio": total_chip, "margin_chg20": margin_chg20, "short_ratio": short_ratio,
        "rev_yoy": _rev_yoy(revidx, dates[i]) if revidx else 0.0,
        "trust_streak": float(tstreak), "foreign_amt20": famt, "foreign_amt_rank": 0.0,
        "fwd_ret": (closes[i + FWD] / c - 1) if (want_fwd and i + FWD < len(closes) and closes[i + FWD]) else 0,
    }
    return feat


def _load_all():
    data = {}
    for code in UNIV:
        px = _load_price(code)
        if not px or len(px) < MIN_HIST + FWD:
            continue
        # 月營收 → {月序: revenue}
        revidx = {}
        rp = REV / f"{code}.json"
        if rp.exists():
            try:
                for r in json.loads(rp.read_text()):
                    m = r.get("month")
                    if m and r.get("revenue"):
                        revidx[_mi(int(m))] = r["revenue"]
            except Exception:
                pass
        data[code] = (
            [r["close"] for r in px], [(r.get("volume") or 0) for r in px], [r["date"] for r in px],
            _load_map(INST / f"{code}.json"), _load_map(MARG / f"{code}.json"), revidx,
        )
    return data


def build_samples():
    rows = []
    for code, (closes, vols, dates, inst, marg, revidx) in _load_all().items():
        n = len(closes)
        for i in range(MIN_HIST, n - FWD, SAMPLE_EVERY):
            f = _feat_at(code, closes, vols, dates, inst, marg, i, revidx)
            if f:
                rows.append(f)
    df = pd.DataFrame(rows)
    if not df.empty:
        df["foreign_amt_rank"] = df.groupby("date")["foreign_amt20"].rank(pct=True)
    return df




def grade(df):
    # 每個日期內把前瞻報酬分 4 級當 relevance
    def g(s):
        try:
            return pd.qcut(s, [0, .5, .8, .95, 1.0], labels=[0, 1, 2, 3]).astype(int)
        except Exception:
            return pd.Series([0] * len(s), index=s.index)
    return df.groupby("date")["fwd_ret"].transform(g)


def main():
    print("建台股樣本中…", flush=True)
    df = build_samples()
    print(f"樣本數 {len(df)},股票 {df['code'].nunique()},日期 {df['date'].nunique()}", flush=True)
    df = df.dropna(subset=FEATURES)
    import os as _os
    chip_only = _os.environ.get("CHIP_ERA", "0") == "1"
    if chip_only:
        df = df[df["date"] >= "2022-06-01"]
        print(f"[籌碼期] 限定 2022-06 後,樣本 {len(df)}", flush=True)
    df["grade"] = grade(df)
    df = df.sort_values("date").reset_index(drop=True)

    import os as _os
    if _os.environ.get("TW_BT2026") == "1":
        tr = df[df["date"] <= "2025-12-31"]
        print(f"訓練到 2025-12-31:{len(tr)} 樣本", flush=True)
        rk = xgb.XGBRanker(objective="rank:ndcg", n_estimators=300, max_depth=6,
                           learning_rate=0.05, subsample=0.8, colsample_bytree=0.8, eval_metric="ndcg@10")
        rk.fit(tr[FEATURES], tr["grade"], group=tr.groupby("date").size().tolist())
        print("\n=== 台股 2026 1-5月 回測(進場日全市場現算,TOP20,持有 %d 日)===" % FWD)
        alld = _load_all()
        tot = []
        for mo in ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]:
            recs = []
            entry = None
            for code, (closes, vols, dates, inst, marg, revidx) in alld.items():
                # 找該月第一個交易日 index(只需有至少1天前瞻;不足FWD則算到最後一天)
                idxs = [k for k, d in enumerate(dates) if d.startswith(mo) and k >= MIN_HIST and k + 1 < len(closes)]
                if not idxs:
                    continue
                i = idxs[0]
                if entry is None:
                    entry = dates[i]
                f = _feat_at(code, closes, vols, dates, inst, marg, i, revidx, want_fwd=False)
                if f:
                    exit_i = min(i + FWD, len(closes) - 1)   # 不足 FWD → 算到最後可得日(6/18)
                    f["fwd_ret"] = closes[exit_i] / closes[i] - 1 if closes[i] else 0
                    recs.append(f)
            if not recs:
                print(f"  {mo}: 無資料"); continue
            day = pd.DataFrame(recs)
            day["foreign_amt_rank"] = day["foreign_amt20"].rank(pct=True)
            day = day.dropna(subset=FEATURES)
            day["score"] = rk.predict(day[FEATURES])
            # 護欄:過熱(ret_60高)+ 散戶FOMO(融資暴增)+ 投信沒挺 → 反轉型,濾掉
            if _OS.environ.get("TW_GUARD") == "1":
                bad = (day["ret_60"] > 0.80) & (day["trust_streak"] == 0) & (day["margin_chg20"] > 0.35)
                day = day[~bad]
            top = day.sort_values("score", ascending=False).head(20)
            base = day["fwd_ret"].mean()
            print(f"\n=== {mo}({entry}) TOP20  整體 {top['fwd_ret'].mean()*100:+.2f}% / 基準 {base*100:+.2f}% / 超額 {(top['fwd_ret'].mean()-base)*100:+.2f}% ===")
            for r, (_, row) in enumerate(top.iterrows(), 1):
                nm = _NAME.get(row["code"], "")
                print(f"  {r:>2} {row['code']} {nm:<6}  NT${row['price']:>7.1f}  20日 {row['fwd_ret']*100:+6.1f}%")
            tot.append(top["fwd_ret"].mean())
        if tot:
            print(f"  → 5月平均 TOP20:{np.mean(tot)*100:+.2f}%")
        return

    # 時間切分:最後 20% 日期當測試
    udates = sorted(df["date"].unique())
    split = udates[int(len(udates) * 0.8)]
    tr, te = df[df["date"] < split], df[df["date"] >= split]
    print(f"訓練 {len(tr)}({tr['date'].min()}~{tr['date'].max()}) / 測試 {len(te)}({te['date'].min()}~)", flush=True)

    def grp(d):
        return d.groupby("date").size().tolist()
    rk = xgb.XGBRanker(objective="rank:ndcg", n_estimators=300, max_depth=6,
                       learning_rate=0.05, subsample=0.8, colsample_bytree=0.8, eval_metric="ndcg@10")
    rk.fit(tr[FEATURES], tr["grade"], group=grp(tr))

    # 回測:測試期每個日期取 TOP10,看前瞻報酬
    te = te.copy()
    te["score"] = rk.predict(te[FEATURES])
    picks = te.sort_values(["date", "score"], ascending=[True, False]).groupby("date").head(10)
    by_date = picks.groupby("date")["fwd_ret"].mean()
    allavg = te.groupby("date")["fwd_ret"].mean()
    print("\n=== 台股 v0 回測(測試期,每期 TOP10,持有 %d 日)===" % FWD)
    print(f"  TOP10 平均前瞻報酬:{by_date.mean()*100:+.2f}%")
    print(f"  全體平均(基準)  :{allavg.mean()*100:+.2f}%")
    print(f"  超額:{(by_date.mean()-allavg.mean())*100:+.2f}%")
    print(f"  期數:{len(by_date)}")
    # 特徵重要性
    imp = sorted(zip(FEATURES, rk.feature_importances_), key=lambda x: -x[1])
    print("\n特徵重要性 TOP8:", [(f, round(float(v), 3)) for f, v in imp[:8]])


if __name__ == "__main__":
    main()
