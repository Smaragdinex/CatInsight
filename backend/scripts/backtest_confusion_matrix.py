"""新模型回測 + 混淆矩陣圖

用法：
    python scripts/backtest_confusion_matrix.py --start 2026-03-01 --hold 70 --train_end 2026-03-01
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np
import pandas as pd
from sklearn.metrics import confusion_matrix, classification_report

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backtest_lambdamart import _build_features_as_of
from market_context import load_market_context
from train_classifier_xgb import (
    ANALYST_DIR, FUNDAMENTALS_DIR, HISTORY_10Y_DIR, HISTORY_1Y_DIR,
    _load_fundamentals, load_analyst_cache,
)
from train_ranker_xgb import FEATURE_COLS
from rank_today_fast import EXCLUDE_SYMBOLS

MODELS_DIR   = BASE_DIR / "models"
EARNINGS_DIR = BASE_DIR / "data" / "earnings"
OUTPUT_DIR   = BASE_DIR / "data"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start",     default="2026-03-01")
    parser.add_argument("--hold",      type=int, default=70)
    parser.add_argument("--top",       type=int, default=20)
    parser.add_argument("--train_end", default=None)
    parser.add_argument("--win_thresh",type=float, default=0.10, help="漲幅超過此值算「猜中」(default: 10%%)")
    parser.add_argument("--benchmark", default="SPY")
    args = parser.parse_args()

    suffix     = f"_{args.train_end[:7].replace('-','')}" if args.train_end else ""
    model_path = MODELS_DIR / f"ranker_lambdamart_h1{suffix}.joblib"
    if not model_path.exists():
        print(f"[error] 模型不存在: {model_path}"); return 1

    bundle      = joblib.load(model_path)
    ranker      = bundle["model"]
    meta        = bundle["metadata"]
    clip_bounds = meta.get("clipBounds", {})
    log_features = {"volume_ratio", "atr_ratio", "avg_volume_20"}
    print(f"[model] trainEnd={meta['trainEnd']}  NDCG@10={meta['testNDCG10']:.4f}", flush=True)

    # ── 載入資料 ──────────────────────────────────────────────────────────
    print("[data] 載入資料...", flush=True)
    history_dir    = HISTORY_10Y_DIR if HISTORY_10Y_DIR.exists() else HISTORY_1Y_DIR
    market_context = load_market_context(history_dir)
    fundamentals   = _load_fundamentals(FUNDAMENTALS_DIR)
    analyst_cache  = load_analyst_cache(ANALYST_DIR)
    from earnings_features import load_earnings_cache
    earnings_cache = load_earnings_cache(EARNINGS_DIR)

    all_sym_rows: dict[str, list[dict]] = {}
    for path in sorted(history_dir.glob("*.json")):
        sym = path.stem.upper()
        if sym in EXCLUDE_SYMBOLS: continue
        try:
            items = sorted(
                [x for x in json.loads(path.read_text()) if isinstance(x, dict) and x.get("date") and x.get("close")],
                key=lambda x: x["date"]
            )
            if items: all_sym_rows[sym] = items
        except Exception: continue

    # 找進場 / 出場日
    all_dates = sorted({x["date"] for rows in all_sym_rows.values() for x in rows})
    entry_date = next((d for d in all_dates if d >= args.start), None)
    future     = [d for d in all_dates if d > entry_date]
    exit_date  = future[args.hold - 1] if len(future) >= args.hold else future[-1]
    print(f"[backtest] 進場={entry_date}  出場={exit_date}", flush=True)

    # ── 建 features & 預測排名 ────────────────────────────────────────────
    print("[feat] 計算 features...", flush=True)
    records = []
    for sym, items in all_sym_rows.items():
        feat = _build_features_as_of(sym, items, entry_date, market_context,
                                     fundamentals, analyst_cache, earnings_cache)
        if feat: records.append(feat)

    df = pd.DataFrame(records)
    X  = df[FEATURE_COLS].fillna(0.0).copy()
    for col, bounds in clip_bounds.items():
        if col not in X.columns: continue
        lo, hi = bounds.get("lo"), bounds.get("hi")
        if lo is not None and hi is not None:
            X[col] = X[col].clip(lower=lo, upper=hi)
    for col in log_features:
        if col in X.columns:
            X[col] = np.log1p(X[col].clip(lower=0))

    df["rank_score"] = ranker.predict(X)
    df = df.sort_values("rank_score", ascending=False).reset_index(drop=True)
    df["rank"]       = df.index + 1
    df["predicted"]  = (df["rank"] <= args.top).astype(int)   # 1=BUY, 0=NOT BUY

    # ── 查真實出場價格 ────────────────────────────────────────────────────
    exit_map: dict[str, float] = {}
    for sym, items in all_sym_rows.items():
        rows = [x for x in items if x["date"] <= exit_date and x["date"] > entry_date]
        if rows: exit_map[sym] = float(rows[-1]["close"])

    df["price_entry"] = df["symbol"].map(
        lambda s: next((float(x["close"]) for x in reversed(all_sym_rows.get(s,[])) if x["date"] <= entry_date), None)
    )
    df["price_exit"]  = df["symbol"].map(exit_map)
    df["actual_return"] = (df["price_exit"] - df["price_entry"]) / df["price_entry"]

    # SPY 基準
    spy_entry = market_context.get(args.benchmark,{}).get(entry_date,{}).get("close")
    spy_rows  = {d:v for d,v in market_context.get(args.benchmark,{}).items() if d<=exit_date and d>entry_date}
    spy_exit  = market_context.get(args.benchmark,{}).get(max(spy_rows),{}).get("close") if spy_rows else None
    bm_return = (spy_exit-spy_entry)/spy_entry if spy_entry and spy_exit else 0.0

    # ── 定義「猜中」= actual_return > win_thresh ───────────────────────────
    df_valid = df.dropna(subset=["actual_return"]).copy()
    df_valid["actual"] = (df_valid["actual_return"] >= args.win_thresh).astype(int)  # 1=WIN

    y_pred = df_valid["predicted"].values
    y_true = df_valid["actual"].values

    # ── 混淆矩陣 ─────────────────────────────────────────────────────────
    cm = confusion_matrix(y_true, y_pred, labels=[1, 0])
    # 行=實際, 列=預測
    # [TP FP]   [實際WIN  預測BUY=TP,  預測NOT=FN]
    # [FN TN]   [實際LOSE 預測BUY=FP,  預測NOT=TN]
    TP = cm[0][1]; FN = cm[0][0]
    FP = cm[1][1]; TN = cm[1][0]

    precision = TP / (TP + FP) if (TP + FP) > 0 else 0
    recall    = TP / (TP + FN) if (TP + FN) > 0 else 0
    f1        = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
    accuracy  = (TP + TN) / len(df_valid)

    top20     = df_valid[df_valid["predicted"] == 1]
    avg_ret   = float(top20["actual_return"].mean()) if not top20.empty else 0.0
    win_rate  = float((top20["actual_return"] > 0).mean()) if not top20.empty else 0.0

    # ── 畫圖 ─────────────────────────────────────────────────────────────
    fig = plt.figure(figsize=(16, 10))
    fig.patch.set_facecolor("#0d1117")

    gs = fig.add_gridspec(2, 2, hspace=0.45, wspace=0.35,
                          left=0.07, right=0.97, top=0.88, bottom=0.08)
    ax_cm   = fig.add_subplot(gs[0, 0])
    ax_bar  = fig.add_subplot(gs[0, 1])
    ax_rank = fig.add_subplot(gs[1, :])

    title = (f"LambdaMART 回測  進場:{entry_date} → 出場:{exit_date}  "
             f"漲幅門檻:{args.win_thresh:.0%}  TOP {args.top}")
    fig.suptitle(title, fontsize=13, color="white", fontweight="bold", y=0.96)

    # ── 1. 混淆矩陣 heatmap ──────────────────────────────────────────────
    cm_disp = np.array([[TP, FN], [FP, TN]])
    labels  = [["TP\n猜買且真漲", "FN\n猜不買但真漲"],
               ["FP\n猜買但沒漲", "TN\n猜不買且沒漲"]]
    colors  = [["#1a7a4a", "#8b0000"], ["#8b4500", "#1a3a6a"]]

    for i in range(2):
        for j in range(2):
            ax_cm.add_patch(plt.Rectangle([j, 1-i], 1, 1,
                            color=colors[i][j], alpha=0.85))
            val = cm_disp[i][j]
            ax_cm.text(j+0.5, 1.5-i, f"{val}",
                       ha="center", va="center", fontsize=22,
                       color="white", fontweight="bold")
            ax_cm.text(j+0.5, 1.15-i, labels[i][j],
                       ha="center", va="center", fontsize=8.5, color="#cccccc")

    ax_cm.set_xlim(0, 2); ax_cm.set_ylim(0, 2)
    ax_cm.set_xticks([0.5, 1.5]); ax_cm.set_xticklabels(["預測 BUY", "預測 NOT BUY"],
                                                          color="white", fontsize=10)
    ax_cm.set_yticks([0.5, 1.5]); ax_cm.set_yticklabels(["實際 未漲", "實際 漲>10%"],
                                                          color="white", fontsize=10, rotation=90, va="center")
    ax_cm.tick_params(colors="white")
    for spine in ax_cm.spines.values(): spine.set_edgecolor("#444")
    ax_cm.set_facecolor("#0d1117")
    ax_cm.set_title("混淆矩陣", color="white", fontsize=11, pad=10)

    stats_text = (f"Precision: {precision:.1%}  |  Recall: {recall:.1%}\n"
                  f"F1: {f1:.3f}  |  Accuracy: {accuracy:.1%}\n"
                  f"TOP{args.top}平均報酬: {avg_ret:+.1%}  |  SPY: {bm_return:+.1%}")
    ax_cm.text(1.0, -0.08, stats_text, transform=ax_cm.transAxes,
               ha="center", va="top", fontsize=9, color="#aaaaaa",
               bbox=dict(boxstyle="round,pad=0.4", facecolor="#1a1f2e", edgecolor="#444"))

    # ── 2. TOP 20 個別漲跌長條圖 ─────────────────────────────────────────
    top20_sorted = top20.sort_values("actual_return", ascending=True)
    colors_bar   = ["#e05050" if r < 0 else "#4caf50" for r in top20_sorted["actual_return"]]
    bars = ax_bar.barh(range(len(top20_sorted)), top20_sorted["actual_return"] * 100,
                       color=colors_bar, edgecolor="#222", height=0.7)
    ax_bar.axvline(bm_return * 100, color="#f0c040", linewidth=1.5,
                   linestyle="--", label=f"SPY {bm_return:+.1%}")
    ax_bar.axvline(0, color="#666", linewidth=0.8)

    syms = top20_sorted["symbol"].tolist()
    rets = (top20_sorted["actual_return"] * 100).tolist()
    ax_bar.set_yticks(range(len(syms)))
    ax_bar.set_yticklabels([f"{s}  {r:+.0f}%" for s, r in zip(syms, rets)],
                            color="white", fontsize=8)
    ax_bar.set_xlabel("實際報酬 (%)", color="white", fontsize=9)
    ax_bar.set_title(f"TOP {args.top} 個別漲跌", color="white", fontsize=11, pad=10)
    ax_bar.set_facecolor("#0d1117")
    ax_bar.tick_params(colors="white")
    ax_bar.xaxis.label.set_color("white")
    for spine in ax_bar.spines.values(): spine.set_edgecolor("#444")
    ax_bar.legend(fontsize=8, facecolor="#1a1f2e", labelcolor="white",
                  edgecolor="#444", loc="lower right")

    # ── 3. 全部股票散點圖（排名 vs 實際報酬）────────────────────────────
    all_valid = df_valid.copy()
    c_scatter = ["#f44336" if p == 1 and a == 0 else
                 "#4caf50" if p == 1 and a == 1 else
                 "#555555"
                 for p, a in zip(all_valid["predicted"], all_valid["actual"])]

    ax_rank.scatter(all_valid["rank"], all_valid["actual_return"] * 100,
                    c=c_scatter, s=18, alpha=0.7, linewidths=0)
    ax_rank.axhline(args.win_thresh * 100, color="#f0c040", linewidth=1,
                    linestyle="--", label=f"漲幅門檻 {args.win_thresh:.0%}")
    ax_rank.axhline(bm_return * 100, color="#60aaff", linewidth=1,
                    linestyle=":", label=f"SPY {bm_return:+.1%}")
    ax_rank.axvline(args.top + 0.5, color="#ffffff", linewidth=1.2,
                    linestyle="--", alpha=0.5, label=f"TOP {args.top} 邊界")
    ax_rank.set_xlabel("排名（越左越好）", color="white", fontsize=9)
    ax_rank.set_ylabel("實際報酬 (%)", color="white", fontsize=9)
    ax_rank.set_title("全部股票：排名 vs 實際報酬", color="white", fontsize=11, pad=10)
    ax_rank.set_facecolor("#0d1117")
    ax_rank.tick_params(colors="white")
    for spine in ax_rank.spines.values(): spine.set_edgecolor("#444")

    # 標注 TOP 20 的名字
    for _, row in df_valid[df_valid["predicted"] == 1].iterrows():
        ax_rank.annotate(row["symbol"],
                         xy=(row["rank"], row["actual_return"] * 100),
                         fontsize=6.5, color="white", alpha=0.85,
                         xytext=(3, 3), textcoords="offset points")

    legend_handles = [
        mpatches.Patch(color="#4caf50", label="TOP20 猜中 (TP)"),
        mpatches.Patch(color="#f44336", label="TOP20 猜錯 (FP)"),
        mpatches.Patch(color="#555555", label="未選入"),
    ]
    ax_rank.legend(handles=legend_handles + [
        plt.Line2D([0],[0], color="#f0c040", linestyle="--", label=f"漲幅門檻 {args.win_thresh:.0%}"),
        plt.Line2D([0],[0], color="#60aaff", linestyle=":", label=f"SPY {bm_return:+.1%}"),
        plt.Line2D([0],[0], color="white", linestyle="--", alpha=0.5, label=f"TOP{args.top}邊界"),
    ], fontsize=8, facecolor="#1a1f2e", labelcolor="white", edgecolor="#444",
       loc="upper right", ncol=2)

    out_path = OUTPUT_DIR / f"backtest_confusion_{entry_date}.png"
    plt.savefig(out_path, dpi=150, bbox_inches="tight", facecolor="#0d1117")
    print(f"\n[saved] {out_path}", flush=True)

    # ── 印文字結果 ────────────────────────────────────────────────────────
    print(f"\n{'='*80}")
    print(f"📊 回測  進場:{entry_date} → 出場:{exit_date}  漲幅門檻:{args.win_thresh:.0%}")
    print(f"{'='*80}")
    print(f"  混淆矩陣: TP={TP}  FP={FP}  FN={FN}  TN={TN}")
    print(f"  Precision(選到且漲): {precision:.1%}")
    print(f"  Recall(有漲被選到):  {recall:.1%}")
    print(f"  F1:                  {f1:.3f}")
    print(f"  Accuracy:            {accuracy:.1%}")
    print(f"  TOP{args.top}平均報酬: {avg_ret:+.1%}  (SPY: {bm_return:+.1%}  超額: {avg_ret-bm_return:+.1%})")

    print(f"\n{'─'*50}")
    print(f"  TOP {args.top} 排名明細")
    print(f"  {'#':<4} {'SYM':<8} {'進場價':>8}  {'出場價':>8}  {'漲幅':>9}  {'結果'}")
    print(f"  {'-'*55}")
    for _, row in df[df["predicted"]==1].sort_values("rank").iterrows():
        ret = row.get("actual_return")
        ret_str = f"{ret:>+8.1%}" if pd.notna(ret) else "      N/A"
        result  = "✅ 猜中" if pd.notna(ret) and ret >= args.win_thresh else "❌ 猜錯"
        ep = f"{row['price_entry']:>8.2f}" if pd.notna(row.get('price_entry')) else "     N/A"
        xp = f"{row['price_exit']:>8.2f}" if pd.notna(row.get('price_exit')) else "     N/A"
        print(f"  {int(row['rank']):<4} {row['symbol']:<8} {ep}  {xp}  {ret_str}  {result}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
