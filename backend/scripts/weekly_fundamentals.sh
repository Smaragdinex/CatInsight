#!/bin/bash
# 每週更新選股模型用的基本面資料:財報(EPS 驚喜)→ 季報(TTM)→ 年報 → 分析師評等
# 建議每週排程一次(例如週六 03:00,在每日排名之前),macOS 可用 launchd、Linux 可用 cron。
# 財報用 yfinance(FMP 的財報行事曆目前抓不到資料)。每支腳本抓失敗都會保留舊資料,一支失敗不影響下一支。手動跑:bash scripts/weekly_fundamentals.sh
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"   # 這個腳本所在的 backend 資料夾
PY="${PY:-python3}"
LOG="$REPO/logs/weekly_fundamentals.log"

mkdir -p "$REPO/logs"
cd "$REPO"

{
  echo "===== $(date '+%Y-%m-%d %H:%M:%S') weekly_fundamentals start ====="
  echo "[1/4] 財報日期與 EPS 驚喜..."
  "$PY" scripts/fetch_earnings.py --provider yfinance | tail -3 || echo "WARN: fetch_earnings 失敗"
  echo "[2/4] 季報(TTM 營收、淨利)..."
  "$PY" scripts/fetch_fundamentals_quarterly.py | grep -E "ERROR|保留|Done" || echo "WARN: fetch_fundamentals_quarterly 失敗"
  echo "[3/4] 年報..."
  "$PY" scripts/fetch_fundamentals.py | grep -E "ERROR|kept|Done" || echo "WARN: fetch_fundamentals 失敗"
  echo "[4/4] 分析師評等與目標價..."
  "$PY" scripts/fetch_analyst_ratings.py | grep -E "kept|ERROR" | tail -20
  echo "===== $(date '+%Y-%m-%d %H:%M:%S') done ====="
} >> "$LOG" 2>&1
