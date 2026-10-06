import { useMemo } from 'react';
import { colorFor } from '../lib/analysis.js';
import { analyzeFade, computeSplits } from '../lib/splits.js';
import { KM_PER_MI, formatDuration, formatElevation, formatPace } from '../lib/format.js';

const signed = (v, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;

export default function SplitsPanel({ run, units, basis, onBasis }) {
  const unitMeters = units === 'mi' ? 1000 * KM_PER_MI : 1000;
  const splits = useMemo(() => computeSplits(run, unitMeters, basis), [run, unitMeters, basis]);
  const fade = useMemo(() => analyzeFade(run, splits, basis), [run, splits, basis]);
  if (!fade) return null;

  const speeds = splits.map((s) => s.speed);
  const top = Math.max(...speeds);
  const low = Math.min(...speeds);
  const avg = run.stats.avgSpeed;
  const hasHr = splits.some((s) => s.hr != null);
  const hasElev = splits.some((s) => s.elev != null);
  const cols = `38px 1fr 46px${hasHr ? ' 34px' : ''}${hasElev ? ' 46px' : ''}`;
  const secPerUnit = (v) => unitMeters / v;
  const diffLabel = (a, b) => {
    const d = secPerUnit(b) - secPerUnit(a); // seconds per unit; + = slower
    const m = Math.floor(Math.abs(d) / 60);
    const s = Math.round(Math.abs(d) % 60);
    return `${d <= 0 ? '−' : '+'}${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="splitsview" onClick={(e) => e.stopPropagation()}>
      <h4>
        Splits &amp; fade <span className="verdict" style={{ color: fade.verdict.color }}>{fade.verdict.label}</span>
      </h4>

      <div className="seg paceseg" role="group" aria-label="Pace basis">
        <button className={basis === 'moving' ? 'on' : ''} aria-pressed={basis === 'moving'} onClick={() => onBasis('moving')} title="Pace over time spent moving: stops are left out">Moving pace</button>
        <button className={basis === 'elapsed' ? 'on' : ''} aria-pressed={basis === 'elapsed'} onClick={() => onBasis('elapsed')} title="Pace over total clock time, stops included">Elapsed pace</button>
      </div>

      <div className="fadegrid">
        <div>
          <small>1st half</small>
          <b>{formatPace(fade.first, units, false)}</b>
        </div>
        <div>
          <small>2nd half</small>
          <b>{formatPace(fade.second, units, false)}</b>
          <em style={{ color: fade.halfPct >= 0 ? '#16a34a' : '#d97706' }}>{diffLabel(fade.first, fade.second)} /{units}</em>
        </div>
        <div>
          <small>Last vs first quarter</small>
          <b style={{ color: fade.fadePct >= 0 ? '#16a34a' : '#d97706' }}>{signed(fade.fadePct)}%</b>
          <em>speed</em>
        </div>
        {fade.consistency && (
          <div>
            <small>Consistency</small>
            <b>{fade.consistency}</b>
            <em>±{fade.cv.toFixed(1)}% between splits</em>
          </div>
        )}
        {run.stops.length > 0 && run.stats.duration - run.stats.movingTime > 30000 && (
          <div title="Time spent stopped or barely moving (traffic lights, water breaks).">
            <small>Stopped · moving {formatDuration(run.stats.movingTime)}</small>
            <b>{formatDuration(run.stats.duration - run.stats.movingTime)}</b>
            <em>
              {run.stops.length} stop{run.stops.length === 1 ? '' : 's'}, longest {formatDuration(Math.max(...run.stops.map((x) => x.dur)))}
            </em>
          </div>
        )}
        {fade.fastest && (
          <div>
            <small>Fastest {units}</small>
            <b>{formatPace(fade.fastest.speed, units, false)}</b>
            <em>{units} {fade.fastest.n}</em>
          </div>
        )}
        {fade.slowest && (
          <div>
            <small>Slowest {units}</small>
            <b>{formatPace(fade.slowest.speed, units, false)}</b>
            <em>{units} {fade.slowest.n}</em>
          </div>
        )}
      </div>

      <div className="splitrows" role="table" aria-label={`Splits per ${units}`}>
        <div className="splithead" role="row" style={{ gridTemplateColumns: cols }}>
          <span>{units}</span>
          <span />
          <span>pace</span>
          {hasHr && <span>HR</span>}
          {hasElev && <span>elev</span>}
        </div>
        {splits.map((s) => {
          // bar length: slowest split 35%, fastest 100% of the track; colour: green fast to red slow within this run
          const span = top - low || 1;
          const rel = (s.speed - low) / span;
          return (
            <div key={s.n} className={`splitrow ${s === fade.fastest ? 'best' : ''}`} role="row" style={{ gridTemplateColumns: cols }} title={`${formatDuration(s.ms)} for ${s.full ? '1' : (s.meters / unitMeters).toFixed(2)} ${units}`}>
              <span>
                {s.full ? s.n : `${(s.meters / unitMeters).toFixed(2)}`}
                {s.stoppedMs > 5000 && <b className="pause" title={`${formatDuration(s.stoppedMs)} stopped in this split`}>⏸</b>}
              </span>
              <span className="bar">
                <i style={{ width: `${35 + rel * 65}%`, background: colorFor(1 - rel) }} />
                <u style={{ left: `${35 + ((avg - low) / span) * 65}%` }} title="average pace" />
              </span>
              <span className="pace">{formatPace(s.speed, units, false)}</span>
              {hasHr && <span className="muted">{s.hr != null ? Math.round(s.hr) : '--'}</span>}
              {hasElev && <span className="muted">{s.elev != null ? `${s.elev >= 0 ? '+' : '−'}${formatElevation(Math.abs(s.elev), units).replace(' ', '')}` : '--'}</span>}
            </div>
          );
        })}
      </div>
      <small className="muted">
        {basis === 'moving' ? 'Pace ignores time stopped (⏸ marks splits with a stop).' : 'Pace includes any time stopped.'} Bars: longer = faster within this run; the thin line is the run's average. A shortened last row is the final partial {units}.
      </small>
    </div>
  );
}
