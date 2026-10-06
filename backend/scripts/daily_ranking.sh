#!/bin/bash
# 每日選股排名:更新最新歷史價 → 重算 LambdaMART 排名 → 寫出 ranking_latest.json(供 API /ranking 端點)
# 由 cron 在美股收盤後執行。手動跑:bash scripts/daily_ranking.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"   # 這個腳本所在的 backend 資料夾
PY="${PY:-python3}"
LOG="$REPO/logs/daily_ranking.log"

mkdir -p "$REPO/logs"
cd "$REPO"

{
  echo "===== $(date '+%Y-%m-%d %H:%M:%S') daily_ranking start ====="
  echo "[1/4] 更新最新歷史價..."
  "$PY" scripts/update_history_latest.py || echo "WARN: update_history_latest 失敗,改用既有資料繼續"
  echo "[2/4] 重算排名並寫出 ranking_latest.json..."
  "$PY" scripts/rank_today_fast.py --top 20 --out ranking_latest.json
  echo "[3/4] 重建漲幅榜(廣宇宙,與模型宇宙分離)..."
  "$PY" scripts/build_gainers.py || echo "WARN: build_gainers 失敗,保留舊漲幅榜"
  echo "[4/4] SNDK/MU RSI/MFI 監控..."
  "$PY" scripts/monitor_sndk.py || echo "WARN: monitor_sndk 失敗"
  "$PY" scripts/monitor_sndk.py --symbol MU || echo "WARN: monitor MU 失敗"
  "$PY" scripts/monitor_sndk.py --symbol MRVL || echo "WARN: monitor MRVL 失敗"
  "$PY" scripts/monitor_sndk.py --symbol AAPL || echo "WARN: monitor AAPL 失敗"
  "$PY" scripts/monitor_sndk.py --symbol WDC || echo "WARN: monitor WDC 失敗"
  "$PY" scripts/monitor_sndk.py --symbol STX || echo "WARN: monitor STX 失敗"
  "$PY" scripts/daily_digest.py || echo "WARN: daily_digest 推播失敗"
  echo "===== done ====="
} >> "$LOG" 2>&1
