// node tools/misses.mjs replay.jsonl... : classify mdeg-armor's main-gun shots (hit/miss) by situation.
// Aim point comes from our recorded order; "lead error" = distance between the aim point and the
// target's real position when the shell arrives (dist / shellSpeed ticks later).
import { readFileSync } from "node:fs";
import { verifyReplay, decodeReplay, rulesFor } from "./arena-sim.mjs";
const agg = {}, FP = 65536;
const add = (k, hit) => { agg[k] ??= [0, 0]; agg[k][0]++; if (hit) agg[k][1]++; };
for (const f of process.argv.slice(2)) {
  let r; try { r = decodeReplay(readFileSync(f, "utf8")); } catch { continue; }
  const me = r.header.bots.findIndex(b => b.name === "mdeg-armor"); if (me < 0) continue;
  const rules = rulesFor(r.header.rulesVersion);
  const v = verifyReplay(r, { rules });
  const hitShells = new Set();
  for (const st of v.states) for (const e of st.events || []) if (e.kind === "hit") { const vic = st.units.find(u => u.id === e.unit); if (vic && vic.side !== me) hitShells.add(e.shell); }
  for (let i = 1; i < v.states.length; i++) {
    for (const e of v.states[i].events || []) {
      if (e.kind !== "fire" || e.weapon !== "main") continue;
      const pre = v.states[i - 1], u = pre.units.find(x => x.id === e.unit); if (!u || u.side !== me) continue;
      const ords = r.ticks[i - 1]?.o?.[me]; const list = Array.isArray(ords) ? ords : ords?.units || ords?.u || [];
      const od = list.find(x => x.id === u.id); const aim = Array.isArray(od?.fire) ? od.fire : null; if (!aim) continue;
      let tg = null, bd = 1e18;
      for (const x of pre.units) if (x.side !== me && x.alive) { const d = Math.hypot(x.x - aim[0], x.y - aim[1]); if (d < bd) { bd = d; tg = x; } }
      if (!tg) continue;
      const dist = Math.hypot(tg.x - u.x, tg.y - u.y) / FP;
      const ft = Math.round(dist * FP / rules.units[u.kind].gun.shellSpeed);
      const later = v.states[Math.min(v.states.length - 1, i + ft)].units.find(x => x.id === tg.id);
      const leadErr = later ? Math.hypot(later.x - aim[0], later.y - aim[1]) / FP : 99;
      const hit = hitShells.has(e.shell), seen = pre.vision[me].includes(tg.id);
      add("ALL", hit);
      add(seen ? "target visible" : "BLIND (target not visible)", hit);
      add(`dist ${dist < 12 ? "a <12" : dist < 20 ? "b 12-20" : "c 20+"}`, hit);
      add(`target ${Math.abs(tg.speed) > 3000 ? "moving" : "still"}`, hit);
      add(`lead err ${leadErr < 0.6 ? "a <0.6t" : leadErr < 1.2 ? "b 0.6-1.2t" : "c >1.2t"}`, hit);
      if (leadErr < 0.6) add(`  accurate aim, ${seen ? "visible" : "blind"}`, hit);
    }
  }
}
for (const [k, [n, h]] of Object.entries(agg).sort()) console.log(k.padEnd(30), String(n).padStart(5), "shots", (100 * h / n).toFixed(0).padStart(4) + "% hit");
