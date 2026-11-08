// mdeg armor controller for battle.training (Season 2, s2.0.0)
// Squad moves as one group along precomputed terrain-cost distance fields, holds the best
// objective, faces the enemy with front armor, focus-fires with lead, dodges artillery.

const FP = 65536, FULL = 4096;
const CFG = Object.assign({
  draft: ["mbt", "mbt", "mbt"],
  engageRange: 26,      // tiles: contacts within this distance pull a unit into combat stance
  memTicks: 60,         // remember unseen contacts this long
  cohesion: 5,
  leash: 6,
  screenFwd: 3,
  screenLat: 3,
  apcTrail: 3,
  attackAfter: 400,
  calmMargin: 1,
  scoot: true,
  blindFire: true,          // tiles a leader may get ahead of the slowest unit before waiting
}, globalThis.BOTCFG || {});

let R, M, side, W, H, N;
let open;        // Uint8Array: 1 passable for ground
let tcost;       // Float32Array: base cost to enter a tile
let fields = []; // per objective: Float32Array distance-to-objective
let homeField = null, enemyField = null, centreField = null;
let mem = new Map();   // enemy id -> {x,y,vx,vy,kind,hp,t,heading}
let ustate = new Map(); // unit id -> {stuck, unstickUntil, lastX, lastY, still}
let goalIdx = -1, goalSince = 0;
let lastTargets = new Map();
let spawnMe, spawnEnemy;

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const hyp = (dx, dy) => Math.sqrt(dx * dx + dy * dy);
const angTo = (ax, ay, bx, by) => Math.round(Math.atan2(by - ay, bx - ax) / (2 * Math.PI) * FULL) & (FULL - 1);
const angDiff = (a, b) => { let d = (b - a) & (FULL - 1); return d > FULL / 2 ? d - FULL : d; };
const tileOf = (x, y) => { const tx = x >> 16, ty = y >> 16; return (tx < 0 || ty < 0 || tx >= W || ty >= H) ? -1 : ty * W + tx; };

function buildMap(h) {
  M = h.map; W = M.width; H = M.height; N = W * H;
  open = new Uint8Array(N); tcost = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const sp = R.terrainSpeed[M.terrain[i]] || 0;
    const x = i % W, y = (i / W) | 0;
    if (sp > 0 && x > 0 && y > 0 && x < W - 1 && y < H - 1) { open[i] = 1; tcost[i] = 65536 / sp; }
  }
  // clearance: tiles next to obstacles cost more (hull radius ~0.6 tile)
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x; if (!open[i]) continue;
    let near = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!open[i + dy * W + dx]) near++;
    if (near) tcost[i] *= 1 + 0.35 * Math.min(near, 3);
  }
}

// Dijkstra from a set of source tiles; returns distance (tile-cost units) to reach the sources
function field(srcs) {
  const d = new Float32Array(N).fill(1e9);
  const heap = new Int32Array(N * 4); let hn = 0;
  const hk = new Float32Array(N * 4);
  const push = (i, k) => { let p = hn++; while (p > 0) { const q = (p - 1) >> 1; if (hk[q] <= k) break; heap[p] = heap[q]; hk[p] = hk[q]; p = q; } heap[p] = i; hk[p] = k; };
  const pop = () => {
    const top = heap[0], tk = hk[0]; const li = heap[--hn], lk = hk[hn];
    let p = 0; for (;;) { let c = 2 * p + 1; if (c >= hn) break; if (c + 1 < hn && hk[c + 1] < hk[c]) c++; if (hk[c] >= lk) break; heap[p] = heap[c]; hk[p] = hk[c]; p = c; }
    heap[p] = li; hk[p] = lk; popK = tk; return top;
  };
  let popK = 0;
  for (const s of srcs) if (s >= 0 && open[s]) { d[s] = 0; push(s, 0); }
  const hts = M.heights;
  while (hn > 0) {
    if (hn >= N * 4 - 8) break;
    const u = pop(); if (popK > d[u]) continue;
    const ux = u % W, uy = (u / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const vx = ux + dx, vy = uy + dy; if (vx < 0 || vy < 0 || vx >= W || vy >= H) continue;
      const v = vy * W + vx; if (!open[v]) continue;
      if (dx && dy && (!open[uy * W + vx] || !open[vy * W + ux])) continue;
      // unit moves v -> u ; uphill if h[u] > h[v]
      const dh = hts[u] - hts[v];
      let c = (tcost[v] + tcost[u]) * 0.5 * (dx && dy ? 1.4142 : 1);
      if (dh > 0) c /= Math.max(0.3, 1 - dh / 40);
      const nd = d[u] + c;
      if (nd < d[v]) { d[v] = nd; push(v, nd); }
    }
  }
  return d;
}

