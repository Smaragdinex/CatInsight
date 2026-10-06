#!/bin/bash
# 多代自我對弈(參考 AlphaZero):每一代
#   1. 純自我對弈:桌上全部是 az(多層 open-loop MCTS + 目前最好的策略 / 價值網路),28 個行程各 GAMES 局
#   2. 用最近 3 代的自我對弈資料重新訓練:策略網路學 MCTS 的搜尋次數分布、價值網路學最後輸贏
#   3. 新網路(az)和目前最好的網路(azb)單挑 560 局,勝率 >= GATE% 才採用
#   4. 目前最好的網路和困難電腦(mc)單挑、三方同桌各 560 局,記錄勝率曲線
# 用法:tools/nn/selfplay-loop.sh   (GENS 幾代、GAMES 每個行程幾局、START 起點網路的資料夾)
cd "$(dirname "$0")/../.."
GENS=${GENS:-5}; GAMES=${GAMES:-40}; GATE=${GATE:-52}; START=${START:-tools/nn/models/gen1}
PY=${PY:-python3}; LOG=tools/nn/selfplay-log.txt
winpct() { awk -v who="$1" '$1 == who && $2 == "win" { gsub("%", "", $3); print $3; exit }'; }
bench() {   # $1 = 網路資料夾 → "對 mc 單挑 az 勝率 / 三方 rule ev az"
  local h=$(NN_DIR=$1 tools/ladder.sh 14 40 "mc,az" | winpct az)
  local t=$(NN_DIR=$1 tools/ladder.sh 14 40 "rule,ev,az")
  echo "單挑 mc:az $h% | 三方:rule $(echo "$t" | winpct rule)% ev $(echo "$t" | winpct ev)% az $(echo "$t" | winpct az)%"
}
BEST=$START
echo "=== $(date '+%F %T') 開始:起點 $START,每代自我對弈 $((GAMES * 28)) 局,門檻 $GATE%" | tee -a $LOG
echo "第 0 代(起點)  $(bench $BEST)" | tee -a $LOG
for g in $(seq 1 $GENS); do
  t0=$(date +%s); D=tools/nn/data/self$g; rm -rf $D; mkdir -p $D
  for i in $(seq 1 28); do MIX=self POLICY=$BEST/nn-policy.json VALUE=$BEST/nn-value.json node tools/nn/gen-data.mjs $GAMES $((g * 100003 + i * 7919)) $D/part$i.bin > $D/part$i.log 2>&1 & done; wait
  rows=$(cat $D/part*.log | awk '{r += $3} END {print r}')
  DIRS=$(for j in $(seq $((g > 2 ? g - 2 : 1)) $g); do echo -n "tools/nn/data/self$j "; done)
  NEW=tools/nn/models/self$g
  train=$(OUT=$NEW $PY tools/nn/train_az.py $DIRS 2>&1 | grep -E "^策略|^價值網路:" | tr '\n' ' ')
  gate=$(NN_DIR=$NEW NNB_DIR=$BEST tools/ladder.sh 14 40 "az,azb" | winpct az)
  if awk -v w="$gate" -v t="$GATE" 'BEGIN { exit !(w >= t) }'; then BEST=$NEW; verdict="採用"; else verdict="不採用(維持 $BEST)"; fi
  echo "第 $g 代  自我對弈 $((GAMES * 28)) 局 / $rows 筆;$train" | tee -a $LOG
  echo "        新 vs 目前最好 單挑:新 $gate% → $verdict" | tee -a $LOG
  echo "        目前最好($BEST)$(bench $BEST)  [$(( $(date +%s) - t0 ))s]" | tee -a $LOG
done
echo "=== $(date '+%F %T') 結束,最好的網路:$BEST" | tee -a $LOG
