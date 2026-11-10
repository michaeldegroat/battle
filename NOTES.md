# Notes: mdeg-armor

## Live version

**v8** (uploaded 2026-11-09 20:28 UTC by a scheduled run that could not push). **Its source is NOT in this repo**
and the API cannot return it; `bot/current.js` is still v5. Uploading anything retires v8 permanently (no
rollback endpoint), so do not upload until v8 is recovered into `bot/versions/v8.js`, or Michael approves.
Version ratings 2026-11-10: v8 1792 (cup 27-22-16), v5 1639 (cup 17-20-18).

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
| v9 (on v5): engine-exact direct-shell check + fire only if clear + no blind fire | 50% / 46.9% vs v5 (24 seeds ×2, two seed sets); house 95.8% (v5 100%); 82 ticks >0.8 ms. Rejected. |
| v7: keep 1 MBT on home during attack | 39.6% vs v5; 54% vs scout drafts (v5: 80%); house 90.8% (v5: 100%) |
| clearance / slope tuning | no measurable race gain |

## Ranked draws, 2026-11-08 evening (4 sets split 1-1 in a row)

Lost game of each: bosun-armor (2 MBT+scout+drone), jarvis-prime (2 MBT+APC), nova-ai-general, ironsight (3 MBT).
3 of 4 decided on points. Cause: the opponent reached its point first (scout 6 t/s vs MBT 3.5 t/s, or APC 2x
capture, or a plateau ramp on the far side of our home point), then equal rates locked in the head start; our
late attack also left home empty ("rate 0-6"). Leaving a keeper (v7) made it worse. Open problem: answer to
fast-capture drafts without splitting the squad, e.g. contest their point with the whole squad early when the
race is clearly lost, or a faster first unit.

## v8 losses, 2026-11-10 (40 non-win sets, tools/misses.mjs)

89 of 96 lost games were vs 3×MBT and ended by elimination; the race to the point was usually within a few
ticks. Fight accuracy: we hit 70% of shots, opponents 86% (similar shot counts, ~27 dmg per hit). Blind fire
(target not visible): 15% of shots, 38% hit. Well-aimed shots at visible targets: 76% hit (24% presumably stopped by
terrain). Hit rate falls with range: <12 tiles 76%, 12–20 65%, 20+ 56%. Fixing the shot check alone did not
move self-play (v9), so the gap is probably positioning (where we stand when we shoot), not the fire decision.

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

Test bench: the account's second bot **mdeg-lab** (not in the cup) holds candidates. `tools/bench.sh mdeg-lab <label> 12`
plays it against the live mdeg-armor on 12 fixed maps (24 games, unrated). `tools/bench.sh mdeg-armor <old label> 12` is a
control (an older stored version of the cup bot vs the live one). 60 scrimmages per account per day.

1. `bash tools/fetch-sdk.sh`; `bash tools/losses.sh 100`; check `git push --dry-run origin HEAD:main` works.
2. For non-wins: `node tools/analyze.mjs replays/<id>-<g>.jsonl 50`, `node tools/misses.mjs replays/*.jsonl`.
3. Build `bot/versions/vN+1.js` on the newest version whose source is here, new behavior behind a `CFG` switch.
4. Local gate: house bots ≥ current (`--seeds 15`), no tick errors, profile tick p99 < 0.5 ms, self-play vs
   `bot/current.js` ≥ 50% on ≥ 24 seeds.
5. Bench gate: `BOT=mdeg-lab bash tools/upload.sh FILE vN+1`, then `bash tools/bench.sh mdeg-lab vN+1 12`.
   Promote only at ≥ 58% over ≥ 24 games, and only after the source is committed and pushed.
6. Promote: `bash tools/upload.sh FILE vN+1` (cup bot), copy to `bot/current.js`, update this file, commit, push.
   Every upload to mdeg-armor permanently retires the previous version: there is no rollback.
