#!/bin/bash
# 平行跑 eval-mc:par.sh <procs> <games/proc> <n> <depth> <z>  → 合併勝率
P=$1; G=$2; N=$3; DP=$4; Z=$5
for i in $(seq 1 $P); do node "$(dirname "$0")/eval-mc.mjs" $G $N $DP $Z $((1000+i*17)) & done | awk -v g=$G '{ split($0,a,"mc win "); split(a[2],b,"%"); w+=b[1]*g/100; t+=g; split($0,c,"avg lead \\$"); split(c[2],d,","); l+=d[1]*g } END { p=w/t; printf "n=%s depth=%s z=%s  mc win %.1f%% ± %.1f over %d games, avg lead $%d\n", "'$N'", "'$DP'", "'$Z'", 100*p, 100*sqrt(p*(1-p)/t), t, l/t }'
