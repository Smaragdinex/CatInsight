"""重新評估線上用的「買 / 不買」分類器(models/action_classifier_xgb.joblib),不重新訓練。

用和訓練一樣的樣本建法(train_classifier_xgb._build_samples)、和推論一樣的前處理(模型裡存的 clipBounds + logFeatures),
在兩段期間算指標:
  A. 原本的測試期:模型 metadata 的 testStart 到模型建立日之前(重現當初的數字)
  B. 模型建立之後的新資料:模型檔日期(2026-06)之後到最新有答案的日子,模型完全沒看過

指標除了準確率,也列出「全部猜不買」的基準、該買的抓到率(recall)、喊買時的命中率(precision)與相對基準的倍數、
AUC,以及把買進機率排前 10% 的樣本裡真正大漲的比例 —— 看機率本身有沒有排序價值。
結果寫到 models/action_classifier_xgb.eval.json。

Run: python scripts/eval_classifier_xgb.py
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, confusion_matrix, roc_auc_score

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))
sys.path.insert(0, str(BASE_DIR / "scripts"))

import train_classifier_xgb as T  # noqa: E402
from market_context import load_market_context  # noqa: E402

MODEL_PATH = BASE_DIR / "models" / "action_classifier_xgb.joblib"
OUT_PATH = BASE_DIR / "models" / "action_classifier_xgb.eval.json"


def preprocess(X: pd.DataFrame, clip_bounds: dict, log_features: list[str]) -> pd.DataFrame:
    X = X.copy()
    for col, b in clip_bounds.items():
        if col in X.columns and b.get("lo") is not None:
            X[col] = X[col].clip(lower=b["lo"], upper=b["hi"])
    for col in log_features:
        if col in X.columns:
            X[col] = np.log1p(X[col].clip(lower=0))
    return X


def metrics(name: str, df: pd.DataFrame, prob_buy: np.ndarray, pred: np.ndarray) -> dict:
    y = (df["label"] == "Buy").astype(int).values
    n, pos = len(y), int(y.sum())
    base_rate = pos / n
    cm = confusion_matrix(y, pred, labels=[1, 0])          # [[買→買, 買→不買], [不買→買, 不買→不買]]
    tp, fn, fp = int(cm[0][0]), int(cm[0][1]), int(cm[1][0])
    precision = tp / (tp + fp) if tp + fp else 0.0
    top = np.argsort(-prob_buy)[: max(1, n // 10)]
    out = {
        "period": name,
        "from": str(df["date"].min()), "to": str(df["date"].max()),
        "rows": n, "symbols": int(df["symbol"].nunique()) if "symbol" in df else None,
        "buyRate": round(base_rate, 4),
        "accuracy": round(float(accuracy_score(y, pred)), 4),
        "allNotBuyAccuracy": round(1 - base_rate, 4),
        "buyRecall": round(tp / pos, 4) if pos else None,
        "buyPrecision": round(precision, 4),
        "buyPrecisionLift": round(precision / base_rate, 2) if base_rate else None,
        "predictedBuyShare": round((tp + fp) / n, 4),
        "auc": round(float(roc_auc_score(y, prob_buy)), 4) if 0 < pos < n else None,
        "top10pctBuyRate": round(float(y[top].mean()), 4),
        "top10pctLift": round(float(y[top].mean()) / base_rate, 2) if base_rate else None,
        "confusionMatrix": {"labels": ["Buy", "NotBuy"], "rowsAreActual": True, "matrix": cm.tolist()},
    }
    return out


def main() -> int:
    bundle = joblib.load(MODEL_PATH)
    model, meta = bundle["model"], bundle["metadata"]
    feats, clip_bounds, log_features = meta["featureNames"], meta.get("clipBounds") or {}, meta.get("logFeatures") or []
    model_date = date.fromtimestamp(MODEL_PATH.stat().st_mtime)
    print(f"model: trained to {meta['trainEnd']}, test from {meta['testStart']}, file date {model_date}", flush=True)

    print("building samples (same as training) ...", flush=True)
    df = T._build_samples(T._load_history_rows_from_dir(T.HISTORY_10Y_DIR),
                          market_context=load_market_context(T.HISTORY_10Y_DIR),
                          fundamentals=T._load_fundamentals(T.FUNDAMENTALS_DIR),
                          analyst_cache=T.load_analyst_cache(T.ANALYST_DIR))
    df["date"] = df["date"].astype(str)
    print(f"samples: {len(df)}  ({df['date'].min()} ~ {df['date'].max()})", flush=True)

    periods = {
        "A_original_test": df[(df["date"] >= meta["testStart"]) & (df["date"] < model_date.isoformat())],
        "B_after_model_built": df[df["date"] >= model_date.isoformat()],
    }
    results = []
    for name, part in periods.items():
        if part.empty:
            print(f"{name}: no rows", flush=True); continue
        X = preprocess(part[feats].fillna(0.0), clip_bounds, log_features)
        prob = model.predict_proba(X)[:, list(model.classes_).index(bundle["labelMap"]["Buy"])]
        pred = (prob >= 0.5).astype(int)
        m = metrics(name, part, prob, pred)
        results.append(m)
        print(json.dumps(m, ensure_ascii=False), flush=True)

    payload = {
        "evaluatedAt": datetime.now().isoformat(timespec="seconds"),
        "model": str(MODEL_PATH.name),
        "label": f"Buy = 隔日報酬 >= {meta['buyThreshold']:.1%}(和訓練相同)",
        "trainEnd": meta["trainEnd"], "testStart": meta["testStart"], "modelFileDate": model_date.isoformat(),
        "storedAtTraining": {"accuracy": meta["accuracy"], "buyRecall": meta["classificationReport"]["Buy"]["recall"],
                             "buyPrecision": meta["classificationReport"]["Buy"]["precision"], "testRows": meta["testRows"]},
        "results": results,
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"saved → {OUT_PATH}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
