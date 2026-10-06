const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const SMOOTH_MS = 15000;
const GAP_MS = 30000; // longer gaps between samples are treated as pauses
const STOP_SPEED = 0.6; // m/s: below this (smoothed) the runner counts as stopped

// Enrich raw points with relative time, cumulative distance and smoothed speed (m/s).
export function analyze(parsed, id, index) {
  const pts = parsed.points;
  const t0 = pts[0].t;
  const n = pts.length;
  const ts = new Float64Array(n);
  const dist = new Float64Array(n);
  const moving = new Float64Array(n); // cumulative moving time (excludes pauses)
  for (let i = 0; i < n; i++) {
    ts[i] = pts[i].t - t0;
    if (i) {
      const dt = ts[i] - ts[i - 1];
      const d = haversine(pts[i - 1], pts[i]);
      dist[i] = dist[i - 1] + d;
    }
  }

  // Speed over a window of ~SMOOTH_MS centred on each point
  const speed = new Float64Array(n);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    while (lo < i && ts[i] - ts[lo] > SMOOTH_MS / 2) lo++;
    if (hi < i) hi = i;
    while (hi < n - 1 && ts[hi + 1] - ts[i] <= SMOOTH_MS / 2) hi++;
    const dt = ts[hi] - ts[lo];
    speed[i] = dt > 0 ? ((dist[hi] - dist[lo]) / dt) * 1000 : 0;
  }

  // Stopped = a long gap in the data, or smoothed speed under STOP_SPEED. Jitter while standing doesn't count as moving.
  const stops = [];
  let cur = null;
  for (let i = 0; i < n - 1; i++) {
    const dt = ts[i + 1] - ts[i];
    const paused = dt > GAP_MS || (speed[i] + speed[i + 1]) / 2 < STOP_SPEED;
    moving[i + 1] = moving[i] + (paused ? 0 : dt);
    if (paused) {
      if (!cur) cur = { t0: ts[i], lat: pts[i].lat, lon: pts[i].lon };
      cur.t1 = ts[i + 1];
    } else if (cur) {
      stops.push(cur);
      cur = null;
    }
  }
  if (cur) stops.push(cur);
  const realStops = stops.map((st) => ({ ...st, dur: st.t1 - st.t0 })).filter((st) => st.dur >= 10000);

  // Elevation gain with a small noise threshold
  let gain = 0;
  let ref = null;
  for (const p of pts) {
    if (p.ele == null) continue;
    if (ref == null) ref = p.ele;
    else if (p.ele - ref >= 3) {
      gain += p.ele - ref;
      ref = p.ele;
    } else if (ref - p.ele >= 3) ref = p.ele;
  }

  const hrs = pts.map((p) => p.hr).filter((v) => v != null);
  const duration = ts[n - 1];
  const movingTime = moving[n - 1] || duration;

  return {
    id,
    index,
    name: parsed.name,
    startTime: t0,
    points: pts,
    ts,
    dist,
    speed,
    moving,
    stops: realStops,
    stats: {
      distance: dist[n - 1],
      duration,
      movingTime,
      avgSpeed: dist[n - 1] / (movingTime / 1000),
      elevGain: ref == null ? null : gain,
      avgHr: hrs.length ? hrs.reduce((a, b) => a + b, 0) / hrs.length : null,
      maxHr: hrs.length ? Math.max(...hrs) : null,
    },
    splits: computeSplits(ts, dist, 1000),
  };
}

function computeSplits(ts, dist, size) {
  const out = [];
  let next = size;
  let prevT = 0;
  for (let i = 1; i < ts.length; i++) {
    while (dist[i] >= next) {
      const f = (next - dist[i - 1]) / (dist[i] - dist[i - 1]);
      const t = ts[i - 1] + f * (ts[i] - ts[i - 1]);
      out.push({ km: out.length + 1, ms: t - prevT, full: true });
      prevT = t;
      next += size;
    }
  }
  const rest = dist[dist.length - 1] - (next - size);
  if (rest > 50) out.push({ km: out.length + 1, ms: ts[ts.length - 1] - prevT, full: false, meters: rest });
  return out;
}

