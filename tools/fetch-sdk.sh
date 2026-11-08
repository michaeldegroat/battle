#!/usr/bin/env bash
# Download the arena engine and local test harness next to the tools.
set -euo pipefail
cd "$(dirname "$0")"
for f in arena-sim.mjs local-test.mjs; do curl -fsS -A curl/8 -o "$f" "https://api.battle.training/sdk/$f"; done
echo "SDK fetched: $(head -c 60 local-test.mjs | tr -d '\n')..."
