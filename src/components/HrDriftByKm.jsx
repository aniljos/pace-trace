import { useMemo } from 'react';
import { driftByUnit } from '../lib/hrdrift.js';
import { KM_PER_MI, formatElevation, formatPace } from '../lib/format.js';

const W = 360;
const H = 210;
const M = { l: 36, r: 34, t: 10 };
const LINE_H = 100; // pace + HR lines
const BAR_TOP = 138;
const BAR_H = 44;

const driftColor = (d) => (d < 3 ? '#16a34a' : d < 5 ? '#84cc16' : d < 8 ? '#d97706' : '#dc2626');
const signed = (v, d = 0) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;

export default function HrDriftByKm({ run, units }) {
  const unitMeters = units === 'mi' ? 1000 * KM_PER_MI : 1000;
  const data = useMemo(() => driftByUnit(run, unitMeters, units), [run, unitMeters, units]);
  if (!data) return null;
  const { rows } = data;
  const n = rows.length;

  const plotW = W - M.l - M.r;
  const x = (i) => M.l + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const speeds = rows.map((r) => r.speed);
  const hrs = rows.map((r) => r.hr);
  const sMin = Math.min(...speeds);
  const sMax = Math.max(...speeds);
  const hMin = Math.min(...hrs);
  const hMax = Math.max(...hrs);
  const pad = (a, b) => (b - a || 1) * 0.12;
  const sLo = sMin - pad(sMin, sMax);
  const sHi = sMax + pad(sMin, sMax);
  const hLo = hMin - pad(hMin, hMax);
  const hHi = hMax + pad(hMin, hMax);
  const ySpeed = (v) => M.t + LINE_H - ((v - sLo) / (sHi - sLo)) * LINE_H; // faster = higher
  const yHr = (v) => M.t + LINE_H - ((v - hLo) / (hHi - hLo)) * LINE_H;
  const path = (f, key) => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${f(r[key]).toFixed(1)}`).join(' ');

  const maxDrift = Math.max(10, ...rows.map((r) => Math.abs(r.drift)));
  const zeroY = BAR_TOP + BAR_H * 0.72;
  const barW = Math.max(3, Math.min(16, (plotW / n) * 0.7));
  const step = n > 16 ? Math.ceil(n / 12) : 1;
  const hasElev = rows.some((r) => r.elev != null);
  const cols = `30px repeat(4, 1fr) 1.1fr${hasElev ? ' 1fr' : ''}`;

  return (
    <div className="kmdrift">
      <h4>Drift by {units}</h4>
      <ul className="insights">
        {data.insights.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>

      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Pace and heart rate per ${units}, with drift`} className="kmchart">
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={M.l} x2={W - M.r} y1={M.t + LINE_H * f} y2={M.t + LINE_H * f} className="kmgrid" />
        ))}
        {/* baseline shading */}
        <rect
          x={x(data.skip) - 6}
          width={x(data.skip + data.nBase - 1) - x(data.skip) + 12}
          y={M.t}
          height={LINE_H}
          fill="#64748b"
          opacity="0.12"
        >
          <title>Baseline: {data.baseLabel}</title>
        </rect>
        <path d={path(ySpeed, 'speed')} fill="none" stroke="#3b82f6" strokeWidth="2" />
        <path d={path(yHr, 'hr')} fill="none" stroke="#ef4444" strokeWidth="2" />
        {rows.map((r, i) => (
          <g key={r.n}>
            <circle cx={x(i)} cy={ySpeed(r.speed)} r="2.6" fill="#3b82f6" />
            <circle cx={x(i)} cy={yHr(r.hr)} r="2.6" fill="#ef4444">
              <title>{`${units} ${r.n}: ${formatPace(r.speed, units)}, ${Math.round(r.hr)} bpm, drift ${signed(r.drift, 1)}%`}</title>
            </circle>
          </g>
        ))}
        {/* axes: pace on the left (faster is up), heart rate on the right */}
        <text x={M.l - 4} y={M.t + 8} textAnchor="end" className="kmtxt" fill="#3b82f6">{formatPace(sHi, units, false)}</text>
        <text x={M.l - 4} y={M.t + LINE_H} textAnchor="end" className="kmtxt" fill="#3b82f6">{formatPace(sLo, units, false)}</text>
        <text x={W - M.r + 4} y={M.t + 8} className="kmtxt" fill="#ef4444">{Math.round(hHi)}</text>
        <text x={W - M.r + 4} y={M.t + LINE_H} className="kmtxt" fill="#ef4444">{Math.round(hLo)}</text>

        {/* drift bars */}
        <text x={M.l - 4} y={BAR_TOP + 8} textAnchor="end" className="kmtxt">drift</text>
        <line x1={M.l} x2={W - M.r} y1={zeroY} y2={zeroY} className="kmgrid" />
        {rows.map((r, i) => {
          const h = (Math.min(Math.abs(r.drift), maxDrift) / maxDrift) * (BAR_H * 0.68);
          const up = r.drift >= 0;
          return (
            <rect key={r.n} x={x(i) - barW / 2} width={barW} y={up ? zeroY - h : zeroY} height={Math.max(h, 1)} rx="1.5" fill={up ? driftColor(r.drift) : '#94a3b8'} opacity={r.isBase ? 0.45 : 1}>
              <title>{`${units} ${r.n}: efficiency ${signed(-r.drift, 1)}% vs baseline`}</title>
            </rect>
          );
        })}
        {rows.map((r, i) =>
          i % step === 0 || i === n - 1 ? (
            <text key={r.n} x={x(i)} y={H - 6} textAnchor="middle" className="kmtxt">{r.n}</text>
          ) : null,
        )}
        <text x={M.l} y={H - 6} textAnchor="end" className="kmtxt" dx="-12">{units}</text>
      </svg>
      <div className="kmkey">
        <span><i style={{ background: '#3b82f6' }} />pace (up = faster)</span>
        <span><i style={{ background: '#ef4444' }} />heart rate</span>
        <span><i style={{ background: '#d97706' }} />drift: efficiency lost vs {data.baseLabel}</span>
      </div>

      <details open>
        <summary>Per-{units} table</summary>
        <div className="kmtable">
          <div className="kmrow kmhead" style={{ gridTemplateColumns: cols }}>
            <span>{units}</span>
            <span>pace</span>
            <span>HR</span>
            <span>Δ pace</span>
            <span>Δ HR</span>
            <span>drift</span>
            {hasElev && <span>elev</span>}
          </div>
          {rows.map((r) => (
            <div key={r.n} className={`kmrow ${r.isBase ? 'base' : ''}`} style={{ gridTemplateColumns: cols }}>
              <span>{r.n}</span>
              <span className="pace">{formatPace(r.speed, units, false)}</span>
              <span>{Math.round(r.hr)}</span>
              <span className="muted">{r.isBase ? '—' : `${signed(r.dSpeedPct, 1)}%`}</span>
              <span className="muted">{r.isBase ? '—' : signed(r.dHr, 0)}</span>
              <span style={{ color: r.isBase ? undefined : driftColor(r.drift), fontWeight: 600 }}>{r.isBase ? 'base' : `${signed(r.drift, 1)}%`}</span>
              {hasElev && <span className="muted">{r.elev != null ? `${r.elev >= 0 ? '+' : '−'}${formatElevation(Math.abs(r.elev), units).replace(' ', '')}` : '--'}</span>}
            </div>
          ))}
        </div>
      </details>
      <small className="muted">
        Efficiency = speed per heartbeat, over moving time (stops excluded). Δ values compare each {units} with the baseline ({data.baseLabel}
        {data.skip ? ', after skipping the warm-up km' : ''}). Climbs raise heart rate without meaning fatigue, so check the elevation column.
      </small>
    </div>
  );
}
