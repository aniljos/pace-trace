import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { milestones, stateAt } from '../lib/analysis.js';
import { routeColorRuns } from '../lib/hr.js';
import { formatDuration, formatElevation, formatPace, formatTemp } from '../lib/format.js';
import { weatherAt } from '../lib/weather.js';

const FOLLOW_ZOOM = 16;
const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

const FIGURE_SVG = `
<svg viewBox="0 0 40 40" width="56" height="56" aria-hidden="true">
  <ellipse class="rf-shadow" cx="20" cy="38.5" rx="9" ry="2"/>
  <g class="rf-body">
    <g class="rf-leg rf-a"><line x1="20" y1="22" x2="20" y2="30"/><g class="rf-shin"><line x1="20" y1="30" x2="20" y2="38"/><line x1="20" y1="38" x2="23.5" y2="38"/></g></g>
    <g class="rf-torso">
      <line x1="20" y1="12" x2="20" y2="22"/>
      <circle class="rf-head" cx="21.5" cy="7" r="4"/>
      <g class="rf-arm rf-a"><line x1="20" y1="13" x2="20" y2="19"/><g class="rf-fore"><line x1="20" y1="19" x2="20" y2="25"/></g></g>
    </g>
    <g class="rf-leg rf-b"><line x1="20" y1="22" x2="20" y2="30"/><g class="rf-shin"><line x1="20" y1="30" x2="20" y2="38"/><line x1="20" y1="38" x2="23.5" y2="38"/></g></g>
    <g class="rf-torso">
      <g class="rf-arm rf-b"><line x1="20" y1="13" x2="20" y2="19"/><g class="rf-fore"><line x1="20" y1="19" x2="20" y2="25"/></g></g>
    </g>
  </g>
</svg>`;

function runnerIcon(run, mode) {
  const html =
    mode === 'figure'
      ? `<div class="runner-figure idle" style="--c:${run.color}">${FIGURE_SVG}</div>`
      : `<div class="runner-dot" style="--c:${run.color}"></div>`;
  return L.divIcon({ html, className: 'runner-icon', iconSize: [56, 56], iconAnchor: mode === 'figure' ? [28, 48] : [28, 28] });
}

// "16°C · 85% · AQI 40" for the moment the runner reached this milestone
function conditionsLine(run, m, wx, tempUnit) {
  if (!wx) return '';
  const c = weatherAt(wx, run.startTime + m.t);
  const parts = [formatTemp(c.temp, tempUnit), `${Math.round(c.rh)}%`];
  if (c.aqi != null) parts.push(`AQI ${Math.round(c.aqi)}`);
  return `<div class="ms-wx">${parts.join(' · ')}</div>`;
}

// "5:21 /km · 142 bpm · 24 m" - pace for the stretch just completed, heart rate and elevation here
function statsLine(m, units) {
  const parts = [];
  if (m.speed) parts.push(formatPace(m.speed, units));
  if (m.hr != null) parts.push(`${Math.round(m.hr)} bpm`);
  if (m.ele != null) parts.push(formatElevation(m.ele, units));
  return parts.length ? `<div class="ms-stats">${parts.join(' · ')}</div>` : '';
}

function milestoneIcon(run, m, wx, tempUnit, units) {
  const time = formatDuration(m.t);
  const wxLine = statsLine(m, units) + conditionsLine(run, m, wx, tempUnit);
  const cls = { pct: 'ms-pct', finish: 'ms-finish', start: 'ms-finish', unit: 'ms-unit' }[m.kind];
  const head =
    m.kind === 'finish'
      ? `\u{1F3C1} <b>Finish</b> ${time}`
      : m.kind === 'start'
        ? `\u25B6 <b>Start</b>`
        : `<b>${m.label}</b> ${time}`;
  const below = m.below ? `ms-below${m.drop ? ' far' : ''}` : '';
  const html = `<div class="ms ${cls} ${below} ${wxLine ? 'has-wx' : ''}" style="--c:${run.color}"><div>${head}</div>${wxLine}</div>`;
  return L.divIcon({ html, className: 'ms-icon', iconSize: [0, 0] });
}

function bindLabel(marker, run, mode) {
  marker.unbindTooltip();
  marker.bindTooltip(run.name, { permanent: true, direction: 'top', offset: [0, mode === 'figure' ? -36 : -14], className: 'runner-label' });
}

