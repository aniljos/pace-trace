import { indexAt, movingAt, readingsAt } from './analysis.js';
import { hrSmooth } from './hr.js';

const WIN_MS = 4000; // speed is measured over +/-4 s: short enough to see 30 s efforts
const MIN_REP_MS = 20000;
const MIN_REP_M = 60;
const MIN_GAP_MS = 12000; // an easy blip shorter than this inside an effort doesn't end it
const MIN_REPS = 3;

function fineSpeed(run) {
  const { ts, dist } = run;
  const n = ts.length;
  const out = new Float64Array(n);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    while (ts[i] - ts[lo] > WIN_MS) lo++;
    while (hi < n - 1 && ts[hi + 1] - ts[i] <= WIN_MS) hi++;
    const dt = ts[hi] - ts[lo];
    out[i] = dt > 0 ? ((dist[hi] - dist[lo]) / dt) * 1000 : 0;
  }
  return out;
}

// Otsu's method on the time-weighted speed distribution: the speed that best splits "hard" from "easy"
function splitSpeed(run, speed) {
  const { ts } = run;
  const vals = [];
  for (let i = 0; i < speed.length - 1; i++) {
    const w = Math.min(5000, ts[i + 1] - ts[i]);
    if (speed[i] >= 0.8 && w > 0) vals.push([speed[i], w]);
  }
  if (vals.length < 60) return null;
  const sorted = vals.map((v) => v[0]).sort((a, b) => a - b);
  const lo = sorted[0];
  const hi = sorted[Math.floor(sorted.length * 0.99)];
  if (hi - lo < 0.5) return null;
  const BINS = 48;
  const hist = new Float64Array(BINS);
  for (const [v, w] of vals) hist[Math.min(BINS - 1, Math.floor(((v - lo) / (hi - lo)) * BINS))] += w;
  const total = hist.reduce((a, b) => a + b, 0);
  let sumAll = 0;
  for (let b = 0; b < BINS; b++) sumAll += b * hist[b];
  let wB = 0;
  let sumB = 0;
  let best = -1;
  let bestBin = 0;
  for (let b = 0; b < BINS - 1; b++) {
    wB += hist[b];
    sumB += b * hist[b];
    const wF = total - wB;
    if (!wB || !wF) continue;
    const between = wB * wF * (sumB / wB - (sumAll - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      bestBin = b;
    }
  }
  const thr = lo + ((bestBin + 1) / BINS) * (hi - lo);
  let easyW = 0, easyS = 0, hardW = 0, hardS = 0;
  for (const [v, w] of vals) {
    if (v >= thr) { hardW += w; hardS += v * w; } else { easyW += w; easyS += v * w; }
  }
  if (!easyW || !hardW) return null;
  return { thr, easyMean: easyS / easyW, hardMean: hardS / hardW, hardShare: hardW / (hardW + easyW) };
}

const cv = (arr) => {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length) / m;
};

