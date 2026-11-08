import { readFileSync } from "node:fs";
import { Match, RULES_S2 } from "./arena-sim.mjs";
const seed = Number(process.argv[2]);
const m = new Match(seed, { rules: RULES_S2 }); const h = m.hello(0);
const W = 128; const ch = ".^~=#_R b"; // terrain glyphs
const [x0, y0, x1, y1] = process.argv.slice(3).map(Number);
for (let y = y0; y <= y1; y++) { let row = String(y).padStart(3) + " "; for (let x = x0; x <= x1; x++) { const t = h.map.terrain[y * W + x]; row += t === 0 ? (h.map.heights[y*W+x] > 150 ? "+" : ".") : ch[t]; } console.log(row); }
console.log(h.objectives.map(o => [o.x / 65536, o.y / 65536, o.radius / 65536]));
