import { readFileSync } from "node:fs";
import { runMatch, makeHouseBot, RULES_S2 } from "./arena-sim.mjs";
const [file, seedS, opp, t0, t1, cfg] = process.argv.slice(2);
globalThis.DBG = 1; globalThis.BOTCFG = cfg ? JSON.parse(cfg) : undefined;
new Function(readFileSync(file, "utf8"))(); const c = globalThis.controller;
let lastOrders = null;
const me = { draft: h => c.draft(h), hello: h => c.hello(h), tick: o => { const r = c.tick(o); lastOrders = r; return { tick: o.tick, units: r.units }; } };
const r = runMatch(Number(seedS), me, makeHouseBot({ style: opp, seed: 7 }), { rules: RULES_S2, onTick: (st) => {
  if (st.tick >= Number(t0) && st.tick <= Number(t1) && st.tick % 5 === 0) {
    const us = st.units.filter(u => u.side === 0);
    console.log(st.tick, us.map(u => `${u.id}${u.kind[0]}(${(u.x/65536).toFixed(1)},${(u.y/65536).toFixed(1)} sp${u.speed} hd${u.heading}${u.blocked?" BLK":""})`).join(" "), JSON.stringify(lastOrders.units.map(x=>[x.id,x.throttle,x.steer])), lastOrders.say||"");
  }
}});
console.log(r.final.reason, r.final.winner, r.final.score);