function discTiles(cx, cy, rTiles) {
  const out = [], tx = cx >> 16, ty = cy >> 16, r = Math.ceil(rTiles);
  for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    if ((x - tx) * (x - tx) + (y - ty) * (y - ty) <= rTiles * rTiles) out.push(y * W + x);
  }
  return out;
}

// walk downhill on the field for `steps` tiles; return the waypoint (Q16.16 centre)
function nextWaypoint(f, x, y, steps) {
  let i = tileOf(x, y);
  if (i < 0) return null;
  if (!open[i] || f[i] >= 1e9) { // standing on an edge tile: pick best open neighbour
    let best = -1, bd = 1e9; const tx = i % W, ty = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const v = (ty + dy) * W + tx + dx; if (v >= 0 && v < N && open[v] && f[v] < bd) { bd = f[v]; best = v; } }
    if (best < 0) return null; i = best;
  }
  const path = [i];
  for (let s = 0; s < steps; s++) {
    const tx = i % W, ty = (i / W) | 0; let best = i, bd = f[i];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const vx = tx + dx, vy = ty + dy; if (vx < 0 || vy < 0 || vx >= W || vy >= H) continue;
      const v = vy * W + vx; if (f[v] < bd) { bd = f[v]; best = v; }
    }
    if (best === i) break; i = best; path.push(i);
  }
  // farthest step whose straight, hull-wide line is clear
  let pick = path[Math.min(1, path.length - 1)];
  for (let k = path.length - 1; k >= 1; k--) {
    const j = path[k], wx = (j % W) * FP + FP / 2, wy = ((j / W) | 0) * FP + FP / 2;
    if (wideOpen(x, y, wx, wy)) { pick = j; break; }
  }
  return [(pick % W) * FP + FP / 2, ((pick / W) | 0) * FP + FP / 2, f[pick]];
}

function wideOpen(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, d = Math.sqrt(dx * dx + dy * dy) || 1;
  const px = -dy / d * 0.55 * FP, py = dx / d * 0.55 * FP, n = Math.max(1, Math.ceil(d / FP * 3));
  for (let s = 1; s <= n; s++) {
    const cx = x0 + dx * s / n, cy = y0 + dy * s / n;
    let i = tileOf(cx, cy); if (i < 0 || !open[i]) return false;
    i = tileOf(cx + px, cy + py); if (i < 0 || !open[i]) return false;
    i = tileOf(cx - px, cy - py); if (i < 0 || !open[i]) return false;
  }
  return true;
}
function fieldAt(f, x, y) { const i = tileOf(x, y); return i < 0 ? 1e9 : f[i]; }

function drive(u, spec, order, tx, ty, throttleCap, o) {
  const st = ustate.get(u.id);
  if (o.tick < st.unstickUntil) { order.throttle = -FP; order.steer = st.unstickSteer; return; }
  const want = angTo(u.x, u.y, tx, ty);
  const d = angDiff(u.heading, want);
  order.steer = clamp(Math.round(d / spec.turnRate * FP), -FP, FP);
  const a = Math.abs(d);
  let thr = a > 900 ? 0.15 : a > 450 ? 0.5 : 1;
  order.throttle = Math.round(FP * Math.min(thr, throttleCap));
}

function updateStuck(u, o, wantedMove) {
  let st = ustate.get(u.id);
  if (!st) { st = { unstickUntil: 0, unstickSteer: FP, lastX: u.x, lastY: u.y, still: 0 }; ustate.set(u.id, st); }
  const moved = hyp(u.x - st.lastX, u.y - st.lastY);
  st.lastX = u.x; st.lastY = u.y;
  if (wantedMove && (u.blocked || moved < 300) && o.canMove) st.still++; else st.still = Math.max(0, st.still - 2);
  if (st.still > 25 && o.tick >= st.unstickUntil) {
    st.unstickUntil = o.tick + 18; st.unstickSteer = ((u.id * 7 + o.tick) & 1) ? FP : -FP; st.still = 0;
  }
  return st;
}

