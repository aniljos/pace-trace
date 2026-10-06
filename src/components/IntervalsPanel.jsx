import { useMemo } from 'react';
import { detectIntervals } from '../lib/intervals.js';
import { KM_PER_MI, formatDuration, formatPace } from '../lib/format.js';

const signed = (v, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;

function fmtDist(m, units) {
  if (units === 'mi') return `${(m / 1000 / KM_PER_MI).toFixed(2)} mi`;
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

export default function IntervalsPanel({ run, units, onSeek }) {
  const found = useMemo(() => detectIntervals(run), [run]);

  if (!found) {
    return (
      <div className="intervals" onClick={(e) => e.stopPropagation()}>
        <h4>Intervals</h4>
        <p className="muted small">No repeated hard efforts found: this looks like a steady run.</p>
      </div>
    );
  }
  const { reps, summary: s, kind } = found;
  const hasHr = reps.some((r) => r.avgHr != null);
  const hasRec = reps.some((r) => r.rec);
  const typical =
    s.basis === 'time'
      ? formatDuration(Math.round(s.avgMs / 15000) * 15000)
      : `~${fmtDist(Math.round(s.avgDist / 50) * 50, units)}`;
  const label = kind === 'run/walk' ? 'run / walk blocks' : s.regular ? 'intervals' : 'variable efforts';

  return (
    <div className="intervals" onClick={(e) => e.stopPropagation()}>
      <h4>
        Intervals <span className="muted small">{label}</span>
      </h4>
      <p className="intsum">
        <b>
          {s.count} × {typical}
        </b>{' '}
        at <b>{formatPace(s.avgSpeed, units)}</b>
        <span className="muted"> · avg {fmtDist(s.avgDist, units)}, {formatDuration(s.avgMs)} each</span>
      </p>
      <div className="fadegrid">
        <div>
          <small>First → last rep</small>
          <b style={{ color: s.speedChangePct >= -1 ? '#16a34a' : '#d97706' }}>{signed(s.speedChangePct)}%</b>
          <em>speed</em>
        </div>
        <div>
          <small>Pace spread</small>
          <b>±{s.paceSpread.toFixed(1)}%</b>
          <em>{s.paceSpread < 3 ? 'very even' : s.paceSpread < 6 ? 'steady' : 'varied'}</em>
        </div>
        {s.hrFirst != null && (
          <div>
            <small>Avg HR first → last</small>
            <b>
              {Math.round(s.hrFirst)} → {Math.round(s.hrLast)}
            </b>
            <em>{signed(s.hrLast - s.hrFirst, 0)} bpm</em>
          </div>
        )}
      </div>

      <div className="reptable" role="table" aria-label="Efforts">
        <div className="rephead" role="row" style={{ gridTemplateColumns: cols(hasHr, hasRec) }}>
          <span>#</span>
          <span>dist</span>
          <span>time</span>
          <span>pace</span>
          {hasHr && <span>HR avg/max</span>}
          {hasRec && <span>recovery</span>}
        </div>
        {reps.map((r) => (
          <button
            key={r.n}
            className="reprow"
            role="row"
            style={{ gridTemplateColumns: cols(hasHr, hasRec) }}
            onClick={() => onSeek(Math.max(0, r.t0 - 5000))}
            title="Jump the replay to the start of this effort"
          >
            <span>{r.n}</span>
            <span>{fmtDist(r.dist, units)}</span>
            <span>{formatDuration(r.ms)}</span>
            <span className="pace">{formatPace(r.speed, units, false)}</span>
            {hasHr && (
              <span className="muted">
                {r.avgHr != null ? Math.round(r.avgHr) : '--'}/{r.maxHr ?? '--'}
              </span>
            )}
            {hasRec && (
              <span className="muted">
                {r.rec ? `${formatDuration(r.rec.ms)}${r.rec.hrDrop != null ? ` ↓${Math.round(r.rec.hrDrop)}` : ''}` : '--'}
              </span>
            )}
          </button>
        ))}
      </div>
      <small className="muted">
        Efforts are found from changes in speed (hard = above {formatPace(found.threshold, units)}). Recovery shows the time until the next effort and the heart-rate drop
        in the first minute. Click a row to jump there.
      </small>
    </div>
  );
}

function cols(hasHr, hasRec) {
  return `22px 62px 46px 46px${hasHr ? ' 56px' : ''}${hasRec ? ' 1fr' : ''}`;
}
