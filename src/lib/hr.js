import { colorRuns } from './analysis.js';

// Standard 5-zone model as a share of max heart rate
export const ZONES = [
  { id: 1, name: 'Recovery', lo: 0, hi: 0.6, color: '#94a3b8' },
  { id: 2, name: 'Endurance', lo: 0.6, hi: 0.7, color: '#38bdf8' },
  { id: 3, name: 'Tempo', lo: 0.7, hi: 0.8, color: '#22c55e' },
  { id: 4, name: 'Threshold', lo: 0.8, hi: 0.9, color: '#f59e0b' },
  { id: 5, name: 'Max effort', lo: 0.9, hi: Infinity, color: '#ef4444' },
];

const SMOOTH_MS = 15000;
const GAP_MS = 30000;

// Heart rate averaged over ~15 s around each point (NaN where the file has none)
export function hrSmooth(run) {
  if (run._hrSmooth) return run._hrSmooth;
  const { ts, points } = run;
  const n = ts.length;
  const out = new Float64Array(n).fill(NaN);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    while (ts[i] - ts[lo] > SMOOTH_MS / 2) lo++;
    while (hi < n - 1 && ts[hi + 1] - ts[i] <= SMOOTH_MS / 2) hi++;
    let sum = 0;
    let c = 0;
    for (let k = lo; k <= hi; k++) {
      const h = points[k].hr;
      if (h != null && h > 30) {
        sum += h;
        c++;
      }
    }
    if (c) out[i] = sum / c;
  }
  run._hrSmooth = out;
  return out;
}

export function hasHr(run) {
  const s = hrSmooth(run);
  let c = 0;
  for (let i = 0; i < s.length; i++) if (!Number.isNaN(s[i])) c++;
  return c > s.length * 0.5;
}

// Highest 15 s-average heart rate seen across the runs: a sensible stand-in for max HR
export function estimateMaxHr(runs) {
  let best = 0;
  for (const r of runs) {
    if (!hasHr(r)) continue;
    for (const v of hrSmooth(r)) if (v > best) best = v;
  }
  return best ? Math.round(best) : null;
}

export function zoneIndex(hr, maxHr) {
  const f = hr / maxHr;
  const i = ZONES.findIndex((z) => f < z.hi);
  return i === -1 ? ZONES.length - 1 : i;
}

// Milliseconds spent in each zone: { ms: [z1..z5], total }
export function timeInZones(run, maxHr) {
  const s = hrSmooth(run);
  const ms = ZONES.map(() => 0);
  let total = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const dt = run.ts[i + 1] - run.ts[i];
    if (Number.isNaN(s[i]) || dt > GAP_MS) continue;
    ms[zoneIndex(s[i], maxHr)] += dt;
    total += dt;
  }
  return { ms, total };
}

// Aerobic decoupling: how much pace-per-heartbeat (efficiency) falls from the first to the second half of the run.
// Only moving samples with heart rate count; on long runs the first 5 minutes (warm-up) are skipped.
export function hrDrift(run) {
  const s = hrSmooth(run);
  const segs = [];
  for (let i = 0; i < s.length - 1; i++) {
    const dt = run.ts[i + 1] - run.ts[i];
    const d = run.dist[i + 1] - run.dist[i];
    if (Number.isNaN(s[i]) || dt <= 0 || dt > GAP_MS || d / (dt / 1000) < 0.8) continue;
    segs.push({ dt, d, hr: s[i] });
  }
  const validMs = segs.reduce((a, g) => a + g.dt, 0);
  if (validMs < 10 * 60000) return null; // too little data to say anything

  const warm = validMs > 30 * 60000 ? 5 * 60000 : 0;
  const used = [];
  let acc = 0;
  for (const g of segs) {
    if (acc >= warm) used.push(g);
    acc += g.dt;
  }
  const usedMs = used.reduce((a, g) => a + g.dt, 0);
  const half = [
    { dt: 0, d: 0, hrSum: 0 },
    { dt: 0, d: 0, hrSum: 0 },
  ];
  let t = 0;
  for (const g of used) {
    const h = half[t < usedMs / 2 ? 0 : 1];
    h.dt += g.dt;
    h.d += g.d;
    h.hrSum += g.hr * g.dt;
    t += g.dt;
  }
  const [a, b] = half.map((h) => ({ speed: h.d / (h.dt / 1000), hr: h.hrSum / h.dt, ms: h.dt }));
  const ef1 = a.speed / a.hr;
  const ef2 = b.speed / b.hr;
  const decoupling = ((ef1 - ef2) / ef1) * 100;
  return {
    first: a,
    second: b,
    decoupling,
    hrChange: b.hr - a.hr,
    speedChangePct: ((b.speed - a.speed) / a.speed) * 100,
    warmupSkipped: warm > 0,
    reliable: usedMs >= 20 * 60000,
    verdict: verdictFor(decoupling, b.hr - a.hr, ((b.speed - a.speed) / a.speed) * 100),
  };
}

function verdictFor(d, hrChange, speedPct) {
  if (d < 3) return { label: 'Excellent', color: '#16a34a', note: 'Very steady: your heart rate held for the pace you ran.' };
  if (d < 5) return { label: 'Good', color: '#65a30d', note: 'Within the usual aerobic range (under 5%).' };
  // Say what actually moved: slower at the same heart rate, or a higher heart rate at the same pace
  const why =
    speedPct < -3 && Math.abs(hrChange) < 4
      ? 'You slowed down at about the same heart rate: typical of fatigue, heat or walk breaks.'
      : hrChange > 4 && Math.abs(speedPct) < 3
        ? 'Heart rate climbed at a steady pace: typical of heat, dehydration or fatigue.'
        : hrChange > 4
          ? 'Heart rate rose and pace fell: fatigue, heat, or starting too fast.'
          : 'Pace per heartbeat dropped: fatigue, heat, fuelling or terrain.';
  return d < 8 ? { label: 'Moderate', color: '#d97706', note: why } : { label: 'High', color: '#dc2626', note: why };
}

// Colour-runs for the map/video trail: by pace (default) or by HR zone
export function routeColorRuns(run, scale, mode, maxHr) {
  if (mode !== 'zone' || !maxHr || !hasHr(run)) return colorRuns(run, scale);
  const s = hrSmooth(run);
  const out = [];
  let lastZone = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const hr = !Number.isNaN(s[i]) ? s[i] : null;
    const z = hr == null ? lastZone : zoneIndex(hr, maxHr);
    lastZone = z;
    const last = out[out.length - 1];
    if (last && last.bucket === z) last.to = i + 1;
    else out.push({ from: i, to: i + 1, bucket: z, color: ZONES[z].color });
  }
  return out;
}