// Drive the figure's run cycle from the runner's real pace and heading.
function updateFigure(layer, run, st, playing) {
  const el = layer.marker.getElement()?.querySelector('.runner-figure');
  if (!el) return;
  const moving = playing && !st.finished && st.speed > 0.5;
  el.classList.toggle('idle', !moving);
  if (!moving) return;
  // Faster pace -> shorter stride cycle. Quantised so the animation isn't restarted constantly.
  const cycle = Math.round(Math.min(0.9, Math.max(0.4, 2.2 / st.speed)) * 20) / 20;
  if (el.style.getPropertyValue('--cycle') !== `${cycle}s`) el.style.setProperty('--cycle', `${cycle}s`);
  // Face the direction of travel (look a few points ahead to ignore GPS jitter)
  const a = run.points[st.i];
  const b = run.points[Math.min(run.points.length - 1, st.i + 4)];
  const dlon = b.lon - a.lon;
  if (Math.abs(dlon) > 1e-6) layer.dir = dlon >= 0 ? 1 : -1;
  el.style.setProperty('--dir', layer.dir ?? 1);
}

export default function MapView({ runs, scale, elapsed, focusId, follow, iconMode, playing, speed, units, weather, weatherOn, tempUnit, colorMode, maxHr }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const rendererRef = useRef(null);
  const layersRef = useRef(new Map()); // run id -> layer state
  const latest = useRef({});
  const pendingFit = useRef(null); // bounds waiting for the map container to have a real size
  const camRef = useRef({ ready: false, zoomAt: 0, panUntil: 0 });
  const iconModeRef = useRef(iconMode);
  iconModeRef.current = iconMode;
  latest.current = { runs, scale, elapsed, focusId, follow, playing, speed, weather, weatherOn, tempUnit, colorMode, maxHr };

  // Fit the whole route once the map has a usable size (it can be 0 while the side panel is appearing)
  function tryFit(map) {
    const b = pendingFit.current;
    if (!b || !map) return;
    map.invalidateSize();
    const size = map.getSize();
    if (size.x < 120 || size.y < 120) return;
    pendingFit.current = null;
    if (!latest.current.follow) map.fitBounds(b, { padding: [40, 40], maxZoom: 17, animate: false });
  }

  // One-time map setup
  useEffect(() => {
    const map = L.map(elRef.current, { zoomControl: true, preferCanvas: true }).setView([51.5, -0.12], 12);
    L.tileLayer(TILES, {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    rendererRef.current = L.canvas({ padding: 0.5 });
    mapRef.current = map;
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      tryFit(map);
    });
    ro.observe(elRef.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      layersRef.current.clear();
    };
  }, []);

  const conditions = (run) => (latest.current.weatherOn ? latest.current.weather[run.id]?.data : null);

  // Rebuild static layers when the set of runs (or the colour scale) changes
  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    for (const l of layers.values()) l.group.remove();
    layers.clear();

    const bounds = L.latLngBounds([]);
    for (const run of runs) {
      const group = L.layerGroup().addTo(map);
      const latlngs = run.points.map((p) => [p.lat, p.lon]);
      latlngs.forEach((ll) => bounds.extend(ll));
      L.polyline(latlngs, { color: '#8a94a6', weight: 7, opacity: 0.5, renderer: rendererRef.current, interactive: false }).addTo(group);
      L.circleMarker(latlngs[0], { radius: 6, color: '#fff', weight: 2, fillColor: '#2ecc40', fillOpacity: 1, renderer: rendererRef.current, interactive: false }).addTo(group);
      const st = stateAt(run, 0);
      const marker = L.marker([st.lat, st.lon], { icon: runnerIcon(run, iconMode), zIndexOffset: 1000, interactive: false });
      if (runs.length > 1) bindLabel(marker, run, iconMode);
      marker.addTo(group);
      const ms = milestones(run, units === 'mi' ? 1609.344 : 1000, units).map((m) => ({
        ...m,
        on: false,
        marker: L.marker([m.lat, m.lon], { icon: milestoneIcon(run, m, conditions(run), latest.current.tempUnit, units), zIndexOffset: m.kind === 'unit' ? 100 : 300, interactive: false }),
      }));
      layers.set(run.id, {
        ms,
        group,
        marker,
        cruns: routeColorRuns(run, scale, latest.current.colorMode, latest.current.maxHr),
        trail: L.layerGroup().addTo(group),
        drawn: 0, // number of colour-runs fully committed
        committedTo: 0, // point index the committed trail reaches
        live: null,
      });
    }
    if (bounds.isValid()) {
      pendingFit.current = bounds;
      tryFit(map);
      requestAnimationFrame(() => tryFit(map));
    }
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, scale, units, colorMode, maxHr]);

  // Refresh the conditions shown on milestone badges when weather arrives or units change
  useEffect(() => {
    for (const run of runs) {
      const layer = layersRef.current.get(run.id);
      if (!layer) continue;
      for (const m of layer.ms) m.marker.setIcon(milestoneIcon(run, m, conditions(run), tempUnit, units));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weather, weatherOn, tempUnit, units]);

  // Swap marker style
  useEffect(() => {
    for (const run of runs) {
      const m = layersRef.current.get(run.id)?.marker;
      if (!m) continue;
      m.setIcon(runnerIcon(run, iconMode));
      if (runs.length > 1) bindLabel(m, run, iconMode);
    }
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iconMode]);

  function draw() {
    const { runs, elapsed, focusId, follow, playing, speed } = latest.current;
    const map = mapRef.current;
    for (const run of runs) {
      const L_ = layersRef.current.get(run.id);
      if (!L_) continue;
      const st = stateAt(run, Math.min(elapsed, run.ts[run.ts.length - 1]));
      const tip = [st.lat, st.lon];
      L_.marker.setLatLng(tip);
      if (iconModeRef.current === 'figure') updateFigure(L_, run, st, playing);

      // Milestone badges appear once the runner has passed them
      for (const m of L_.ms) {
        const reached = m.t <= elapsed && elapsed > 0;
        if (reached !== m.on) {
          m.on = reached;
          if (reached) m.marker.addTo(L_.group);
          else m.marker.remove();
        }
      }

      // Seeked backwards: restart the trail
      if (st.i < L_.committedTo) {
        L_.trail.clearLayers();
        L_.drawn = 0;
        L_.committedTo = 0;
        L_.live = null;
      }

      // Commit every colour-run that ended at or before the current point
      while (L_.drawn < L_.cruns.length && L_.cruns[L_.drawn].to <= st.i) {
        const c = L_.cruns[L_.drawn];
        const pts = run.points.slice(c.from, c.to + 1).map((p) => [p.lat, p.lon]);
        if (L_.live) {
          L_.live.setLatLngs(pts);
          L_.live = null;
        } else {
          L.polyline(pts, { color: c.color, weight: 9, opacity: 1, lineCap: 'round', renderer: rendererRef.current, interactive: false }).addTo(L_.trail);
        }
        L_.drawn++;
        L_.committedTo = c.to;
      }

      // The colour-run currently being traversed, drawn up to the runner's exact position
      const cur = L_.cruns[L_.drawn];
      if (cur && st.i >= cur.from) {
        const pts = run.points.slice(cur.from, st.i + 1).map((p) => [p.lat, p.lon]);
        pts.push(tip);
        if (!L_.live) {
          L_.live = L.polyline(pts, { color: cur.color, weight: 9, opacity: 1, lineCap: 'round', renderer: rendererRef.current, interactive: false }).addTo(L_.trail);
        } else {
          L_.live.setLatLngs(pts);
        }
      }
    }
    if (follow && runs.length) followCamera(map, runs, elapsed, speed, playing);
  }

  // Calm camera: while playing it holds still until a runner drifts out of the middle of the view,
  // then glides to re-centre ahead of them. Zoom changes are rare and rate-limited.
  function followCamera(map, runs, elapsed, speed, playing) {
    const cam = camRef.current;
    const now = performance.now();
    const lead = playing ? 1800 * speed : 0; // aim a little ahead of the runner
    const bounds = L.latLngBounds([]);
    for (const run of runs) {
      const end = run.ts[run.ts.length - 1];
      for (const t of [elapsed, elapsed + lead]) {
        const st = stateAt(run, Math.min(t, end));
        bounds.extend([st.lat, st.lon]);
      }
    }
    const center = bounds.getCenter();

    // Paused / seeking / first frame: snap
    if (!playing || !cam.ready) {
      const z = Math.min(FOLLOW_ZOOM, map.getBoundsZoom(bounds, false, L.point(90, 90)));
      map.setView(center, z, { animate: false });
      cam.ready = true;
      cam.zoomAt = now;
      cam.panUntil = 0;
      return;
    }

    if (now - cam.zoomAt > 4000) {
      const z = map.getZoom();
      const fit = map.getBoundsZoom(bounds, false, L.point(90, 90));
      let target = z;
      if (fit < z) target = fit; // runners are leaving the view
      else if (z < FOLLOW_ZOOM && map.getBoundsZoom(bounds, false, L.point(220, 220)) > z) target = z + 1;
      if (target !== z) {
        map.setView(center, target, { animate: true });
        cam.zoomAt = now;
        cam.panUntil = now + 500;
        return;
      }
    }

    if (now < cam.panUntil) return;
    const size = map.getSize();
    const p = map.latLngToContainerPoint(center);
    const dx = Math.abs(p.x - size.x / 2);
    const dy = Math.abs(p.y - size.y / 2);
    if (dx > size.x * 0.2 || dy > size.y * 0.2) {
      map.panTo(center, { animate: true, duration: 1.6, easeLinearity: 0.2 });
      cam.panUntil = now + 1700;
    }
  }

  useEffect(() => {
    camRef.current.ready = false;
    if (follow || !runs.length) return;
    const b = L.latLngBounds(runs.flatMap((r) => r.points.map((p) => [p.lat, p.lon])));
    mapRef.current.invalidateSize();
    mapRef.current.fitBounds(b, { padding: [40, 40], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow]);

  useEffect(draw, [elapsed, focusId, follow, playing]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={elRef} className="map" />;
}

