import { stateAt } from '../lib/analysis.js';
import { distanceValue, formatDistance, formatDuration, formatElevation, formatPace, formatTemp, aqiCategory } from '../lib/format.js';
import { weatherAt, weatherSummary } from '../lib/weather.js';
import HrPanel from './HrPanel.jsx';
import SplitsPanel from './SplitsPanel.jsx';
import IntervalsPanel from './IntervalsPanel.jsx';

export default function RunList({ runs, elapsed, units, tempUnit, weather, weatherOn, maxHr, paceBasis, onPaceBasis, onSeek, focusId, onFocus, onRemove }) {
  const compare = runs.length > 1;
  // Leader = furthest along at the current moment
  const live = runs.map((r) => stateAt(r, Math.min(elapsed, r.ts[r.ts.length - 1])));
  const leadDist = Math.max(...live.map((s) => s.dist));
  const durations = runs.map((r) => r.stats.duration);
  const bestDuration = Math.min(...durations);

  return (
    <div className="runs">
      {runs.map((r, k) => {
        const st = live[k];
        const gap = st.dist - leadDist;
        const wx = weather[r.id];
        const now = wx?.data ? weatherAt(wx.data, r.startTime + Math.min(elapsed, r.stats.duration)) : null;
        const sum = wx?.data ? weatherSummary(wx.data, r) : null;
        const cat = aqiCategory(now?.aqi);
        const sumCat = aqiCategory(sum?.aqi);
        const ph = wx?.status === 'error' ? '--' : '…';
        return (
          <article key={r.id} className={`run ${focusId === r.id ? 'focus' : ''}`} onClick={() => onFocus(r.id)}>
            <header>
              <span className="swatch" style={{ background: r.color }} />
              <h3 title={r.name}>{r.name}</h3>
              <button
                className="x"
                aria-label={`Remove ${r.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(r.id);
                }}
              >
                ✕
              </button>
            </header>
            <p className="date">{new Date(r.startTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>

            <div className="live">
              <div>
                <b>{formatPace(st.speed, units, false)}</b>
                <small>pace /{units}</small>
              </div>
              <div>
                <b>{distanceValue(st.dist, units).toFixed(2)}</b>
                <small>{units} covered</small>
              </div>
              <div>
                <b>{st.hr != null ? Math.round(st.hr) : '--'}</b>
                <small>bpm</small>
              </div>
              <div>
                <b>{formatElevation(st.ele, units)}</b>
                <small>elevation</small>
              </div>
            </div>
            {weatherOn && (
              <div className="live wx" title={wx?.status === 'error' ? `Weather unavailable: ${wx.error}` : 'Conditions at this moment of the run'}>
                <div>
                  <b>{now ? formatTemp(now.temp, tempUnit) : ph}</b>
                  <small>temperature</small>
                </div>
                <div>
                  <b>{now ? `${Math.round(now.rh)}%` : ph}</b>
                  <small>humidity</small>
                </div>
                <div>
                  <b>{now ? formatTemp(now.feels, tempUnit) : ph}</b>
                  <small>feels like</small>
                </div>
                <div title={cat ? `US AQI: ${cat.label}` : 'No air-quality data'}>
                  <b style={cat ? { color: cat.color } : undefined}>{now ? (now.aqi != null ? Math.round(now.aqi) : '--') : ph}</b>
                  <small>{cat ? `AQI · ${cat.label.split(' ')[0]}` : 'air quality'}</small>
                </div>
              </div>
            )}
            {weatherOn && sum && (
              <p className="wx-src">
                Weather looked up for {Math.abs(r.points[0].lat).toFixed(2)}°{r.points[0].lat >= 0 ? 'N' : 'S'}, {Math.abs(r.points[0].lon).toFixed(2)}°{r.points[0].lon >= 0 ? 'E' : 'W'} ·{' '}
                {new Date(r.startTime).toISOString().slice(0, 16).replace('T', ' ')}–{new Date(r.startTime + r.stats.duration).toISOString().slice(11, 16)} UTC
              </p>
            )}
            {compare && (
              <p className="gap">
                {st.finished
                  ? `Finished in ${formatDuration(r.stats.duration)}${r.stats.duration === bestDuration ? ' 🏆' : ` (+${formatDuration(r.stats.duration - bestDuration)})`}`
                  : gap < -1
                    ? `${Math.round(-gap)} m behind leader`
                    : 'Leading'}
              </p>
            )}

            <dl className="totals">
              <div><dt>Distance</dt><dd>{formatDistance(r.stats.distance, units)}</dd></div>
              <div><dt>Time</dt><dd>{formatDuration(r.stats.duration)}</dd></div>
              <div><dt>Avg pace</dt><dd>{formatPace(r.stats.avgSpeed, units)}</dd></div>
              {r.stats.elevGain != null && <div><dt>Climb</dt><dd>{formatElevation(r.stats.elevGain, units)}</dd></div>}
              {sum && <div><dt>Temperature</dt><dd>{formatTemp(sum.temp, tempUnit)}{Math.abs(sum.max - sum.min) >= 1 ? ` (${formatTemp(sum.min, tempUnit)}–${formatTemp(sum.max, tempUnit)})` : ''}</dd></div>}
              {sum && <div><dt>Humidity</dt><dd>{Math.round(sum.rh)}% avg</dd></div>}
              {sum && <div><dt>Feels like</dt><dd>{formatTemp(sum.feels, tempUnit)}</dd></div>}
              {sum && sum.aqi != null && (
                <div>
                  <dt>Air quality</dt>
                  <dd style={{ color: sumCat.color }}>AQI {Math.round(sum.aqi)} · {sumCat.label}</dd>
                </div>
              )}
              {sum && sum.pm25 != null && <div><dt>PM2.5</dt><dd>{sum.pm25.toFixed(1)} µg/m³</dd></div>}
              {r.stats.avgHr != null && <div><dt>Avg HR</dt><dd>{Math.round(r.stats.avgHr)} bpm</dd></div>}
            </dl>
            <HrPanel run={r} maxHr={maxHr} units={units} />
            <SplitsPanel run={r} units={units} basis={paceBasis} onBasis={onPaceBasis} />
            <IntervalsPanel run={r} units={units} onSeek={onSeek} />
          </article>
        );
      })}
    </div>
  );
}
