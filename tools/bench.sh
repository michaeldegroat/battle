#!/usr/bin/env bash
# bench.sh <bot> <version> <seeds> [first_seed]
#   Unrated scrimmages of <bot>@<version> vs the live mdeg-armor on <seeds> fixed maps (2 games each,
#   sides swapped), then a tally. Each map costs 1 of the account's 60 scrimmages per day.
#   Candidates go on mdeg-lab; use "mdeg-armor <old label>" as a control.
set -euo pipefail
. "$(dirname "$0")/auth.sh"
bot=$1; ver=$2; n=$3; s0=${4:-910000}
out="$(dirname "$0")/../replays/bench-$bot-$ver"; mkdir -p "$out"; : > "$out/ids.txt"
for i in $(seq 0 $((n-1))); do
  seed=$((s0+i*7919))
  for try in $(seq 1 12); do
    r=$(curl -sS -A curl/8 -X POST "$API/api/scrimmage" -H "Authorization: $AUTH" -H 'content-type: application/json' \
        -d "{\"bot\":\"$bot\",\"version\":\"$ver\",\"vs\":\"mdeg-armor\",\"seed\":$seed}")
    id=$(echo "$r" | python3 -I -c "import json,sys;print(json.load(sys.stdin).get('match_id',''))")
    [ -n "$id" ] && { echo "$id $seed" >> "$out/ids.txt"; break; }
    echo "$r" | grep -q 'rate\|busy' || { echo "refused: $r" >&2; break; }
    sleep 20
  done
  sleep 13
done
for id in $(awk '{print $1}' "$out/ids.txt"); do
  for k in $(seq 1 60); do
    s=$(curl -sS -A curl/8 "$API/api/matches/$id"); [ "$(echo "$s" | python3 -I -c "import json,sys;print(json.load(sys.stdin).get('status'))")" = done ] && break; sleep 15
  done
  echo "$s" > "$out/$id.json"
done
python3 -I - "$out" <<'PY'
import json,glob,sys
w=l=d=0; f=h=of=oh=0
for p in glob.glob(sys.argv[1]+'/scr_*.json'):
  m=json.load(open(p))
  for g in m.get('games',[]):
    if g['winner']==0: w+=1
    elif g['winner']==1: l+=1
    else: d+=1
  a,b=m['stats']; f+=a['fires']; h+=a['hits']; of+=b['fires']; oh+=b['hits']
n=w+l+d
print(f"{sys.argv[1].split('bench-')[1]} vs mdeg-armor(live): games {n}  W-L-D {w}-{l}-{d}  score {100*(w+d/2)/max(1,n):.1f}%  hit rate {100*h/max(1,f):.0f}% vs {100*oh/max(1,of):.0f}%")
PY