// Finds repeated hard efforts (intervals, or run/walk blocks). Returns null if the run is a steady effort.
export function detectIntervals(run) {
  const speed = fineSpeed(run);
  const split = splitSpeed(run, speed);
  if (!split || split.hardMean / split.easyMean < 1.25 || split.hardShare < 0.04 || split.hardShare > 0.7) return null;

  // Label samples hard/easy with a little hysteresis so speed noise around the threshold doesn't chatter
  const n = speed.length;
  const hard = new Uint8Array(n);
  let state = 0;
  for (let i = 0; i < n; i++) {
    if (!state && speed[i] >= split.thr * 1.03) state = 1;
    else if (state && speed[i] < split.thr * 0.97) state = 0;
    hard[i] = state;
  }

  // Runs of equal labels -> segments
  let segs = [];
  for (let i = 0; i < n; i++) {
    const last = segs[segs.length - 1];
    if (last && last.hard === hard[i]) last.end = i;
    else segs.push({ hard: hard[i], start: i, end: i });
  }
  const ms = (g) => run.ts[g.end] - run.ts[g.start];
  for (let pass = 0; pass < 2; pass++) {
    // short easy blips between hard segments get absorbed...
    for (let k = 1; k < segs.length - 1; k++) {
      if (!segs[k].hard && ms(segs[k]) < MIN_GAP_MS && segs[k - 1].hard && segs[k + 1].hard) segs[k].hard = 1;
    }
    // ...and short hard bursts are ignored
    for (const g of segs) if (g.hard && ms(g) < MIN_REP_MS) g.hard = 0;
    const merged = [];
    for (const g of segs) {
      const last = merged[merged.length - 1];
      if (last && last.hard === g.hard) last.end = g.end;
      else merged.push({ ...g });
    }
    segs = merged;
  }

  const hr = hrSmooth(run);
  const hasHr = hr.some((v) => !Number.isNaN(v));
  const reps = [];
  const hardSegs = segs.filter((g) => g.hard && run.dist[g.end] - run.dist[g.start] >= MIN_REP_M);
  hardSegs.forEach((g, k) => {
    const t0 = run.ts[g.start];
    const t1 = run.ts[g.end];
    const d = run.dist[g.end] - run.dist[g.start];
    const movingMs = Math.max(1000, movingAt(run, t1) - movingAt(run, t0));
    let sum = 0, c = 0, max = null;
    for (let i = g.start; i <= g.end; i++) {
      if (!Number.isNaN(hr[i])) { sum += hr[i]; c++; }
      const raw = run.points[i].hr;
      if (raw != null && (max == null || raw > max)) max = raw;
    }
    // heart rate at the end of the effort, then the lowest value in the following minute (capped at the next rep)
    const next = hardSegs[k + 1];
    const recEnd = Math.min(next ? run.ts[next.start] : Infinity, t1 + 180000, run.ts[n - 1]);
    let hrEnd = null;
    let hrLow = null;
    if (hasHr) {
      let es = 0, ec = 0;
      for (let i = indexAt(run.ts, t1 - 10000); i <= g.end; i++) if (!Number.isNaN(hr[i])) { es += hr[i]; ec++; }
      hrEnd = ec ? es / ec : null;
      for (let i = g.end; i <= indexAt(run.ts, Math.min(recEnd, t1 + 60000)); i++) {
        if (!Number.isNaN(hr[i]) && (hrLow == null || hr[i] < hrLow)) hrLow = hr[i];
      }
    }
    const e0 = readingsAt(run, t0).ele;
    const e1 = readingsAt(run, t1).ele;
    reps.push({
      n: k + 1,
      t0,
      t1,
      dist: d,
      ms: t1 - t0,
      speed: d / (movingMs / 1000),
      avgHr: c ? sum / c : null,
      maxHr: max,
      elev: e0 != null && e1 != null ? e1 - e0 : null,
      rec: recEnd - t1 >= 15000 ? { ms: recEnd - t1, hrDrop: hrEnd != null && hrLow != null ? hrEnd - hrLow : null } : null,
    });
  });
  if (reps.length < MIN_REPS) return null;

  const dists = reps.map((r) => r.dist);
  const durs = reps.map((r) => r.ms);
  const totalD = dists.reduce((a, b) => a + b, 0);
  const totalMs = reps.reduce((a, r) => a + (r.dist / r.speed) * 1000, 0);
  const avgSpeed = totalD / (totalMs / 1000);
  const cvDur = cv(durs);
  const cvDist = cv(dists);
  const first = reps[0];
  const last = reps[reps.length - 1];
  const withHr = reps.filter((r) => r.avgHr != null);
  return {
    kind: split.easyMean < 2.0 ? 'run/walk' : 'intervals',
    threshold: split.thr,
    easyMean: split.easyMean,
    hardMean: split.hardMean,
    reps,
    summary: {
      count: reps.length,
      avgDist: totalD / reps.length,
      avgMs: durs.reduce((a, b) => a + b, 0) / reps.length,
      avgSpeed,
      paceSpread: cv(reps.map((r) => r.speed)) * 100,
      // time-based reps (e.g. 3:00) vs distance-based (e.g. 800 m), whichever is more consistent
      basis: cvDur <= cvDist ? 'time' : 'distance',
      regular: Math.min(cvDur, cvDist) < 0.25,
      speedChangePct: ((last.speed - first.speed) / first.speed) * 100,
      hrFirst: withHr.length ? withHr[0].avgHr : null,
      hrLast: withHr.length ? withHr[withHr.length - 1].avgHr : null,
      hardTimeMs: durs.reduce((a, b) => a + b, 0),
    },
  };
}
