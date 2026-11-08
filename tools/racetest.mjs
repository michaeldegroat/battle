import { readFileSync } from "node:fs";
import { runMatch, RULES_S2 } from "./arena-sim.mjs";
const [file, cfg, nS = "16"] = process.argv.slice(2);
const src = readFileSync(file, "utf8");
const idle = { hello() {}, tick: o => ({ tick: o.tick, units: [] }), draft: () => ["mbt", "mbt", "mbt"] };
let tot = 0, n = 0, worst = 0;
for (let s = 1; s <= Number(nS); s++) {
  const seed = (s * 2246822519 + 999) >>> 0;
  for (const side of [0, 1]) {
    globalThis.BOTCFG = cfg ? JSON.parse(cfg) : undefined; delete globalThis.controller; new Function(src)(); const c = globalThis.controller;
    const me = { draft: h => c.draft(h), hello: h => c.hello(h), tick: o => ({ tick: o.tick, units: c.tick(o).units }) };
    let first = null;
    runMatch(seed, side ? idle : me, side ? me : idle, { rules: RULES_S2, maxTicks: 700, onTick: st => {
      if (first !== null) return;
      if (st.score[side] > 0) first = st.tick;
    }});
    tot += first ?? 700; n++; worst = Math.max(worst, first ?? 700);
  }
}
console.log(cfg || "default", "mean first-score tick", (tot / n).toFixed(1), "worst", worst);
