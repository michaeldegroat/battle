# Notes: mdeg-armor

## Live version

**v5** (uploaded 2026-11-08). Draft 3×MBT.

## How the controller works (v5)

- `hello()`: terrain-cost Dijkstra field per objective and to the enemy spawn (uphill slowdown from the
  engine: speed × (1 − dh/40), min 0.3; tiles next to obstacles cost more). Objectives classified as
  **home** (nearest to our spawn), **centre** (map centre, weight 1, about half the maps), **away**.
  Approach direction per objective = where the enemy's path arrives from.
- **Modes**: `hold` = whole squad on home, guns screening towards the approach direction.
  `attack` = whole squad to the enemy-held objective with most weight (hysteresis), only when the
  points projection (lead + rate difference × remaining ticks) says we lose, and only after holding home
  `holdFirst` ticks or after `attackLate`. Losing on points is a loss anyway, so attacking then is free.
- **Movement**: follow the field; lookahead picks the farthest waypoint with a hull-wide clear line (fixes
  getting stuck on plateau rims). No cohesion waiting on the run home (wins the race to the point).
- **Combat**: memory of contacts with velocity; group focus target (reachable by most guns, weakest,
  side/rear exposed); lead with shell speed; turrets pre-aimed at the last enemy sighting or the approach
  point; hull faces the threat (front armor 20 vs side 10); damaged MBT (≤34% hp) reverses out;
  shoot-and-scoot while reloading; blind fire at remembered stationary contacts; artillery dodge.
- CPU: tick p99 ≈ 0.04 ms in Node, ladder peak 1 of 40 units; hello ≈ 1300 of 4000.

## What the replays taught (keep)

- Strong bots (bazookabot-lab, bazookabot, anvil: 3×MBT) **turtle** on their point with turrets pre-aimed
  and fire a synchronised 3-gun volley. Attacking them head-on loses.
- Home-vs-home stalemate with equal rates is decided by **who reaches the point first**. Measure with
  `racetest.mjs`; v5 cut ~20 ticks by dropping cohesion on the way home.
- An APC (2× capture) wins on points vs pure turtles but loses fights 2 guns vs 3 (APC gun does 1 dmg
  to MBT front). Splitting the squad gets punished.
- MBT front hit = 25, side 35, rear 41. Facing matters.

## Tried and rejected (self-play, 20–24 seeds × 2 sides, ±~10%)

| Idea | Result |
|---|---|
| Friendly yield at chokepoints | 32.5% vs v3 |
| 2×MBT + APC fortress (v4 logic) | 21% vs 3×MBT attackers (100% vs turtles) |
| v6: split 1 home / 2 centre when losing | 43.8% vs v5 |
| clearance / slope tuning | no measurable race gain |

## Ideas not yet built

- Drone spotter (36-tile sensor) + MBTs firing from 21–29 tiles (beyond enemy MBT sight of 20).
- Hull-down / cover-aware screen positions; forest-edge positions.
- Better assault on a turtle: approach outside its pre-aimed lane, arrive with all three guns at once.

## Results log

| When (UTC) | Version | Local house bots | Self-play | Scrimmages vs top | Ranked |
|---|---|---|---|---|---|
| 11-08 | v2 | 94% | — | 0-4 (bazookabot-lab, bazookabot) | 4 W |
| 11-08 | v3 | 95% | 77.5% vs v2 | 0-4 | 2 W |
| 11-08 | v4 | 96% | 65% vs v3 | 0-4 | 1 W |
| 11-08 | v5 | 100% (80-0) | 52.5% vs v4 (85% vs turtle) | 2-4 (1-1 vs bazookabot-lab, 1-1 vs bazookabot), 0-2 anvil | cup: L faustus, D nova-ai-general |

## Procedure for an improvement run

1. `bash tools/fetch-sdk.sh`; `bash tools/losses.sh 100` (record per version + replays of non-wins).
2. For each non-win: `node tools/analyze.mjs replays/<id>-<g>.jsonl 50`; find the cause.
3. Change a copy (`bot/versions/vN+1.js`), add a `CFG` switch for the new behavior.
4. Accept only if: house bots ≥ current (`node tools/local-test.mjs <file> --seeds 15 --quiet`),
   self-play vs `bot/current.js` ≥ 55% on ≥ 24 seeds, no tick errors, `--profile` tick p99 < 0.5 ms.
5. Upload with `tools/upload.sh`, copy to `bot/current.js`, update this file, commit, push.
6. Optional: 1–3 scrimmages vs the top bots on new seeds (`tools/scrim.sh`), log the result.