function chooseGoal(o, cx, cy, alive) {
  const objs = o.objectives || [];
  if (!objs.length) return -1;
  let best = -1, bs = -1e9;
  for (let k = 0; k < objs.length; k++) {
    const ob = objs[k];
    const pd = fieldAt(fields[k], cx, cy);
    if (pd >= 1e9) continue;
    let v = ob.weight;
    if (ob.owner === side && ob.state === "held") v *= 0.9;
    // enemy strength near this objective (remembered)
    let s = v * 100 / (pd + 25);
    if (k === goalIdx) s *= 1.35; // hysteresis
    if (s > bs) { bs = s; best = k; }
  }
  return best;
}

function updateMemory(o) {
  const t = o.tick;
  for (const c of o.contacts) {
    const m = mem.get(c.id);
    if (m && t - m.t <= 10 && t > m.t) {
      const dt = t - m.t;
      const nvx = (c.x - m.x) / dt, nvy = (c.y - m.y) / dt;
      m.vx = m.vx * 0.5 + nvx * 0.5; m.vy = m.vy * 0.5 + nvy * 0.5;
    } else if (!m) { mem.set(c.id, { vx: 0, vy: 0 }); }
    const e = mem.get(c.id);
    e.x = c.x; e.y = c.y; e.kind = c.kind; e.hp = c.hpFrac; e.t = t; e.heading = c.heading; e.seen = true; e.seenBy = c.seenBy;
    if (!m || t - m.t > 10) { e.vx = Math.cos(c.heading / FULL * 2 * Math.PI) * c.speed; e.vy = Math.sin(c.heading / FULL * 2 * Math.PI) * c.speed; }
  }
  for (const [id, e] of mem) {
    if (e.t !== t) e.seen = false;
    if (t - e.t > CFG.memTicks) mem.delete(id);
  }
}

function lead(u, spec, e) {
  const ss = spec.gun.shellSpeed || FP;
  let px = e.x, py = e.y;
  for (let k = 0; k < 2; k++) {
    const ft = hyp(px - u.x, py - u.y) / ss;
    px = e.x + e.vx * ft; py = e.y + e.vy * ft;
  }
  return [Math.round(px), Math.round(py)];
}

// rough check that a direct shell from u reaches (tx,ty): sample terrain along the line
function shotClear(u, spec, tx, ty) {
  const hts = M.heights, ter = M.terrain;
  const i0 = tileOf(u.x, u.y), i1 = tileOf(tx, ty); if (i0 < 0 || i1 < 0) return false;
  const h0 = hts[i0] + spec.eyeHeight, h1 = hts[i1] + 2;
  const d = hyp(tx - u.x, ty - u.y) / FP; const n = Math.max(2, Math.ceil(d * 2));
  let forest = 0, lastT = -1;
  for (let s = 1; s < n; s++) {
    const f = s / n; const x = u.x + (tx - u.x) * f, y = u.y + (ty - u.y) * f;
    const i = tileOf(x, y); if (i < 0) return false; if (i === lastT) continue; lastT = i;
    const t = ter[i]; if (t === 4 || t === 6) return false;
    if (t === 1) { forest++; if (forest > R.forestStopsShellsAfter) return false; }
    if (hts[i] > h0 + (h1 - h0) * f + 0.5) return false;
  }
  return true;
}

function pickTarget(u, spec, o) {
  let best = null, bs = 1e9;
  const range = spec.gun.maxRange;
  for (const [id, e] of mem) {
    if (!e.seen) continue;
    const d = hyp(e.x - u.x, e.y - u.y);
    if (d > range * 1.02) continue;
    let s = d / FP;
    s += (e.hp / 65536) * 12;
    for (const [uid, tid] of lastTargets) if (tid === id && uid !== u.id) s -= 6;
    if (e.kind === "missile" || e.kind === "artillery") s -= 4;
    if (e.kind === "drone") s -= 3;
    // exposed side/rear
    const toUs = angTo(e.x, e.y, u.x, u.y);
    const off = Math.abs(angDiff(e.heading, toUs));
    if (off > 1365) s -= 5; else if (off > 683) s -= 3;
    if (!shotClear(u, spec, e.x, e.y)) s += 25;
    if (s < bs) { bs = s; best = e; best.id = id; }
  }
  return best;
}


// ---------------- v3: fortress + group counterattack ----------------
let homeIdx = -1, awayIdx = -1, centreIdx = -1;
let approach = null;      // per objective: unit vector [ax, ay] towards the enemy's approach
let mode = "hold", modeSince = 0, attackIdx = -1;
let sayLine = "";
const scoot = new Map();  // unit id -> tick until which it reverses

