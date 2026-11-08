// node selfplay.mjs A.js 'jsonCfgA' B.js 'jsonCfgB' seeds [seedOffset]
import { readFileSync } from "node:fs";
import { runMatch, makeHouseBot, RULES_S2 } from "./arena-sim.mjs";
const [fa, ca, fb, cb, nS = "20", off = "0"] = process.argv.slice(2);
const load = (file, cfg) => {
  if (file.startsWith("house:")) return makeHouseBot({ style: file.slice(6), seed: 7 });
  const src = readFileSync(file, "utf8");
  globalThis.BOTCFG = cfg ? JSON.parse(cfg) : undefined;
  delete globalThis.controller; new Function(src)();
  const c = globalThis.controller; delete globalThis.BOTCFG;
  const w = { hello: h => c.hello(h), tick: o => { const r = c.tick(o) || {}; return { tick: o.tick, units: r.units || [] }; } };
  if (c.draft) w.draft = h => c.draft(h);
  return w;
};
let w = 0, l = 0, d = 0, pts = 0; const reasons = {};
for (let s = 1 + Number(off); s <= Number(nS) + Number(off); s++) {
  const seed = (s * 2246822519 + 12345) >>> 0;
  let setPts = 0;
  for (const sideA of [0, 1]) {
    const A = load(fa, ca), B = load(fb, cb);
    const r = runMatch(seed, sideA === 0 ? A : B, sideA === 0 ? B : A, { rules: RULES_S2 });
    const win = r.final.winner === sideA, loss = r.final.winner === 1 - sideA;
    if (win) { w++; setPts += 1; } else if (loss) l++; else { d++; setPts += 0.5; }
    reasons[r.final.reason] = (reasons[r.final.reason] || 0) + 1;
  }
  pts += setPts;
}
const g = w + l + d;
console.log(`A ${fa} ${ca || ""} vs B ${fb} ${cb || ""}: W-L-D ${w}-${l}-${d}  score ${(100 * (w + d / 2) / g).toFixed(1)}%  reasons ${JSON.stringify(reasons)}`);
