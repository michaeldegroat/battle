import { Match, RULES_S2 } from "./arena-sim.mjs";
for (let s = 1; s <= 12; s++) {
  const seed = (s * 2246822519 + 12345) >>> 0;
  const m = new Match(seed, { rules: RULES_S2 });
  const h = m.hello(0);
  const [sx, sy] = h.map.spawns[0], [ex, ey] = h.map.spawns[1];
  console.log(seed, "spawn", h.map.spawns.join(" "), h.objectives.map(o => `w${o.weight} r${(o.radius/65536).toFixed(0)} @${(o.x/65536).toFixed(0)},${(o.y/65536).toFixed(0)} d0=${Math.hypot(o.x/65536-sx,o.y/65536-sy).toFixed(0)} d1=${Math.hypot(o.x/65536-ex,o.y/65536-ey).toFixed(0)}`).join(" | "));
}
