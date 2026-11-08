#!/usr/bin/env bash
# losses.sh [limit]  -- recent ranked sets with result per version; downloads replays of lost sets
set -euo pipefail
. "$(dirname "$0")/auth.sh"
out="$(dirname "$0")/../replays"; mkdir -p "$out"
curl -sS -A curl/8 "$API/api/matches?bot=$BOT&limit=${1:-100}" > "$out/recent.json"
python3 -I - "$BOT" "$out/recent.json" <<'PY' > "$out/lost_ids.txt"
import json,sys; from collections import Counter
bot,f=sys.argv[1],sys.argv[2]; d=json.load(open(f)); ms=d.get('matches',d); c=Counter()
for m in ms:
    me=0 if m['a']['bot']==bot else 1; ver=m['a' if me==0 else 'b'].get('version'); opp=m['b' if me==0 else 'a']['bot']
    res='W' if m.get('winner')==me else 'L' if m.get('winner')==1-me else 'D'; c[(ver,m.get('ladder'),res)]+=1
    if res!='W': print(m['id'], opp, m.get('ladder'), res)
for k,v in sorted(c.items(), key=str): print('#',k,v, file=sys.stderr)
PY
cat "$out/lost_ids.txt"
while read -r id _; do for g in 1 2; do [ -s "$out/$id-$g.jsonl" ] || curl -sS -A curl/8 "$API/api/replays/$id.jsonl?game=$g" -o "$out/$id-$g.jsonl"; done; done < "$out/lost_ids.txt"