// Largest index i with ts[i] <= t
export function indexAt(ts, t) {
  let lo = 0;
  let hi = ts.length - 1;
  if (t <= ts[0]) return 0;
  if (t >= ts[hi]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ts[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Moving time (ms, pauses excluded) accumulated by elapsed time t
export function movingAt(run, t) {
  const { ts, moving } = run;
  const i = indexAt(ts, t);
  if (i >= ts.length - 1) return moving[ts.length - 1];
  const f = (t - ts[i]) / (ts[i + 1] - ts[i]);
  return moving[i] + (moving[i + 1] - moving[i]) * f;
}

// Interpolated state of a run at elapsed time t (ms since the run's start)
export function stateAt(run, t) {
  const { ts, points, dist, speed } = run;
  const i = indexAt(ts, t);
  if (i >= ts.length - 1) {
    const p = points[ts.length - 1];
    return { i, lat: p.lat, lon: p.lon, dist: dist[i], speed: 0, ele: p.ele, hr: p.hr, finished: true };
  }
  const f = (t - ts[i]) / (ts[i + 1] - ts[i]);
  const a = points[i];
  const b = points[i + 1];
  const lerp = (x, y) => x + (y - x) * f;
  return {
    i,
    lat: lerp(a.lat, b.lat),
    lon: lerp(a.lon, b.lon),
    dist: lerp(dist[i], dist[i + 1]),
    speed: lerp(speed[i], speed[i + 1]),
    ele: a.ele != null && b.ele != null ? lerp(a.ele, b.ele) : a.ele,
    hr: a.hr != null && b.hr != null ? lerp(a.hr, b.hr) : a.hr,
    finished: false,
  };
}

// ---- pace colouring: green (fast) -> yellow -> orange -> red (slow) ----

const STOPS = [
  [0, [46, 204, 64]],
  [0.35, [255, 220, 0]],
  [0.7, [255, 133, 27]],
  [1, [231, 36, 29]],
];

export function colorFor(slowness) {
  const s = Math.min(1, Math.max(0, slowness));
  for (let k = 1; k < STOPS.length; k++) {
    if (s <= STOPS[k][0]) {
      const [s0, c0] = STOPS[k - 1];
      const [s1, c1] = STOPS[k];
      const f = (s - s0) / (s1 - s0);
      const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return 'rgb(231,36,29)';
}

// Shared scale across all loaded runs so colours are comparable: p5..p95 of moving speeds.
export function makePaceScale(runs) {
  const all = [];
  for (const r of runs) for (let i = 0; i < r.speed.length; i++) if (r.speed[i] > 0.5) all.push(r.speed[i]);
  if (!all.length) return { fast: 4, slow: 2 };
  all.sort((a, b) => a - b);
  const q = (p) => all[Math.min(all.length - 1, Math.floor(p * all.length))];
  const slow = q(0.05);
  let fast = q(0.95);
  if (fast - slow < 0.3) fast = slow + 0.3;
  return { fast, slow };
}

// Colour bucket 0..BUCKETS-1 for a speed, so consecutive points can be merged into one polyline.
export const BUCKETS = 24;
export function bucketFor(speed, scale) {
  const slowness = (scale.fast - speed) / (scale.fast - scale.slow);
  return Math.round(Math.min(1, Math.max(0, slowness)) * (BUCKETS - 1));
}
export const bucketColor = (b) => colorFor(b / (BUCKETS - 1));

// Contiguous point ranges sharing one colour bucket: [{ from, to, bucket }] (inclusive indices)
export function colorRuns(run, scale) {
  const out = [];
  const n = run.speed.length;
  for (let i = 0; i < n - 1; i++) {
    const b = bucketFor((run.speed[i] + run.speed[i + 1]) / 2, scale);
    const last = out[out.length - 1];
    if (last && last.bucket === b) last.to = i + 1;
    else out.push({ from: i, to: i + 1, bucket: b, color: bucketColor(b) });
  }
  return out;
}

// Position and elapsed time at a given distance along the run
export function pointAtDistance(run, d) {
  const { dist, ts, points } = run;
  let lo = 0;
  let hi = dist.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dist[mid] < d) lo = mid + 1;
    else hi = mid;
  }
  const i = Math.max(1, lo);
  const f = dist[i] === dist[i - 1] ? 0 : (d - dist[i - 1]) / (dist[i] - dist[i - 1]);
  const a = points[i - 1];
  const b = points[i];
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
    t: ts[i - 1] + (ts[i] - ts[i - 1]) * f,
  };
}

// Elevation at time t and heart rate averaged over +/-15 s around it (null when the file has none)
export function readingsAt(run, t) {
  const { ts, points } = run;
  const i = indexAt(ts, t);
  const a = points[i];
  const b = points[Math.min(i + 1, points.length - 1)];
  let ele = a.ele;
  if (a.ele != null && b.ele != null && ts[i + 1] > ts[i]) ele = a.ele + (b.ele - a.ele) * Math.min(1, (t - ts[i]) / (ts[i + 1] - ts[i]));
  let sum = 0;
  let n = 0;
  for (let k = indexAt(ts, t - 15000); k <= indexAt(ts, t + 15000); k++) {
    if (points[k].hr != null) {
      sum += points[k].hr;
      n++;
    }
  }
  return { ele, hr: n ? sum / n : null };
}

// Markers revealed as the runner passes them: every km/mile, 25/50/75 %, and the finish.
export function milestones(run, unitMeters, unitName) {
  const total = run.stats.distance;
  const first = run.points[0];
  const out = [{ kind: 'start', label: 'Start', dist: 0, lat: first.lat, lon: first.lon, t: 0 }];
  const count = Math.floor(total / unitMeters);
  const step = Math.ceil(count / 20) || 1; // avoid clutter on very long runs
  for (let n = step; n <= count; n += step) {
    const d = n * unitMeters;
    if (total - d < 60) continue; // too close to the finish flag
    out.push({ kind: 'unit', label: `${n} ${unitName}`, dist: d, ...pointAtDistance(run, d) });
  }
  for (const pct of [25, 50, 75]) {
    out.push({ kind: 'pct', label: `${pct}%`, dist: (total * pct) / 100, ...pointAtDistance(run, (total * pct) / 100) });
  }
  const last = run.points[run.points.length - 1];
  out.push({ kind: 'finish', label: 'Finish', dist: total, lat: last.lat, lon: last.lon, t: run.ts[run.ts.length - 1] });

  // On a loop (finish near the start) the finish badge goes below the route so it doesn't sit on the Start badge.
  // If a km/mile badge is also close to the finish, drop it further so the two don't overlap.
  const finish = out[out.length - 1];
  if (haversine(first, last) < 150) {
    finish.below = true;
    finish.drop = out.some((m) => m.kind === 'unit' && total - m.dist < 250);
  }

  // Pace over the stretch each badge closes (previous badge of the same kind, or the start), plus HR and elevation there
  const prevOf = { unit: out[0], pct: out[0] };
  for (const m of out) {
    Object.assign(m, readingsAt(run, m.t));
    if (m.kind === 'finish') m.speed = run.stats.avgSpeed;
    else if (m.kind !== 'start') {
      const prev = prevOf[m.kind];
      m.speed = m.t > prev.t ? (m.dist - prev.dist) / ((m.t - prev.t) / 1000) : null;
      prevOf[m.kind] = m;
    }
  }
  return out;
}
