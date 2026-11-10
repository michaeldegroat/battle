import { readFileSync } from "node:fs";
import { runMatch, RULES_S2 } from "./arena-sim.mjs";
const [fa, fb, cb, nS = "16"] = process.argv.slice(2);
const load = (file, cfg, stat) => { globalThis.BOTCFG = cfg ? JSON.parse(cfg) : undefined; globalThis.BTSTAT = stat; delete globalThis.controller; new Function(readFileSync(file, "utf8"))(); const c = globalThis.controller;
  return { draft: h => c.draft(h), hello: h => { globalThis.BTSTAT = stat; c.hello(h); }, tick: o => { globalThis.BTSTAT = stat; return { tick: o.tick, units: c.tick(o).units }; } }; };
let planned = 0, alarmed = 0, n = 0, wins = 0;
for (let s = 1; s <= Number(nS); s++) for (const side of [0, 1]) {
  const seed = (s * 2246822519 + 777) >>> 0, st = {};
  const A = load(fa, "", st), B = load(fb, cb, null);
  const r = runMatch(seed, side ? B : A, side ? A : B, { rules: RULES_S2 });
  n++; if (st.planned) planned++; if (st.alarmTicks) alarmed++; if (r.final.winner === side) wins++;
}
console.log(`games ${n}  ambush planned ${planned}  alarm fired ${alarmed}  wins ${wins}`);
