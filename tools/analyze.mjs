import { readFileSync } from "node:fs";
import { verifyReplay, decodeReplay, rulesFor } from "./arena-sim.mjs";
const r = decodeReplay(readFileSync(process.argv[2], "utf8"));
const me = r.header.bots.findIndex(b => (b.name === "mdeg-armor" || b.name === "you"));
const every = Number(process.argv[3] || 40);
const v = verifyReplay(r, { rules: rulesFor(r.header.rulesVersion) });
console.log("verify", v.ok, "me side", me, "drafts", JSON.stringify(r.header.drafts), "result", JSON.stringify(r.result));
const F = 65536;
let lastPrint = -999;
for (const st of v.states) {
  const ev = st.events || [];
  const fights = ev.filter(e => ["fire", "hit", "kill", "splash", "destroyed"].includes(e.kind));
  for (const e of fights) {
    const u = st.units.find(x => x.id === (e.unit ?? e.shooter));
    console.log(`  t${st.tick} ${e.kind} ${JSON.stringify(e).slice(0, 160)}`);
  }
  if (st.tick - lastPrint >= every) {
    lastPrint = st.tick;
    const line = st.units.map(u => `${u.side === me ? "ME" : "EN"}${u.id}${u.kind[0]}(${(u.x / F).toFixed(0)},${(u.y / F).toFixed(0)} h${u.hp}${u.alive ? "" : "X"} hd${u.heading})`).join(" ");
    console.log(`t${st.tick} sc ${st.score} vis me:${st.vision[me].length} en:${st.vision[1 - me].length} | ${line}`);
  }
}
