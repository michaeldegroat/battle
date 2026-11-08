// mdeg armor controller for battle.training (Season 2, s2.0.0)
// Squad moves as one group along precomputed terrain-cost distance fields, holds the best
// objective, faces the enemy with front armor, focus-fires with lead, dodges artillery.

const FP = 65536, FULL = 4096;
const CFG = Object.assign({
  draft: ["mbt", "mbt", "mbt"],
  engageRange: 26,      // tiles: contacts within this distance pull a unit into combat stance
  memTicks: 60,         // remember unseen contacts this long
  cohesion: 5,
  leash: 16,
  pushAfter: 99999,          // tiles a leader may get ahead of the slowest unit before waiting
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
  for (let s = 0; s < steps; s++) {
    const tx = i % W, ty = (i / W) | 0; let best = i, bd = f[i];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const vx = tx + dx, vy = ty + dy; if (vx < 0 || vy < 0 || vx >= W || vy >= H) continue;
      const v = vy * W + vx; if (f[v] < bd) { bd = f[v]; best = v; }
    }
    if (best === i) break; i = best;
  }
  return [(i % W) * FP + FP / 2, ((i / W) | 0) * FP + FP / 2, f[i]];
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


let homeIdx = -1, awayIdx = -1, centreIdx = -1, classified = false;
let holders = new Set();
let sayLine = "";
const efCache = new Map();
function enemyFieldFor(e) { return enemyField; }
function classifyObjectives(objs) {
  if (classified) return; classified = true;
  const sx = spawnMe[0] * FP + FP / 2, sy = spawnMe[1] * FP + FP / 2;
  let best = 1e18;
  for (let k = 0; k < objs.length; k++) {
    const ob = objs[k];
    if (Math.abs(ob.x - W * FP / 2) < 2 * FP && Math.abs(ob.y - H * FP / 2) < 2 * FP) { centreIdx = k; continue; }
    const d = fieldAt(fields[k], sx, sy);
    if (d < best) { best = d; homeIdx = k; }
  }
  for (let k = 0; k < objs.length; k++) if (k !== homeIdx && k !== centreIdx) awayIdx = k;
}
let enemyKills = 0;
function makePlan(o, alive) {
  const plan = new Map();
  const objs = o.objectives;
  holders = new Set();
  if (!objs.length) { for (const u of alive) plan.set(u.id, -1); return plan; }
  const apcs = alive.filter(u => u.kind === "apc").sort((a, b) => a.id - b.id);
  const others = alive.filter(u => u.kind !== "apc");
  const holdTargets = [homeIdx, centreIdx, awayIdx].filter(k => k >= 0);
  // holders: APCs claim home, then centre, then away
  apcs.forEach((u, i) => { const k = holdTargets[Math.min(i, holdTargets.length - 1)]; plan.set(u.id, k); holders.add(u.id); });
  // threat at home?
  const home = objs[homeIdx];
  let homeThreat = false;
  if (home) for (const [, e] of mem) if (hyp(e.x - home.x, e.y - home.y) < 14 * FP && o.tick - e.t < 40) homeThreat = true;
  if (home && home.state === "contested") homeThreat = true;
  const lead = o.score[side] - o.score[1 - side];
  const remain = R.maxTicks - o.tick;
  const ourW = objs.reduce((a, ob) => a + (ob.owner === side && ob.state === "held" ? ob.weight : 0), 0);
  const theirW = objs.reduce((a, ob) => a + (ob.owner === 1 - side && ob.state === "held" ? ob.weight : 0), 0);
  let front;
  if (homeThreat) front = homeIdx;
  else if (centreIdx >= 0 && !(objs[centreIdx].owner === side && objs[centreIdx].state === "held" && apcs.length > 1)) front = centreIdx;
  else if (apcs.length === 0 && others.length) front = homeIdx;
  else front = (ourW <= theirW || o.tick > CFG.pushAfter) ? awayIdx : (centreIdx >= 0 ? centreIdx : homeIdx);
  if (front < 0) front = homeIdx;
  // without APCs, the slowest-to-die unit holds home when the front is elsewhere
  if (!apcs.length && front !== homeIdx && others.length >= 3) {
    const sc = others.find(u => u.kind === "scout") || others[others.length - 1];
    plan.set(sc.id, homeIdx); holders.add(sc.id);
  }
  for (const u of others) if (!plan.has(u.id)) plan.set(u.id, front);
  const nm = k => k === homeIdx ? "home" : k === centreIdx ? "centre" : "far";
  sayLine = `holding ${[...new Set(apcs.map(u => nm(plan.get(u.id))))].join("+") || "-"}, tanks to ${nm(front)}`;
  return plan;
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
    fields = (h.objectives || []).map(ob => field(discTiles(ob.x, ob.y, Math.max(1, ob.radius / FP - 1.5))));
    enemyField = field(discTiles(spawnEnemy[0] * FP + FP / 2, spawnEnemy[1] * FP + FP / 2, 3));
  },

  tick(o) {
    updateMemory(o);
    const alive = o.units.filter(u => u.alive);
    const orders = [];
    if (!alive.length) return { units: [] };
    const objs = o.objectives || [];
    classifyObjectives(objs);
    const plan = makePlan(o, alive);
    const newTargets = new Map();
    for (const u of alive) {
      const spec = R.units[u.kind];
      const order = { id: u.id };
      const gk = plan.get(u.id);
      const gf = gk >= 0 ? fields[gk] : enemyField;
      const gob = gk >= 0 ? objs[gk] : null;
      const holder = holders.has(u.id);
      let nearE = null, nd = 1e18;
      for (const [id, e] of mem) { const d = hyp(e.x - u.x, e.y - u.y); if (d < nd) { nd = d; nearE = e; } }
      const engaged = nearE && nd < CFG.engageRange * FP;

      // weapons
      const tgt = spec.gun.mode === "direct" ? pickTarget(u, spec, o) : null;
      if (tgt) {
        newTargets.set(u.id, tgt.id);
        const [px, py] = lead(u, spec, tgt);
        order.aimAt = [px, py];
        if (u.reload === 0 && hyp(px - u.x, py - u.y) <= spec.gun.maxRange) order.fire = [px, py];
      } else if (nearE && spec.gun.mode === "direct") {
        order.aimAt = [Math.round(nearE.x), Math.round(nearE.y)];
      }

      let moveTo = null, cap = 1;
      const dGoal = gob ? hyp(u.x - gob.x, u.y - gob.y) : 1e18;
      const inGoal = gob && dGoal < gob.radius * 0.75;
      const leash = gob ? (holder ? gob.radius * 0.8 : CFG.leash * FP) : 1e18;
      if (engaged && (!holder || inGoal)) {
        const e = nearE, de = nd / FP;
        const toE = angTo(u.x, u.y, e.x, e.y);
        const wp = inGoal ? null : nextWaypoint(gf, u.x, u.y, 3);
        let pushObj = false;
        if (wp) { const toW = angTo(u.x, u.y, wp[0], wp[1]); pushObj = Math.abs(angDiff(toE, toW)) < 700; }
        const eToGoal = gob ? hyp(e.x - gob.x, e.y - gob.y) : 0;
        const canChase = !gob || eToGoal < leash || dGoal < leash * 0.5;
        if ((de > spec.gun.maxRange / FP * 0.85 || !e.seen) && canChase && !holder) {
          if (pushObj && wp) moveTo = [wp[0], wp[1]];
          else { const w2 = nextWaypoint(enemyFieldFor(e), u.x, u.y, 3); moveTo = w2 ? [w2[0], w2[1]] : [e.x, e.y]; }
          cap = 0.8;
        } else if (pushObj && wp && !holder) { moveTo = [wp[0], wp[1]]; cap = 0.5; }
        else if (!inGoal && gob && dGoal > leash) { const w3 = nextWaypoint(gf, u.x, u.y, 3); if (w3) moveTo = [w3[0], w3[1]]; cap = 0.6; }
        else {
          const d = angDiff(u.heading, toE);
          order.steer = clamp(Math.round(d / spec.turnRate * FP), -FP, FP);
          order.throttle = 0;
        }
      } else if (inGoal) {
        let sx = 0, sy = 0;
        for (const v of alive) if (v !== u) { const dd = hyp(v.x - u.x, v.y - u.y); if (dd < 3 * FP && dd > 0) { sx += (u.x - v.x) / dd; sy += (u.y - v.y) / dd; } }
        if ((sx || sy) && dGoal < gob.radius * 0.5) { moveTo = [u.x + sx * 2 * FP, u.y + sy * 2 * FP]; cap = 0.4; }
        else if (nearE) { const d = angDiff(u.heading, angTo(u.x, u.y, nearE.x, nearE.y)); order.steer = clamp(Math.round(d / spec.turnRate * FP), -FP, FP); order.throttle = 0; }
        else { order.throttle = 0; order.steer = 0; }
      } else {
        const wp = nextWaypoint(gf, u.x, u.y, 4);
        if (wp) moveTo = [wp[0], wp[1]];
        // cohesion among units sharing a goal
        const pd = fieldAt(gf, u.x, u.y);
        let maxPd = 0; for (const v of alive) if (plan.get(v.id) === gk && !holders.has(v.id)) maxPd = Math.max(maxPd, fieldAt(gf, v.x, v.y));
        if (!holder && maxPd - pd > CFG.cohesion * 1.2 && pd > 12) cap = 0.3;
      }

      for (const inc of o.incoming) {
        const di = hyp(inc.x - u.x, inc.y - u.y);
        if (di < 4.5 * FP && inc.ticks < 40) { moveTo = [u.x + (u.x - inc.x) * 3, u.y + (u.y - inc.y) * 3]; cap = 1; break; }
      }

      const st = updateStuck(u, o, !!moveTo);
      if (moveTo && o.canMove) drive(u, spec, order, moveTo[0], moveTo[1], cap, o);
      else if (o.tick < st.unstickUntil) { order.throttle = -FP; order.steer = st.unstickSteer; }
      if (!o.canMove) { delete order.throttle; delete order.steer; }
      orders.push(order);
    }
    lastTargets = newTargets;
    const out = { units: orders };
    if (o.tick % 200 === 41) out.say = sayLine;
    return out;
  },
};
