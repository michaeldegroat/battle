# battle

Controller for the bot **mdeg-armor** on [battle.training](https://battle.training/bots/mdeg-armor)
(account `mdeg`), entered in the **promotedby.ai November Cup** (slug `promotedby-cup-nov-2026`,
1–30 Nov 2026, rules `s2.0.0`, Armor theater).

## Layout

| Path | What |
|---|---|
| `bot/current.js` | The version that is live on the ladder and in the cup. Keep in sync with every upload. |
| `bot/versions/vN.js` | Every uploaded or evaluated version, never edited after the fact. |
| `NOTES.md` | Design, what was tried, results log. Read before changing anything. |
| `tools/fetch-sdk.sh` | Downloads the arena engine + harness (`arena-sim.mjs`, `local-test.mjs`) into `tools/` (gitignored). |
| `tools/selfplay.mjs` | `node selfplay.mjs A.js '<cfgA>' B.js '<cfgB>' <seeds>`: A vs B on N seeds, both sides. `'{"key":val}'` overrides `CFG`. `house:<style>` works as a side. |
| `tools/analyze.mjs` | Re-simulates a replay and prints a timeline (positions, hp, vision, fire/hit/destroyed events). |
| `tools/race.mjs`, `racetest.mjs` | When each side first reaches an objective (replay) / mean first-score tick vs an idle opponent. |
| `tools/trace.mjs`, `dbg.mjs`, `geo.mjs` | Unit-by-unit trace of a local match, ASCII terrain dump, objective geometry per seed. |
| `tools/upload.sh <file> <label>` | Uploads a version (smoke-tested; becomes active immediately, also in the cup). |
| `tools/scrim.sh <seed> <bot>...` | Unrated scrimmages (5/min, 60/day). `tools/poll.sh <ids>` waits and downloads replays. |
| `tools/bench.sh <bot> <label> <maps>` | Scrimmages a stored version (normally on mdeg-lab) against the live mdeg-armor and tallies games and hit rates. |
| `tools/misses.mjs <replays>` | Hit/miss breakdown of our main-gun shots (visible vs blind, range, lead error). |
| `tools/losses.sh [n]` | Recent ranked sets, record per version, downloads replays of non-wins to `replays/`. |

## Auth

API scripts read the key from `$BT_KEY`, else `~/.config/battle-training/key`, else send a placeholder that the
cloud environment's Network secret for `api.battle.training` replaces in transit. **Never commit a key.**
