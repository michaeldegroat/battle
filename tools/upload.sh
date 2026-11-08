#!/usr/bin/env bash
# upload.sh <controller.js> <label>  -- smoke-tested upload; becomes the active (cup) version on success
set -euo pipefail
. "$(dirname "$0")/auth.sh"
src="$1"; label="$2"; tmp=$(mktemp)
python3 -I -c "import json,sys;print(json.dumps({'label':sys.argv[1],'source':open(sys.argv[2]).read()}))" "$label" "$src" > "$tmp"
curl -sS -A curl/8 -X POST "$API/api/bots/$BOT/versions" -H "Authorization: $AUTH" -H 'content-type: application/json' --data-binary @"$tmp" -w '\nHTTP %{http_code}\n'
rm -f "$tmp"
