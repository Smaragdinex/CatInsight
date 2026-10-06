#!/bin/zsh
# 雙週前20報告：2025-12-01 起每月兩次到 2026-05-15，用 train_end 2025-11-30 模型
cd "$(dirname "$0")/.."
DATES=(2025-12-01 2025-12-15 2026-01-01 2026-01-15 2026-02-01 2026-02-15 2026-03-01 2026-03-15 2026-04-01 2026-04-15 2026-05-01 2026-05-15)
OUT=/tmp/biweekly_out
mkdir -p $OUT
for d in $DATES; do
  python3 scripts/backtest_lambdamart.py --start $d --hold 90 --top 20 --train_end 2025-11-30 > $OUT/$d.txt 2>&1
  echo "done $d"
done
echo "ALL_DONE"
