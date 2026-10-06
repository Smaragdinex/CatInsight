#!/bin/bash
# 平行跑同一桌很多局:ladder.sh <procs> <games/proc> "rule,ev,mc"  → 每個座位的合併勝率與平均資產(每個行程寫自己的檔,不會交錯)
P=$1; G=$2; SPEC=$3; T=$(mktemp -d)
for i in $(seq 1 $P); do SEED=$((5000+i*31)) node "$(dirname "$0")/tournament.mjs" $G 20 120 3 lead "$SPEC" > "$T/$i.txt" & done; wait
cat "$T"/*.txt | grep " win " | awk -v g=$G -v spec="$SPEC" 'BEGIN{n=split(spec,s,",")} { k=(NR-1)%n; name[k]=$1; w[k]+=$3*g/100; v=$6; gsub(/[$,]/,"",v); A[k]+=v*g; c[k]+=g } END { printf "%s (%d games)\n", spec, c[0]; for(i=0;i<n;i++) printf "  %-5s win %5.1f%%  avg $%d\n", name[i], 100*w[i]/c[i], A[i]/c[i] }'
rm -r "$T"
