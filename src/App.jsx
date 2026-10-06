import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView from './components/MapView.jsx';
import Controls, { SPEEDS } from './components/Controls.jsx';
import Chart from './components/Chart.jsx';
import RunList from './components/RunList.jsx';
import { analyze, makePaceScale, bucketColor } from './lib/analysis.js';
import { formatDistance, formatDuration, formatPace, formatTemp } from './lib/format.js';
import { parseActivityFile, parseGPX } from './lib/parse.js';
import { sampleNegative, sampleSteady } from './lib/sample.js';
import { fetchWeather, weatherSummary } from './lib/weather.js';
import { ZONES, estimateMaxHr, hasHr } from './lib/hr.js';
import { exportSupported, exportVideo } from './lib/exportVideo.js';

const COLORS = ['#3b82f6', '#a855f7', '#ec4899', '#06b6d4', '#6366f1'];
const MAX_RUNS = 5;
let nextId = 1;

function store(key, fallback, value) {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    else return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))]);
}

const longest = (list) => Math.max(0, ...list.map((r) => r.ts[r.ts.length - 1]));

function pickSpeed(durationMs) {
  const target = durationMs / 1000 / 40; // aim for a ~40 s replay
  return SPEEDS.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best), SPEEDS[0]);
}

export default function App() {
  const [runs, setRuns] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const [uiElapsed, setUiElapsed] = useState(0); // throttled copy for numeric readouts
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [units, setUnits] = useState('km');
  const [focusId, setFocusId] = useState(null);
  const [follow, setFollow] = useState(false); // default: static, zoomed-out map of the whole route
  const [played, setPlayed] = useState(false); // false until the user presses Start
  const [iconMode, setIconMode] = useState('dot');
  const [metric, setMetric] = useState('elevation');
  const [messages, setMessages] = useState([]);
  const [drag, setDrag] = useState(false);
  const [exporting, setExporting] = useState(null);
  const [video, setVideo] = useState(null); // { blob, ext, url } once an export has finished
  const [shareHint, setShareHint] = useState('');
  const [report, setReport] = useState(null); // { blob, ext, url, name } once a report has been built
  const [reportBusy, setReportBusy] = useState(false);
  const [reportHint, setReportHint] = useState('');
  const [reportFormat, setReportFormat] = useState(() => store('reportFormat', 'pdf'));
  const [maxHrInput, setMaxHrInput] = useState(() => store('maxHr', ''));
  const [paceBasis, setPaceBasis] = useState(() => store('paceBasis', 'moving'));
  const [colorMode, setColorMode] = useState('pace'); // 'pace' | 'zone'
  const [mapInVideo, setMapInVideo] = useState(() => store('mapInVideo', 'on') === 'on');
  const [busy, setBusy] = useState(null); // text shown while a file is being prepared
  const [tempUnit, setTempUnit] = useState(() => store('tempUnit', 'C'));
  const [weatherOn, setWeatherOn] = useState(() => store('weatherOn', 'on') === 'on');
  const [weather, setWeather] = useState({}); // run id -> { status: 'loading'|'ok'|'error', data?, error? }

  const scale = useMemo(() => makePaceScale(runs), [runs]);
  const autoMaxHr = useMemo(() => estimateMaxHr(runs), [runs]);
  const maxHr = Number(maxHrInput) >= 100 && Number(maxHrInput) <= 230 ? Number(maxHrInput) : autoMaxHr;
  const anyHr = useMemo(() => runs.some(hasHr), [runs]);
  const duration = useMemo(() => Math.max(0, ...runs.map((r) => r.ts[r.ts.length - 1])), [runs]);

  const clock = useRef({ elapsed: 0, speed, duration });
  clock.current.speed = speed;
  clock.current.duration = duration;

  // Look up weather for each run (only when the Weather option is on)
  useEffect(() => {
    if (!weatherOn) return;
    for (const run of runs) {
      if (weather[run.id]) continue;
      setWeather((w) => ({ ...w, [run.id]: { status: 'loading' } }));
      fetchWeather(run).then(
        (data) => setWeather((w) => ({ ...w, [run.id]: { status: 'ok', data } })),
        (e) => setWeather((w) => ({ ...w, [run.id]: { status: 'error', error: e?.message || String(e) } })),
      );
    }
  }, [runs, weatherOn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Playback loop
  useEffect(() => {
    if (!playing) return;
    let raf;
    let last = performance.now();
    let lastUi = 0;
    const tick = (now) => {
      const c = clock.current;
      c.elapsed = Math.min(c.duration, c.elapsed + (now - last) * c.speed);
      last = now;
      setElapsed(c.elapsed);
      if (now - lastUi > 250 || c.elapsed >= c.duration) {
        lastUi = now;
        setUiElapsed(c.elapsed);
      }
      if (c.elapsed >= c.duration) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seek = useCallback((t) => {
    clock.current.elapsed = t;
    setElapsed(t);
    setUiElapsed(t);
  }, []);

  const runsRef = useRef(runs);
  runsRef.current = runs;
  const weatherOnRef = useRef(weatherOn);
  weatherOnRef.current = weatherOn;

  // Prepare everything first (analysis + weather), then show the finished replay and start it.
  const ingest = useCallback(
    async (parsedList, errs = []) => {
      setPlaying(false);
      const prev = runsRef.current;
      const room = MAX_RUNS - prev.length;
      const notes = [...errs];
      if (parsedList.length > room) notes.push(`Only ${MAX_RUNS} runs can be compared at once; extra files were ignored.`);

      setBusy('Calculating distance, pace and splits…');
      await new Promise((r) => setTimeout(r)); // let the overlay paint before the heavy work
      const added = parsedList.slice(0, room).map((p, k) => {
        const run = analyze(p, nextId++, prev.length + k);
        run.color = COLORS[(prev.length + k) % COLORS.length];
        return run;
      });

      const results = {};
      if (weatherOnRef.current && added.length) {
        setBusy('Fetching weather and air quality for each run…');
        await Promise.all(
          added.map(async (run) => {
            try {
              results[run.id] = { status: 'ok', data: await withTimeout(fetchWeather(run), 15000) };
            } catch (e) {
              results[run.id] = { status: 'error', error: e?.message || String(e) };
              notes.push(`Weather unavailable for "${run.name}" (${e?.message || e}) — it will replay without it.`);
            }
          }),
        );
      }

      const all = [...prev, ...added];
      all.forEach((r, i) => (r.color = COLORS[i % COLORS.length])); // keep colours unique after removals
      if (!prev.length && added.length) {
        setSpeed(pickSpeed(Math.max(...all.map((r) => r.ts[r.ts.length - 1]))));
        setFocusId(added[0].id);
      }
      setWeather((w) => ({ ...w, ...results }));
      setRuns(all);
      seek(longest(all)); // show the completed run; the user presses Start to watch it
      setPlayed(false);
      setMessages(notes);
      setBusy(null);
    },
    [seek],
  );

  const handleFiles = useCallback(
    async (fileList) => {
      const files = [...fileList];
      const ok = [];
      const errs = [];
      setBusy('Reading files…');
      for (const f of files) {
        try {
          ok.push(await parseActivityFile(f));
        } catch (e) {
          errs.push(`${f.name}: ${e?.message || e}`);
        }
      }
      if (ok.length) await ingest(ok, errs);
      else {
        setMessages(errs);
        setBusy(null);
      }
    },
    [ingest],
  );

  const loadDemo = () => {
    setMessages([]);
    ingest([parseGPX(sampleSteady()), parseGPX(sampleNegative())]);
  };

  const removeRun = (id) => {
    const rest = runs.filter((r) => r.id !== id);
    setRuns(rest);
    seek(longest(rest));
    setPlayed(false);
    setPlaying(false);
    setFocusId((f) => (f === id ? null : f));
  };

  const clearAll = () => {
    setRuns([]);
    seek(0);
    setPlaying(false);
    setMessages([]);
  };

  const toggle = () => {
    if (!playing && clock.current.elapsed >= duration) seek(0);
    if (!playing) setPlayed(true);
    setPlaying((p) => !p);
  };

  // A finished video belongs to the runs it was made from
  useEffect(() => {
    setVideo((v) => {
      if (v) URL.revokeObjectURL(v.url);
      return null;
    });
    setShareHint('');
    setReport((r) => {
      if (r) URL.revokeObjectURL(r.url);
      return null;
    });
    setReportHint('');
  }, [runs]);

  async function doExport() {
    setPlaying(false);
    setExporting(0);
    setShareHint('');
    try {
      const blob = await exportVideo({ runs, scale, speed, units, iconMode, weather, weatherOn, tempUnit, showMap: mapInVideo, colorMode: anyHr ? colorMode : 'pace', maxHr, onWarn: setShareHint, onProgress: setExporting });
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      setVideo((v) => {
        if (v) URL.revokeObjectURL(v.url);
        return { blob, ext, url: URL.createObjectURL(blob) };
      });
    } catch (e) {
      setMessages([`Export failed: ${e?.message || e}`]);
    } finally {
      setExporting(null);
    }
  }

  function downloadVideo() {
    const a = document.createElement('a');
    a.href = video.url;
    a.download = `pacetrace.${video.ext}`;
    a.click();
  }

  function shareText() {
    const lines = runs.map((r) => {
      const wx = weatherOn ? weather[r.id]?.data : null;
      const sum = wx ? weatherSummary(wx, r) : null;
      const w = sum ? ` · ${formatTemp(sum.temp, tempUnit)}, ${Math.round(sum.rh)}% humidity` : '';
      return `🏃 ${r.name}: ${formatDistance(r.stats.distance, units)} in ${formatDuration(r.stats.duration)} (${formatPace(r.stats.avgSpeed, units)})${w}`;
    });
    return [...lines, 'Made with PaceTrace'].join('\n');
  }

  // Must run straight from a click: the browser only allows the share sheet right after a user gesture.
  async function shareToWhatsApp() {
    const text = shareText();
    const file = new File([video.blob], `pacetrace.${video.ext}`, { type: video.blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text, title: 'PaceTrace' });
        setShareHint('');
        return;
      } catch (e) {
        if (e?.name === 'AbortError') return; // user closed the share sheet
      }
    }
    // Browsers without file sharing: WhatsApp Web can only be pre-filled with text, so save the video for attaching.
    downloadVideo();
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    setShareHint('Video saved to your downloads. WhatsApp can\'t receive files from a web page — attach it in the chat that just opened.');
  }

  // ---- shareable report (PDF or image): stats, large pace-coloured map, split-by-split tables ----
  const reportRun = runs.find((r) => r.id === focusId) || runs[0];

  async function makeReport() {
    if (!reportRun) return;
    setReportBusy(true);
    setReportHint('');
    try {
      const { buildReport, pagesToImage } = await import('./lib/report.js'); // loaded on demand: it pulls in the PDF library
      const built = await buildReport({
        format: reportFormat,
        run: reportRun,
        weather,
        weatherOn,
        units,
        tempUnit,
        colorMode: anyHr ? colorMode : 'pace',
        maxHr,
        maxHrEstimated: !(Number(maxHrInput) >= 100 && Number(maxHrInput) <= 230),
        basis: paceBasis,
      });
      const blob = built.kind === 'pdf' ? new Blob([built.bytes], { type: 'application/pdf' }) : await pagesToImage(built.pages);
      const ext = reportFormat === 'pdf' ? 'pdf' : 'jpg';
      const safe = reportRun.name.replace(/\.[^.]+$/, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'run';
      setReport((r) => {
        if (r) URL.revokeObjectURL(r.url);
        return { blob, ext, url: URL.createObjectURL(blob), name: `pacetrace-report-${safe}.${ext}`, runName: reportRun.name };
      });
    } catch (e) {
      setMessages([`Report failed: ${e?.message || e}`]);
    } finally {
      setReportBusy(false);
    }
  }

  function downloadReport() {
    const a = document.createElement('a');
    a.href = report.url;
    a.download = report.name;
    a.click();
  }

  // Must run straight from a click (browsers only allow the share sheet right after a user gesture)
  async function shareReport() {
    const text = shareText().split('\n').filter((l) => l.includes(report.runName) || l.startsWith('Made')).join('\n');
    const file = new File([report.blob], report.name, { type: report.blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text, title: 'Run report' });
        setReportHint('');
        return;
      } catch (e) {
        if (e?.name === 'AbortError') return;
      }
    }
    downloadReport();
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    setReportHint("Report saved to your downloads. WhatsApp can't receive files from a web page, so attach it in the chat that just opened.");
  }

  const empty = !runs.length;

  return (
    <div
      className={`app ${drag ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <header className="topbar">
        <h1>🏃 PaceTrace</h1>
        <div className="top-actions">
          <label className="btn">
            ＋ Add run
            <input type="file" accept=".gpx,.tcx,.fit" multiple hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
          </label>
          <select aria-label="Temperature units" value={tempUnit} onChange={(e) => { setTempUnit(e.target.value); store('tempUnit', 'C', e.target.value); }}>
            <option value="C">°C</option>
            <option value="F">°F</option>
          </select>
          <select aria-label="Units" value={units} onChange={(e) => setUnits(e.target.value)}>
            <option value="km">km</option>
            <option value="mi">mi</option>
          </select>
          {!empty && (
            <button className="btn ghost" onClick={clearAll}>
              Clear
            </button>
          )}
        </div>
      </header>

      {messages.length > 0 && (
        <div className="errors" role="alert">
          {messages.map((m, i) => (
            <div key={i}>⚠ {m}</div>
          ))}
          <button onClick={() => setMessages([])} aria-label="Dismiss">✕</button>
        </div>
      )}

      <main className="layout">
        <section className="stage">
          <MapView runs={runs} scale={scale} elapsed={elapsed} focusId={focusId} follow={follow} iconMode={iconMode} playing={playing} speed={speed} units={units} weather={weather} weatherOn={weatherOn} tempUnit={tempUnit} colorMode={anyHr ? colorMode : 'pace'} maxHr={maxHr} />
          {busy && (
            <div className="busy" role="status" aria-live="polite">
              <div className="spinner" />
              <p>{busy}</p>
              <small>Getting everything ready before the replay starts.</small>
            </div>
          )}
          {empty && !busy && (
            <div className="empty">
              <h2>Replay your run on the map</h2>
              <p>Drop GPX, TCX or FIT files here — from Garmin, Samsung Health (exported), Strava and others. Add several to race them against each other.</p>
              <div className="empty-actions">
                <label className="btn primary">
                  Choose files
                  <input type="file" accept=".gpx,.tcx,.fit" multiple hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
                </label>
                <button className="btn" onClick={loadDemo}>
                  Try a demo
                </button>
              </div>
              <small>Files are processed in your browser and never uploaded. The optional weather and air-quality lookup sends only each run's approximate start location and date to Open-Meteo.</small>
            </div>
          )}
          {!empty && (
            anyHr && colorMode === 'zone' ? (
              <div className="legend" aria-label="Heart rate zone legend">
                {ZONES.map((z) => (
                  <span key={z.id} className="zchip" title={`${z.name}${maxHr ? ` (${Number.isFinite(z.hi) ? Math.round(z.lo * maxHr) + '–' + Math.round(z.hi * maxHr) : Math.round(z.lo * maxHr) + '+'} bpm)` : ''}`}>
                    <i style={{ background: z.color }} />Z{z.id}
                  </span>
                ))}
              </div>
            ) : (
              <div className="legend" aria-label="Pace colour legend">
                <span>fast</span>
                <i style={{ background: `linear-gradient(90deg, ${[0, 8, 16, 23].map(bucketColor).join(',')})` }} />
                <span>slow</span>
              </div>
            )
          )}
        </section>

        {!empty && (
          <aside className="panel">
            <Controls
              playing={playing}
              fresh={!played}
              onToggle={toggle}
              onRestart={() => { seek(0); setPlaying(false); }}
              speed={speed}
              onSpeed={setSpeed}
              elapsed={elapsed}
              duration={duration}
              onSeek={seek}
            />
            <div className="options">
              <div className="seg" role="group" aria-label="Map view">
                <button className={!follow ? 'on' : ''} aria-pressed={!follow} onClick={() => setFollow(false)} title="Whole route stays in view; the map never moves">Static map</button>
                <button className={follow ? 'on' : ''} aria-pressed={follow} onClick={() => setFollow(true)} title="Zoom in and follow the runner">Zoom &amp; follow</button>
              </div>
              {anyHr && (
                <div className="seg" role="group" aria-label="Route colour">
                  <button className={colorMode === 'pace' ? 'on' : ''} aria-pressed={colorMode === 'pace'} onClick={() => setColorMode('pace')} title="Colour the route by pace">Colour: pace</button>
                  <button className={colorMode === 'zone' ? 'on' : ''} aria-pressed={colorMode === 'zone'} onClick={() => setColorMode('zone')} title="Colour the route by heart-rate zone">Colour: HR zone</button>
                </div>
              )}
              {anyHr && (
                <label className="maxhr" title="Used for heart-rate zones. Leave empty to use the highest heart rate in your runs.">
                  Max HR
                  <input
                    type="number"
                    inputMode="numeric"
                    min="100"
                    max="230"
                    placeholder={autoMaxHr ? `auto ${autoMaxHr}` : 'bpm'}
                    value={maxHrInput}
                    onChange={(e) => {
                      setMaxHrInput(e.target.value);
                      store('maxHr', '', e.target.value);
                    }}
                  />
                </label>
              )}
              <label title="Looks up temperature and humidity from Open-Meteo using each run's approximate start location and date">
                <input
                  type="checkbox"
                  checked={weatherOn}
                  onChange={(e) => {
                    setWeatherOn(e.target.checked);
                    store('weatherOn', 'on', e.target.checked ? 'on' : 'off');
                    if (!e.target.checked && (metric === 'temp' || metric === 'humidity' || metric === 'aqi')) setMetric('elevation');
                  }}
                />{' '}
                Weather
              </label>
              <label><input type="checkbox" checked={iconMode === 'figure'} onChange={(e) => setIconMode(e.target.checked ? 'figure' : 'dot')} /> Running figure</label>
              <div className="reportctl" title="Stats, a large pace-coloured map and the split-by-split table for the selected run, ready to share">
                <select
                  aria-label="Report format"
                  value={reportFormat}
                  onChange={(e) => {
                    setReportFormat(e.target.value);
                    store('reportFormat', 'pdf', e.target.value);
                    setReport((r) => {
                      if (r) URL.revokeObjectURL(r.url);
                      return null;
                    });
                  }}
                >
                  <option value="pdf">PDF</option>
                  <option value="jpg">Image</option>
                </select>
                <button className="btn small" disabled={reportBusy} onClick={makeReport}>
                  {reportBusy ? 'Building…' : report ? '↻ Rebuild report' : '📄 Create report'}
                </button>
              </div>
              {exportSupported() && (
                <label title="Draw the OpenStreetMap map behind the route in the video (needs an internet connection)">
                  <input
                    type="checkbox"
                    checked={mapInVideo}
                    onChange={(e) => {
                      setMapInVideo(e.target.checked);
                      store('mapInVideo', 'on', e.target.checked ? 'on' : 'off');
                    }}
                  />{' '}
                  Map in video
                </label>
              )}
              {exportSupported() && (
                <button className="btn small" disabled={exporting != null} onClick={doExport}>
                  {exporting != null ? `Recording… ${Math.round(exporting * 100)}%` : video ? '↻ Re-record video' : '🎬 Create video'}
                </button>
              )}
            </div>
            {video && (
              <div className="video-ready">
                <b>Video ready</b>
                <span>
                  {(video.blob.size / 1048576).toFixed(1)} MB · {video.ext.toUpperCase()}
                </span>
                <div className="video-actions">
                  <button className="btn small whatsapp" onClick={shareToWhatsApp}>
                    Share on WhatsApp
                  </button>
                  <button className="btn small" onClick={downloadVideo}>
                    ⬇ Download
                  </button>
                </div>
                {video.ext === 'webm' && (
                  <small>This browser can only make WebM, which WhatsApp may not play. Chrome or Edge (latest) or Safari can make MP4.</small>
                )}
                {shareHint && <small>{shareHint}</small>}
              </div>
            )}
            {report && (
              <div className="video-ready">
                <b>Report ready</b>
                <span>
                  {report.ext.toUpperCase()} · {(report.blob.size / 1048576).toFixed(1)} MB · {report.runName}
                </span>
                <div className="video-actions">
                  <button className="btn small whatsapp" onClick={shareReport}>
                    Share on WhatsApp
                  </button>
                  <button className="btn small" onClick={downloadReport}>
                    ⬇ Download
                  </button>
                </div>
                {reportHint && <small>{reportHint}</small>}
              </div>
            )}
            <Chart runs={runs} metric={metric} onMetric={setMetric} elapsed={elapsed} duration={duration} onSeek={seek} units={units} tempUnit={tempUnit} weather={weather} weatherOn={weatherOn} maxHr={maxHr} />
            <RunList runs={runs} elapsed={uiElapsed} units={units} tempUnit={tempUnit} weather={weather} weatherOn={weatherOn} maxHr={maxHr} paceBasis={paceBasis} onPaceBasis={(b) => { setPaceBasis(b); store('paceBasis', 'moving', b); }} onSeek={seek} focusId={focusId} onFocus={setFocusId} onRemove={removeRun} />
            {weatherOn && (
              <p className="credit">
                Weather and air quality (US AQI) by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a> — modelled hourly values for the area, not readings from a station on your route.
              </p>
            )}
          </aside>
        )}
      </main>
      {drag && <div className="drop-overlay">Drop files to add runs</div>}
    </div>
  );
}
