import { useMemo, useRef } from 'react';
import { formatDuration, formatElevation, formatPace, formatTemp } from '../lib/format.js';
import { weatherAt } from '../lib/weather.js';
import { ZONES } from '../lib/hr.js';

const W = 1000;
const H = 160;
const MAX_POINTS = 500;

const METRICS = {
  elevation: { label: 'Elevation', get: (r, i) => r.points[i].ele },
  pace: { label: 'Pace', get: (r, i) => (r.speed[i] > 0.5 ? r.speed[i] : null) },
  hr: { label: 'Heart rate', get: (r, i) => r.points[i].hr },
  temp: { label: 'Temperature', weather: true, get: (r, i, w) => (w ? weatherAt(w, r.startTime + r.ts[i]).temp : null) },
  aqi: { label: 'Air quality', weather: true, get: (r, i, w) => (w ? weatherAt(w, r.startTime + r.ts[i]).aqi : null) },
  humidity: { label: 'Humidity', weather: true, get: (r, i, w) => (w ? weatherAt(w, r.startTime + r.ts[i]).rh : null) },
};

function fmt(metric, v, units, tempUnit) {
  if (metric === 'temp') return formatTemp(v, tempUnit);
  if (metric === 'humidity') return `${Math.round(v)}%`;
  if (metric === 'aqi') return `AQI ${Math.round(v)}`;
  if (metric === 'elevation') return formatElevation(v, units);
  if (metric === 'pace') return formatPace(v, units, false);
  return `${Math.round(v)} bpm`;
}

export default function Chart({ runs, metric, onMetric, elapsed, duration, onSeek, units, tempUnit, weather, weatherOn, maxHr }) {
  const ref = useRef(null);
  const dragging = useRef(false);

  const { series, min, max, hasData } = useMemo(() => {
    const get = METRICS[metric].get;
    const raw = runs.map((r) => {
      const step = Math.max(1, Math.floor(r.ts.length / MAX_POINTS));
      const pts = [];
      for (let i = 0; i < r.ts.length; i += step) {
        const v = get(r, i, weather[r.id]?.data);
        if (v != null) pts.push([r.ts[i], v]);
      }
      return pts;
    });
    const vals = raw.flat().map((p) => p[1]);
    if (!vals.length) return { series: [], min: 0, max: 1, hasData: false };
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < 1e-6) hi = lo + 1;
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
    return { series: raw, min: lo, max: hi, hasData: true };
  }, [runs, metric, weather]);

  const x = (t) => (t / duration) * W;
  const paths = useMemo(
    () =>
      series.map((pts) =>
        pts.map(([t, v]) => `${((t / duration) * W).toFixed(1)},${(H - ((v - min) / (max - min)) * H).toFixed(1)}`).join(' '),
      ),
    [series, min, max, duration],
  );

  function seekFromEvent(e) {
    const rect = ref.current.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onSeek(f * duration);
  }

  const statuses = runs.map((r) => weather[r.id]?.status);
  const emptyText = METRICS[metric].weather
    ? statuses.some((st) => st === 'loading' || st == null)
      ? 'Loading weather…'
      : metric === 'aqi' && statuses.some((st) => st === 'ok')
        ? 'No air-quality data for this place and date'
        : 'Weather unavailable (offline, or no data for this date)'
    : `No ${METRICS[metric].label.toLowerCase()} data in the loaded files`;

  return (
    <div className="chart">
      <div className="chart-head">
        <div className="tabs" role="tablist">
          {Object.entries(METRICS).filter(([, m]) => weatherOn || !m.weather).map(([k, m]) => (
            <button key={k} role="tab" aria-selected={metric === k} className={metric === k ? 'on' : ''} onClick={() => onMetric(k)}>
              {m.label}
            </button>
          ))}
        </div>
        {metric === 'pace' && <span className="hint">higher = faster</span>}
      </div>
      <div
        className="chart-body"
        ref={ref}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromEvent(e);
        }}
        onPointerMove={(e) => dragging.current && seekFromEvent(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        {hasData ? (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
              {metric === 'hr' && maxHr &&
                ZONES.map((z) => {
                  const top = Math.min(max, Number.isFinite(z.hi) ? z.hi * maxHr : max);
                  const bottom = Math.max(min, z.lo * maxHr);
                  if (top <= bottom) return null;
                  const yTop = H - ((top - min) / (max - min)) * H;
                  const yBot = H - ((bottom - min) / (max - min)) * H;
                  return <rect key={z.id} x="0" width={W} y={yTop} height={yBot - yTop} fill={z.color} opacity="0.16" />;
                })}
              {[0.25, 0.5, 0.75].map((f) => (
                <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} className="grid" />
              ))}
              {paths.map((pts, i) => (
                <polyline
                  key={runs[i].id}
                  fill="none"
                  stroke={runs[i].color}
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                  points={paths[i]}
                />
              ))}
              <line x1={x(elapsed)} x2={x(elapsed)} y1="0" y2={H} className="cursor" vectorEffect="non-scaling-stroke" />
            </svg>
            <span className="ylab top">{fmt(metric, max, units, tempUnit)}</span>
            <span className="ylab bottom">{fmt(metric, min, units, tempUnit)}</span>
          </>
        ) : (
          <div className="empty-chart">{emptyText}</div>
        )}
      </div>
      <div className="xaxis">
        <span>0:00</span>
        <span>{formatDuration(duration / 2)}</span>
        <span>{formatDuration(duration)}</span>
      </div>
    </div>
  );
}
