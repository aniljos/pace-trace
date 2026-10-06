import { useMemo } from 'react';
import { ZONES, hasHr, hrDrift, timeInZones } from '../lib/hr.js';
import { formatDuration, formatPace } from '../lib/format.js';
import HrDriftByKm from './HrDriftByKm.jsx';

export default function HrPanel({ run, maxHr, units }) {
  const ok = hasHr(run) && maxHr;
  const zones = useMemo(() => (ok ? timeInZones(run, maxHr) : null), [run, maxHr, ok]);
  const drift = useMemo(() => (ok ? hrDrift(run) : null), [run, ok]);
  if (!ok) return null;

  return (
    <div className="hr" onClick={(e) => e.stopPropagation()}>
      <h4>Heart rate zones</h4>
      <div className="zonebar" role="img" aria-label="Time in each heart rate zone">
        {ZONES.map((z, i) => {
          const pct = zones.total ? (zones.ms[i] / zones.total) * 100 : 0;
          return pct > 0 ? <span key={z.id} style={{ width: `${pct}%`, background: z.color }} title={`Z${z.id} ${z.name}`} /> : null;
        })}
      </div>
      <table className="zonetable">
        <tbody>
          {ZONES.map((z, i) => {
            const pct = zones.total ? (zones.ms[i] / zones.total) * 100 : 0;
            const hiBpm = Number.isFinite(z.hi) ? Math.round(z.hi * maxHr) - 1 : null;
            const range = hiBpm == null ? `${Math.round(z.lo * maxHr)}+` : z.lo === 0 ? `<${Math.round(z.hi * maxHr)}` : `${Math.round(z.lo * maxHr)}–${hiBpm}`;
            return (
              <tr key={z.id}>
                <td><i style={{ background: z.color }} /> Z{z.id} {z.name}</td>
                <td className="muted">{range} bpm</td>
                <td>{formatDuration(zones.ms[i])}</td>
                <td className="num">{pct.toFixed(0)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h4>Heart rate drift</h4>
      {drift ? (
        <div className="drift">
          <div className="drift-head">
            <b style={{ color: drift.verdict.color }}>{drift.decoupling.toFixed(1)}%</b>
            <span style={{ color: drift.verdict.color }}>{drift.verdict.label}</span>
          </div>
          <p className="muted">{drift.verdict.note}</p>
          <table className="driftcmp">
            <thead>
              <tr><th /><th>First half</th><th>Second half</th><th>Change</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Pace</td>
                <td>{formatPace(drift.first.speed, units, false)}</td>
                <td>{formatPace(drift.second.speed, units, false)}</td>
                <td className="num">{drift.speedChangePct >= 0 ? '+' : ''}{drift.speedChangePct.toFixed(1)}% speed</td>
              </tr>
              <tr>
                <td>Avg HR</td>
                <td>{Math.round(drift.first.hr)}</td>
                <td>{Math.round(drift.second.hr)}</td>
                <td className="num">{drift.hrChange >= 0 ? '+' : ''}{drift.hrChange.toFixed(0)} bpm</td>
              </tr>
            </tbody>
          </table>
          <small className="muted">
            Drift = fall in speed-per-heartbeat from the first to the second half, moving time only
            {drift.warmupSkipped ? ', first 5 min skipped as warm-up' : ''}. Hills, heat and intervals distort it.
            {!drift.reliable && ' This run is short (under 20 min of data), so treat it as a rough guide.'}
          </small>
        </div>
      ) : (
        <p className="muted">Not enough moving heart-rate data (needs about 10 minutes).</p>
      )}
      <HrDriftByKm run={run} units={units} />
    </div>
  );
}
