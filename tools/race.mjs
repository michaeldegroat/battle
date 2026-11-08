import { readFileSync } from "node:fs";
import { verifyReplay, decodeReplay, rulesFor } from "./arena-sim.mjs";
const r = decodeReplay(readFileSync(process.argv[2], "utf8"));
const v = verifyReplay(r, { rules: rulesFor(r.header.rulesVersion) });
const first = [null, null];
for (const st of v.states) for (const ob of st.objectives) for (const u of st.units) {
  if (!u.alive) continue;
  if (Math.hypot(u.x - ob.x, u.y - ob.y) < ob.radius && first[u.side] === null) first[u.side] = [st.tick, u.id, (ob.x/65536).toFixed(0), (ob.y/65536).toFixed(0)];
}
const sc = v.states.find(s => s.score[0] + s.score[1] > 0);
console.log(r.header.bots.map(b => b.name), "first unit inside an objective", JSON.stringify(first), "first score tick", sc?.tick, sc?.score);
