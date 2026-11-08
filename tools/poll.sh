#!/usr/bin/env bash
# poll.sh <match_id>...  -- wait for matches to finish, save JSON + both replays to replays/
set -euo pipefail
. "$(dirname "$0")/auth.sh"
out="$(dirname "$0")/../replays"; mkdir -p "$out"
for id in "$@"; do
  for n in $(seq 1 60); do
    s=$(curl -sS -A curl/8 "$API/api/matches/$id")
    [ "$(echo "$s" | python3 -I -c "import json,sys;print(json.load(sys.stdin).get('status'))")" = done ] && break; sleep 15
  done
  echo "$s" > "$out/$id.json"
  for g in 1 2; do curl -sS -A curl/8 "$API/api/replays/$id.jsonl?game=$g" -o "$out/$id-$g.jsonl"; done
  echo "$s" | python3 -I -c "
import json,sys;m=json.load(sys.stdin);me=0 if m['a']['bot']=='$BOT' else 1;opp=m['b' if me==0 else 'a']['bot']
print(m['id'],'vs',opp,[('W' if g['winner']==me else 'L' if g['winner']==1-me else 'D',g['reason'],g['score']) for g in m['games']])"
done