function classify(objs) {
  const sx = spawnMe[0] * FP + FP / 2, sy = spawnMe[1] * FP + FP / 2;
  let best = 1e18;
  for (let k = 0; k < objs.length; k++) {
    const ob = objs[k];
    if (Math.abs(ob.x - W * FP / 2) < 2 * FP && Math.abs(ob.y - H * FP / 2) < 2 * FP) { centreIdx = k; continue; }
    const d = fieldAt(fields[k], sx, sy);
    if (d < best) { best = d; homeIdx = k; }
  }
  for (let k = 0; k < objs.length; k++) if (k !== homeIdx && k !== centreIdx) awayIdx = k;
  if (homeIdx < 0) homeIdx = centreIdx;
  // approach direction: follow the objective's field from the enemy spawn, stop ~9 tiles out
  approach = objs.map((ob, k) => {
    let x = spawnEnemy[0] * FP + FP / 2, y = spawnEnemy[1] * FP + FP / 2;
    for (let s = 0; s < 200; s++) {
      if (hyp(x - ob.x, y - ob.y) < 9 * FP) break;
      const wp = nextWaypoint(fields[k], x, y, 1); if (!wp) break;
      if (wp[0] === ((x >> 16) * FP + FP / 2) && wp[1] === ((y >> 16) * FP + FP / 2)) break;
      x = wp[0]; y = wp[1];
    }
    let ax = x - ob.x, ay = y - ob.y; const l = hyp(ax, ay) || 1;
    return [ax / l, ay / l];
  });
}

function slotFor(k, role, idx, n) {
  const ob = objsCache[k]; const [ax, ay] = approach[k];
  const px = -ay, py = ax;
  let fwd, lat;
  if (role === "apc") { fwd = -1; lat = 0; }
  else { fwd = CFG.screenFwd; lat = n <= 1 ? 0 : (idx - (n - 1) / 2) * CFG.screenLat; }
  let x = ob.x + (ax * fwd + px * lat) * FP, y = ob.y + (ay * fwd + py * lat) * FP;
  for (let tries = 0; tries < 4; tries++) {
    const i = tileOf(x, y);
    if (i >= 0 && open[i] && fields[k][i] < 14 && lineOpen(ob.x, ob.y, x, y)) return [Math.round(x), Math.round(y)];
    x = ob.x + (x - ob.x) * 0.5; y = ob.y + (y - ob.y) * 0.5;
  }
  return [ob.x, ob.y];
}

let objsCache = [];
function rates(objs, apcInside) {
  let our = 0, their = 0;
  for (let k = 0; k < objs.length; k++) {
    const ob = objs[k];
    if (ob.state !== "held") continue;
    if (ob.owner === side) our += ob.weight * (apcInside.has(k) ? 2 : 1); else if (ob.owner === 1 - side) their += ob.weight;
  }
  return [our, their];
}

function lineOpen(x0, y0, x1, y1) {
  const d = hyp(x1 - x0, y1 - y0) / FP, n = Math.max(1, Math.ceil(d * 2));
  for (let s = 0; s <= n; s++) { const i = tileOf(x0 + (x1 - x0) * s / n, y0 + (y1 - y0) * s / n); if (i < 0 || !open[i]) return false; }
  return true;
}
function goTo(u, spec, order, o, k, x, y, cap) {
  const d = hyp(u.x - x, u.y - y);
  if (d < 0.8 * FP) return false;
  if (k >= 0 && (hyp(u.x - objsCache[k].x, u.y - objsCache[k].y) > 7 * FP || !lineOpen(u.x, u.y, x, y))) {
    const wp = nextWaypoint(fields[k], u.x, u.y, 4);
    if (wp) { drive(u, spec, order, wp[0], wp[1], cap, o); return true; }
  }
  drive(u, spec, order, x, y, d < 2 * FP ? Math.min(cap, 0.35) : cap, o);
  return true;
}

function face(u, spec, order, x, y) {
  const d = angDiff(u.heading, angTo(u.x, u.y, x, y));
  order.steer = clamp(Math.round(d / spec.turnRate * FP), -FP, FP);
  order.throttle = 0;
}

