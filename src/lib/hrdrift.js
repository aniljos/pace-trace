import { computeSplits } from './splits.js';
import { formatPace } from './format.js';

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// Kilometre-by-kilometre (or mile-by-mile) heart-rate drift.
// Efficiency = speed per heartbeat. Drift for a split = how much efficiency has fallen against an early baseline.
// Baseline = km 2-4 on runs of 8+ splits (km 1 is warm-up), otherwise km 1-2.
export function driftByUnit(run, unitMeters, units) {
  const splits = computeSplits(run, unitMeters, 'moving').filter((s) => s.full && s.hr != null);
  if (splits.length < 4) return null;

  const skip = splits.length >= 8 ? 1 : 0;
  const nBase = splits.length >= 8 ? 3 : 2;
  const base = splits.slice(skip, skip + nBase);
  const baseEf = mean(base.map((s) => s.speed / s.hr));
  const baseHr = mean(base.map((s) => s.hr));
  const baseSpeed = mean(base.map((s) => s.speed));

  const rows = splits.map((s, i) => {
    const ef = s.speed / s.hr;
    return {
      ...s,
      ef,
      drift: ((baseEf - ef) / baseEf) * 100, // + = less efficient than the baseline
      dHr: s.hr - baseHr,
      dSpeedPct: ((s.speed - baseSpeed) / baseSpeed) * 100,
      isBase: i >= skip && i < skip + nBase,
    };
  });

  // Onset: first split after the baseline where drift is 5%+ and stays there for the next split too
  let onset = null;
  for (let i = skip + nBase; i < rows.length; i++) {
    if (rows[i].drift >= 5 && (i === rows.length - 1 || rows[i + 1].drift >= 5)) {
      onset = rows[i];
      break;
    }
  }

  const tail = rows.slice(-Math.min(3, rows.length - skip - nBase));
  const endHr = mean(tail.map((s) => s.hr));
  const endSpeed = mean(tail.map((s) => s.speed));
  const endDrift = mean(tail.map((s) => s.drift));
  const peak = rows.reduce((a, b) => (b.drift > a.drift ? b : a));
  const baseLabel = base.length > 1 ? `${units} ${base[0].n}–${base[base.length - 1].n}` : `${units} ${base[0].n}`;
  const tailLabel = tail.length > 1 ? `${units} ${tail[0].n}–${tail[tail.length - 1].n}` : `${units} ${tail[0].n}`;

  const insights = [];
  insights.push(
    `Early (${baseLabel}) you ran ${formatPace(baseSpeed, units)} at ${Math.round(baseHr)} bpm. At the end (${tailLabel}): ${formatPace(endSpeed, units)} at ${Math.round(endHr)} bpm.`,
  );
  if (onset) insights.push(`Efficiency first dropped 5% or more at ${units} ${onset.n} and stayed down.`);
  else if (endDrift < 5) insights.push('Efficiency stayed within 5% of the early baseline all the way through.');
  else insights.push(`Efficiency ended ${endDrift.toFixed(0)}% down, but not in one clear step.`);
  const hrUp = endHr - baseHr;
  const spPct = ((endSpeed - baseSpeed) / baseSpeed) * 100;
  if (endDrift >= 5) {
    insights.push(
      spPct < -3 && Math.abs(hrUp) < 4
        ? 'Pace fell while heart rate stayed flat: you slowed rather than your heart working harder.'
        : hrUp > 4 && Math.abs(spPct) < 3
          ? 'Heart rate climbed at a steady pace: classic cardiac drift (heat, dehydration, fatigue).'
          : hrUp > 4
            ? 'Heart rate rose and pace fell together: fatigue, heat or an early pace that was too hard.'
            : 'Pace per heartbeat dropped: fatigue, heat, fuelling or terrain.',
    );
  }

  return { rows, baseLabel, baseHr, baseSpeed, endDrift, peak, onset, insights, skip, nBase };
}
