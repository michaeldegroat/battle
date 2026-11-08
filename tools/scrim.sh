#!/usr/bin/env bash
# scrim.sh <seed> <opponent>...  -- unrated two-game scrimmages; prints match ids (5/min, 60/day)
set -euo pipefail
. "$(dirname "$0")/auth.sh"
seed=$1; shift
for b in "$@"; do
  for n in 1 2 3 4 5 6; do
    r=$(curl -sS -A curl/8 -X POST "$API/api/scrimmage" -H "Authorization: $AUTH" -H 'content-type: application/json' -d "{\"bot\":\"$BOT\",\"vs\":\"$b\",\"seed\":$seed}")
    id=$(echo "$r" | python3 -I -c "import json,sys;print(json.load(sys.stdin).get('match_id',''))")
    [ -n "$id" ] && { echo "$id"; break; }
    echo "retry ($b): $r" >&2; sleep 30
  done
  seed=$((seed+1)); sleep 13
done