globalThis.controller = {
  draft(h) {
    const d = h.draft; if (!d) return undefined;
    const pick = CFG.draft;
    const cost = pick.reduce((c, k) => c + (d.costs[k] ?? 99), 0);
    return cost <= d.budget && pick.length >= d.min && pick.length <= d.max && pick.every(k => d.roster.includes(k)) ? pick : undefined;
  },
  hello(h) {
    R = h.rules; side = h.side;
    buildMap(h);
    spawnMe = h.map.spawns[side]; spawnEnemy = h.map.spawns[1 - side];
    objsCache = h.objectives || [];
    fields = objsCache.map(ob => field(discTiles(ob.x, ob.y, Math.max(1, ob.radius / FP - 1.5))));
    enemyField = field(discTiles(spawnEnemy[0] * FP + FP / 2, spawnEnemy[1] * FP + FP / 2, 3));
    if (objsCache.length) classify(objsCache);
  },
  tick(o) {
    updateMemory(o);
    const alive = o.units.filter(u => u.alive);
    if (!alive.length) return { units: [] };
    const objs = o.objectives || []; objsCache = objs;
    const orders = [];
    const apcs = alive.filter(u => u.kind === "apc");
    const guns = alive.filter(u => u.kind !== "apc");

    // ---- strategic mode
    const apcInside = new Set();
    for (const a of apcs) for (let k = 0; k < objs.length; k++) if (hyp(a.x - objs[k].x, a.y - objs[k].y) < objs[k].radius) apcInside.add(k);
    const [ourR, theirR] = rates(objs, apcInside);
    const remain = R.maxTicks - o.tick;
    const ptLead = o.score[side] - o.score[1 - side];
    const projected = ptLead + (ourR - theirR) * remain;
    let goal = homeIdx;
    if (objs.length) {
      const losing = projected < 0 || (projected === 0 && o.tick > 1200);
      if (mode === "hold" && losing && o.tick > CFG.attackAfter && o.tick - modeSince > 200) { mode = "attack"; modeSince = o.tick; }
      else if (mode === "attack" && projected > CFG.calmMargin * remain / 10 && o.tick - modeSince > 300) { mode = "hold"; modeSince = o.tick; }
      if (mode === "attack") {
        // the enemy-held objective with the most weight, nearest first on ties
        let best = -1, bs = -1e9;
        for (let k = 0; k < objs.length; k++) {
          if (k === homeIdx && objs[k].owner === side) continue;
          let v = (objs[k].owner === 1 - side ? 2 : 1) * objs[k].weight * 100 - fieldAt(fields[k], guns[0]?.x ?? alive[0].x, guns[0]?.y ?? alive[0].y) * 0.2;
          if (k === attackIdx) v += 60;
          if (v > bs) { bs = v; best = k; }
        }
        attackIdx = best >= 0 ? best : homeIdx; goal = attackIdx;
      }
    }
    // home under attack: always defend
    if (objs.length && mode === "attack" && objs[homeIdx].state === "contested" && apcs.length) goal = homeIdx;

    // ---- per-unit
    const newTargets = new Map();
    const gunIdx = new Map(); guns.forEach((u, i) => gunIdx.set(u.id, i));
    let gcx = 0, gcy = 0, gmin = 1e18;
    for (const u of guns) { gcx += u.x; gcy += u.y; if (goal >= 0) gmin = Math.min(gmin, fieldAt(fields[goal], u.x, u.y)); }
    if (guns.length) { gcx /= guns.length; gcy /= guns.length; }

    for (const u of alive) {
      const spec = R.units[u.kind];
      const order = { id: u.id };
      let nearE = null, nd = 1e18;
      for (const [, e] of mem) { const d = hyp(e.x - u.x, e.y - u.y); if (d < nd) { nd = d; nearE = e; } }

      // weapons
      const tgt = spec.gun.mode === "direct" ? pickTarget(u, spec, o) : null;
      if (tgt) {
        newTargets.set(u.id, tgt.id);
        const [px, py] = lead(u, spec, tgt);
        order.aimAt = [px, py];
        if (u.reload === 0 && hyp(px - u.x, py - u.y) <= spec.gun.maxRange) order.fire = [px, py];
      } else if (nearE && spec.gun.mode === "direct") {
        order.aimAt = [Math.round(nearE.x), Math.round(nearE.y)];
        if (CFG.blindFire && u.kind === "mbt" && u.reload === 0 && !nearE.seen && o.tick - nearE.t < 60 && hyp(nearE.vx, nearE.vy) < 800 && nd <= spec.gun.maxRange && nd > 8 * FP)
          order.fire = [Math.round(nearE.x), Math.round(nearE.y)];
      }

      let moved = false;
      if (!o.canMove) { orders.push(order); continue; }
      const st = updateStuck(u, o, true);
      if (o.tick < st.unstickUntil) { order.throttle = -FP; order.steer = st.unstickSteer; orders.push(order); continue; }

      // artillery dodge
      let dodged = false;
      for (const inc of o.incoming) {
        if (hyp(inc.x - u.x, inc.y - u.y) < 4.5 * FP && inc.ticks < 40) { drive(u, spec, order, u.x + (u.x - inc.x) * 3, u.y + (u.y - inc.y) * 3, 1, o); dodged = true; break; }
      }
      if (dodged) { orders.push(order); continue; }

      if (!objs.length) {
        const wp = tgt ? null : nextWaypoint(enemyField, u.x, u.y, 4);
        if (tgt) face(u, spec, order, tgt.x, tgt.y); else if (wp) drive(u, spec, order, wp[0], wp[1], 1, o);
        orders.push(order); continue;
      }

      const isApc = u.kind === "apc";
      const gi = gunIdx.get(u.id) ?? 0;
      const [sx, sy] = slotFor(goal, isApc ? "apc" : "gun", gi, guns.length);
      const ob = objs[goal];
      const visibleThreat = tgt && tgt.seen;
      const enemyInPoint = [...mem.values()].some(e => o.tick - e.t < 20 && hyp(e.x - ob.x, e.y - ob.y) < ob.radius + FP);
      const atGoal = hyp(u.x - ob.x, u.y - ob.y) < ob.radius + 4 * FP;

      if (isApc) {
        // APC: move with the guns until near the goal, then sit inside the point
        const pd = fieldAt(fields[goal], u.x, u.y);
        let cap = 1;
        if (guns.length && pd < gmin + CFG.apcTrail && !atGoal) cap = 0.3;
        if (visibleThreat && hyp(u.x - ob.x, u.y - ob.y) < ob.radius * 0.7) face(u, spec, order, tgt.x, tgt.y);
        else if (!goTo(u, spec, order, o, goal, sx, sy, cap)) { if (nearE) face(u, spec, order, nearE.x, nearE.y); else { order.throttle = 0; order.steer = 0; } }
        orders.push(order); continue;
      }

      // gun unit
      const sc = scoot.get(u.id) || 0;
      if (visibleThreat) {
        const dSlot = hyp(u.x - sx, u.y - sy);
        if (CFG.scoot && u.kind === "mbt" && u.reload > 25 && sc >= o.tick - 1 && dSlot < CFG.leash * FP) {
          // reverse while keeping the front towards the enemy
          const d = angDiff(u.heading, angTo(u.x, u.y, tgt.x, tgt.y));
          order.steer = clamp(Math.round(d / spec.turnRate * FP), -FP, FP);
          order.throttle = -Math.round(FP * 0.8);
          scoot.set(u.id, o.tick);
        } else if (atGoal || dSlot < CFG.leash * FP || hyp(tgt.x - ob.x, tgt.y - ob.y) < 12 * FP) {
          face(u, spec, order, tgt.x, tgt.y);
          if (u.reload === 0) scoot.set(u.id, o.tick); // arm a scoot after this shot
          // if out of range push towards it
          if (hyp(tgt.x - u.x, tgt.y - u.y) > spec.gun.maxRange * 0.9) drive(u, spec, order, tgt.x, tgt.y, 0.6, o);
        } else {
          goTo(u, spec, order, o, goal, sx, sy, 0.7);
        }
      } else if (enemyInPoint && nearE) {
        const wp = nextWaypoint(fields[goal], u.x, u.y, 3);
        if (atGoal) drive(u, spec, order, nearE.x, nearE.y, 0.6, o); else if (wp) drive(u, spec, order, wp[0], wp[1], 0.8, o);
      } else {
        // move with cohesion
        const pd = fieldAt(fields[goal], u.x, u.y);
        let gmax = 0; for (const v of guns) gmax = Math.max(gmax, fieldAt(fields[goal], v.x, v.y));
        const cap = (!atGoal && gmax - pd > CFG.cohesion * 1.2 && pd > 12) ? 0.3 : 1;
        if (!goTo(u, spec, order, o, goal, sx, sy, cap)) {
          if (nearE && o.tick - nearE.t < CFG.memTicks) face(u, spec, order, nearE.x, nearE.y);
          else { const [ax, ay] = approach[goal]; face(u, spec, order, u.x + ax * 10 * FP, u.y + ay * 10 * FP); }
        }
      }
      orders.push(order);
    }
    lastTargets = newTargets;
    const out = { units: orders };
    if (o.tick % 200 === 41) out.say = `${mode} ${goal === homeIdx ? "home" : goal === centreIdx ? "centre" : "far"} rate ${ourR}-${theirR}`;
    return out;
  },
};
