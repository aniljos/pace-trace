import { indexAt, movingAt, pointAtDistance, readingsAt } from './analysis.js';
import { hrSmooth } from './hr.js';

// Per-km (or per-mile) splits with pace, average heart rate and net elevation change.
export function computeSplits(run, unitMeters, basis = 'moving') {
  const total = run.stats.distance;
  const duration = run.ts[run.ts.length - 1];
  const hr = hrSmooth(run);
  const out = [];
  const count = Math.ceil(total / unitMeters - 1e-9);
  for (let k = 0; k < count; k++) {
    const d0 = k * unitMeters;
    const d1 = Math.min((k + 1) * unitMeters, total);
    if (d1 - d0 < 30) continue; // sliver at the very end
    const t0 = d0 === 0 ? 0 : pointAtDistance(run, d0).t;
    const t1 = d1 >= total ? duration : pointAtDistance(run, d1).t;
    const ms = t1 - t0;
    if (ms <= 0) continue;
    const movingMs = Math.max(1, movingAt(run, t1) - movingAt(run, t0));
    const useMs = basis === 'moving' ? movingMs : ms;

    let sum = 0;
    let c = 0;
    let allSum = 0;
    let allC = 0;
    for (let i = indexAt(run.ts, t0); i <= indexAt(run.ts, t1); i++) {
      if (Number.isNaN(hr[i])) continue;
      allSum += hr[i];
      allC++;
      if (i < run.moving.length - 1 && run.moving[i + 1] === run.moving[i]) continue; // stopped sample
      sum += hr[i];
      c++;
    }
    if (!c) {
      sum = allSum;
      c = allC;
    }
    const e0 = readingsAt(run, t0).ele;
    const e1 = readingsAt(run, t1).ele;
    out.push({
      n: k + 1,
      meters: d1 - d0,
      full: d1 - d0 >= unitMeters * 0.999,
      ms,
      movingMs,
      stoppedMs: Math.max(0, ms - movingMs),
      speed: (d1 - d0) / (useMs / 1000),
      hr: c ? sum / c : null,
      elev: e0 != null && e1 != null ? e1 - e0 : null,
    });
  }
  return out;
}

// Average speed between two distances along the run (m/s), over moving or elapsed time
function speedBetween(run, d0, d1, basis) {
  const duration = run.ts[run.ts.length - 1];
  const t0 = d0 <= 0 ? 0 : pointAtDistance(run, d0).t;
  const t1 = d1 >= run.stats.distance ? duration : pointAtDistance(run, d1).t;
  const ms = basis === 'moving' ? movingAt(run, t1) - movingAt(run, t0) : t1 - t0;
  return ms > 0 ? (d1 - d0) / (ms / 1000) : null;
}

// Does the runner fade, hold steady or finish strong?
export function analyzeFade(run, splits, basis = 'moving') {
  const total = run.stats.distance;
  if (splits.length < 2) return null;

  const first = speedBetween(run, 0, total / 2, basis);
  const second = speedBetween(run, total / 2, total, basis);
  const halfPct = ((second - first) / first) * 100; // + = faster second half
  const q1 = speedBetween(run, 0, total / 4, basis);
  const q4 = speedBetween(run, (total * 3) / 4, total, basis);
  const fadePct = ((q4 - q1) / q1) * 100;

  const full = splits.filter((s) => s.full);
  let cv = null;
  if (full.length >= 3) {
    const paces = full.map((s) => 1000 / s.speed); // seconds per km, any unit works for a ratio
    const mean = paces.reduce((a, b) => a + b, 0) / paces.length;
    const sd = Math.sqrt(paces.reduce((a, b) => a + (b - mean) ** 2, 0) / paces.length);
    cv = (sd / mean) * 100;
  }
  const fastest = full.length ? full.reduce((a, b) => (b.speed > a.speed ? b : a)) : null;
  const slowest = full.length ? full.reduce((a, b) => (b.speed < a.speed ? b : a)) : null;

  const verdict =
    Math.abs(halfPct) < 1
      ? { label: 'Even split', color: '#16a34a' }
      : halfPct > 0
        ? { label: 'Negative split', color: '#16a34a' }
        : Math.abs(halfPct) < 4
          ? { label: 'Slight fade', color: '#d97706' }
          : { label: 'Faded', color: '#dc2626' };

  return {
    first,
    second,
    halfPct,
    q1,
    q4,
    fadePct,
    cv,
    consistency: cv == null ? null : cv < 3 ? 'Very even' : cv < 6 ? 'Steady' : cv < 10 ? 'Variable' : 'Very uneven',
    fastest,
    slowest,
    verdict,
  };
}
