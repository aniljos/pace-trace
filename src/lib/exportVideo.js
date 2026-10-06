import { bucketColor, milestones, stateAt } from './analysis.js';
import { ZONES, routeColorRuns } from './hr.js';
import { aqiCategory, distanceValue, formatDuration, formatElevation, formatPace, formatTemp } from './format.js';
import { weatherAt } from './weather.js';
import { buildMapBackground, mercX, mercY } from './mapTiles.js';

const W = 1280;
const H = 720;
const FPS = 30;

const lerpKeys = (keys, p) => {
  for (let i = 1; i < keys.length; i++) {
    if (p <= keys[i][0]) {
      const [p0, v0] = keys[i - 1];
      const [p1, v1] = keys[i];
      return v0 + ((v1 - v0) * (p - p0)) / (p1 - p0);
    }
  }
  return keys[keys.length - 1][1];
};
// Same keyframes as the on-map figure (degrees, phase 0..1)
const THIGH = [[0, -48], [0.5, 32], [1, -48]];
const SHIN = [[0, 4], [0.25, 18], [0.5, 24], [0.75, 95], [1, 4]];
const ARM = [[0, 42], [0.5, -42], [1, 42]];

function joint(ctx, px, py, deg, fn) {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.translate(-px, -py);
  fn();
  ctx.restore();
}
const seg = (ctx, x1, y1, x2, y2) => {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
};

// Stick-figure runner with its feet at (x, y). `phase` is the position in the stride cycle.
export function drawFigure(ctx, x, y, { color, dir, phase, moving, size }) {
  const k = size / 40;
  const bounce = moving ? -2 * (0.5 - 0.5 * Math.cos(4 * Math.PI * phase)) : 0;
  const leg = (ph) => {
    const shin = moving ? lerpKeys(SHIN, ph) : 0;
    joint(ctx, 20, 22, moving ? lerpKeys(THIGH, ph) : 0, () => {
      seg(ctx, 20, 22, 20, 30);
      joint(ctx, 20, 30, shin, () => {
        seg(ctx, 20, 30, 20, 38);
        seg(ctx, 20, 38, 23.5, 38);
      });
    });
  };
  const arm = (ph) =>
    joint(ctx, 20, 13, moving ? lerpKeys(ARM, ph) : 0, () => {
      seg(ctx, 20, 13, 20, 19);
      joint(ctx, 20, 19, moving ? -85 : -15, () => seg(ctx, 20, 19, 20, 25));
    });
  const body = () => {
    leg(phase);
    joint(ctx, 20, 22, moving ? -7 : 0, () => {
      seg(ctx, 20, 12, 20, 22);
      ctx.beginPath();
      ctx.arc(21.5, 7, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      arm(phase);
    });
    leg((phase + 0.5) % 1);
    joint(ctx, 20, 22, moving ? -7 : 0, () => arm((phase + 0.5) % 1));
  };

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir * k, k);
  ctx.translate(-20, -38);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(20, 38.5, 9, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.translate(0, bounce);
  // white outline pass, then the coloured pass
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineWidth = 6;
  body();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3.2;
  body();
  ctx.restore();
}

// Badge: a bold headline plus optional extra lines (pace/HR/elevation, then conditions)
function pill(ctx, x, y, head, lines, { fill, stroke, color, above, scale, drop = 0 }) {
  const pad = 10;
  const headH = 24;
  const lineH = 17;
  const h = headH + lines.length * lineH + (lines.length ? 3 : 0);
  ctx.font = '700 14px system-ui, sans-serif';
  const bold = ctx.measureText(head[0]).width;
  ctx.font = '14px system-ui, sans-serif';
  const rest = head[1] ? ctx.measureText(' ' + head[1]).width : 0;
  ctx.font = '12px system-ui, sans-serif';
  const w = Math.max(bold + rest, ...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const r = Math.min(12, h / 2);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  const left = -w / 2;
  const top = above ? -h - 10 : 10 + drop;
  if (drop) {
    // leader line from the route point down to the badge
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = stroke || color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, top);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(left + r, top);
  ctx.arcTo(left + w, top, left + w, top + h, r);
  ctx.arcTo(left + w, top + h, left, top + h, r);
  ctx.arcTo(left, top + h, left, top, r);
  ctx.arcTo(left, top, left + w, top, r);
  ctx.closePath();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  if (stroke) {
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  const hx = lines.length ? -(bold + rest) / 2 : left + pad; // centre the headline when there are extra lines
  ctx.font = '700 14px system-ui, sans-serif';
  ctx.fillText(head[0], hx, top + headH / 2 + 1);
  if (head[1]) {
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(' ' + head[1], hx + bold, top + headH / 2 + 1);
  }
  ctx.textAlign = 'center';
  lines.forEach((l, i) => {
    ctx.font = (i === 0 && lines.length > 1 ? '600 ' : '') + '12px system-ui, sans-serif';
    ctx.fillText(l, 0, top + headH + 2 + i * lineH + lineH / 2);
  });
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}

// Renders the replay (route + coloured trails + runners, no map tiles) to a canvas and records it (MP4 where the browser can, else WebM).
export function exportSupported() {
  return typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
}

export async function exportVideo({ runs, scale, speed, units, iconMode = 'dot', weather = {}, weatherOn = false, tempUnit = 'C', showMap = true, colorMode = 'pace', maxHr = null, onWarn, onProgress }) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Web Mercator projection fitted to the map area (so it lines up with the map tiles)
  let minMx = Infinity, maxMx = -Infinity, minMy = Infinity, maxMy = -Infinity;
  for (const r of runs) for (const p of r.points) {
    const mx = mercX(p.lon);
    const my = mercY(p.lat);
    minMx = Math.min(minMx, mx); maxMx = Math.max(maxMx, mx);
    minMy = Math.min(minMy, my); maxMy = Math.max(maxMy, my);
  }
  const spanX = Math.max(maxMx - minMx, 1e-9);
  const spanY = Math.max(maxMy - minMy, 1e-9);
  const mapW = W - 360; // right side is the HUD
  const pad = 50;
  const s = Math.min((mapW - pad * 2) / spanX, (H - pad * 2) / spanY);
  const ox = pad + (mapW - pad * 2 - spanX * s) / 2;
  const oy = pad + (H - pad * 2 - spanY * s) / 2;
  const proj = (lat, lon) => [ox + (mercX(lon) - minMx) * s, oy + (mercY(lat) - minMy) * s];

  const bg = showMap ? await buildMapBackground({ s, ox, oy, minMx, minMy, mapW, h: H }) : null;
  if (showMap && !bg) onWarn?.('The map could not be loaded (offline?), so the video uses a plain background.');

  const cruns = runs.map((r) => routeColorRuns(r, scale, colorMode, maxHr));
  const marks = runs.map((r) => milestones(r, units === 'mi' ? 1609.344 : 1000, units));
  const POP_MS = 350 * speed; // badge pop-in lasts ~350 ms of video time
  const duration = Math.max(...runs.map((r) => r.ts[r.ts.length - 1]));
  const totalMs = duration / speed + 1500; // hold the final frame briefly

  const phases = runs.map(() => 0);
  const dirs = runs.map(() => 1);

  function frame(elapsed, dtReal = 0, rawElapsed = elapsed) {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, W, H);
    if (bg) ctx.drawImage(bg, 0, 0);

    runs.forEach((r, k) => {
      // ghost
      ctx.lineWidth = 8;
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.strokeStyle = bg ? 'rgba(226,232,240,0.55)' : 'rgba(148,163,184,0.35)';
      ctx.beginPath();
      r.points.forEach((p, i) => {
        const [x, y] = proj(p.lat, p.lon);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();

      // coloured trail up to the runner
      const st = stateAt(r, Math.min(elapsed, r.ts[r.ts.length - 1]));
      ctx.lineWidth = 11;
      for (const c of cruns[k]) {
        if (c.from > st.i) break;
        ctx.strokeStyle = c.color;
        ctx.beginPath();
        for (let i = c.from; i <= Math.min(c.to, st.i); i++) {
          const [x, y] = proj(r.points[i].lat, r.points[i].lon);
          i === c.from ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        if (c.to > st.i) ctx.lineTo(...proj(st.lat, st.lon));
        ctx.stroke();
      }
    });

    // Milestone badges: units first so 25/50/75 % and the finish sit on top
    const drawBadges = (kind) =>
      runs.forEach((r, k) => {
        const wx = weatherOn ? weather[r.id]?.data : null;
        for (const m of marks[k]) {
          if (m.kind !== kind || elapsed <= 0 || m.t > elapsed) continue;
          const age = Math.min(1, (rawElapsed - m.t) / POP_MS); // rawElapsed keeps running during the final hold
          const scale = 0.4 + 0.6 * (1 - (1 - age) ** 3);
          const [x, y] = proj(m.lat, m.lon);
          const time = formatDuration(m.t);

          const stats = [];
          if (m.speed) stats.push(formatPace(m.speed, units));
          if (m.hr != null) stats.push(`${Math.round(m.hr)} bpm`);
          if (m.ele != null) stats.push(formatElevation(m.ele, units));
          const lines = stats.length ? [stats.join(' \u00b7 ')] : [];
          if (wx) {
            const c = weatherAt(wx, r.startTime + m.t);
            const parts = [formatTemp(c.temp, tempUnit), `${Math.round(c.rh)}%`];
            if (c.aqi != null) parts.push(`AQI ${Math.round(c.aqi)}`);
            lines.push(parts.join(' \u00b7 '));
          }

          if (kind === 'unit') pill(ctx, x, y, [m.label, time], lines, { fill: '#fff', stroke: r.color, color: '#0f172a', above: false, scale });
          else if (kind === 'pct') pill(ctx, x, y, [m.label, time], lines, { fill: r.color, color: '#fff', above: true, scale });
          else if (kind === 'start') pill(ctx, x, y, ['\u25B6 Start', ''], lines, { fill: '#0f172a', stroke: r.color, color: '#fff', above: true, scale });
          else pill(ctx, x, y, ['\u{1F3C1} Finish', time], lines, { fill: '#0f172a', stroke: r.color, color: '#fff', above: !m.below, drop: m.drop ? 104 : 0, scale });
        }
      });

    drawBadges('unit');
    drawBadges('start');
    drawBadges('pct');

    runs.forEach((r, k) => {
      const st = stateAt(r, Math.min(elapsed, r.ts[r.ts.length - 1]));
      const [x, y] = proj(st.lat, st.lon);
      if (iconMode === 'figure') {
        const moving = !st.finished && st.speed > 0.5 && elapsed < duration;
        if (moving) {
          const cycle = Math.round(Math.min(0.9, Math.max(0.4, 2.2 / st.speed)) * 20) / 20;
          phases[k] = (phases[k] + dtReal / 1000 / cycle) % 1;
          const a = r.points[st.i];
          const b = r.points[Math.min(r.points.length - 1, st.i + 4)];
          if (Math.abs(b.lon - a.lon) > 1e-6) dirs[k] = b.lon >= a.lon ? 1 : -1;
        }
        drawFigure(ctx, x, y, { color: r.color, dir: dirs[k], phase: phases[k], moving, size: 64 });
        return;
      }
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fillStyle = r.color;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    });

    drawBadges('finish'); // above the runners so a finished figure doesn't hide it

    if (bg) {
      // required OpenStreetMap credit
      ctx.font = '11px system-ui, sans-serif';
      const text = '\u00a9 OpenStreetMap contributors';
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
      ctx.fillRect(0, H - 20, tw + 16, 20);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(text, 8, H - 15);
    }

    // HUD
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(mapW, 0, W - mapW, H);
    ctx.fillStyle = '#e2e8f0';
    ctx.textBaseline = 'top';
    ctx.font = '700 40px system-ui, sans-serif';
    ctx.fillText(formatDuration(elapsed), mapW + 24, 24);
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`${speed}× speed`, mapW + 24, 76);
    const blockH = Math.min(130, Math.floor(480 / runs.length));
    let anyWeather = false;
    runs.forEach((r, k) => {
      const st = stateAt(r, Math.min(elapsed, r.ts[r.ts.length - 1]));
      const top = 120 + k * blockH;
      ctx.fillStyle = r.color;
      ctx.fillRect(mapW + 24, top + 4, 14, 14);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '600 18px system-ui, sans-serif';
      ctx.fillText(r.name.slice(0, 26), mapW + 46, top);
      ctx.font = '700 28px system-ui, sans-serif';
      ctx.fillText(`${distanceValue(st.dist, units).toFixed(2)} ${units}`, mapW + 24, top + 26);
      ctx.font = '18px system-ui, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(st.finished ? 'Finished' : formatPace(st.speed, units), mapW + 24, top + 62);

      // Live conditions at this moment of the run: "16°C · 84% · AQI 40"
      const wx = weatherOn ? weather[r.id]?.data : null;
      if (wx) {
        anyWeather = true;
        const c = weatherAt(wx, r.startTime + Math.min(elapsed, r.stats.duration));
        const base = `${formatTemp(c.temp, tempUnit)} \u00b7 ${Math.round(c.rh)}%`;
        ctx.font = '600 17px system-ui, sans-serif';
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(base, mapW + 24, top + 86);
        if (c.aqi != null) {
          const cat = aqiCategory(c.aqi);
          const x = mapW + 24 + ctx.measureText(base + ' \u00b7 ').width;
          ctx.fillText(' \u00b7 ', mapW + 24 + ctx.measureText(base).width, top + 86);
          ctx.fillStyle = cat.color;
          ctx.fillText(`AQI ${Math.round(c.aqi)}`, x, top + 86);
        }
      }
    });
    if (anyWeather) {
      ctx.fillStyle = '#64748b';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText('Weather & air quality: Open-Meteo.com (modelled)', mapW + 24, H - 22);
    }
    // legend
    if (colorMode === 'zone' && maxHr) {
      const bw = (W - mapW - 48) / ZONES.length;
      ZONES.forEach((z, i) => {
        ctx.fillStyle = z.color;
        ctx.fillRect(mapW + 24 + i * bw, H - 56, bw - 3, 10);
      });
      ctx.fillStyle = '#94a3b8';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText('HR zone 1', mapW + 24, H - 38);
      ctx.textAlign = 'right';
      ctx.fillText('zone 5', W - 24, H - 38);
    } else {
      const g = ctx.createLinearGradient(mapW + 24, 0, W - 24, 0);
      [0, 0.35, 0.7, 1].forEach((f) => g.addColorStop(f, bucketColor(Math.round(f * 23))));
      ctx.fillStyle = g;
      ctx.fillRect(mapW + 24, H - 56, W - mapW - 48, 10);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText('fast', mapW + 24, H - 38);
      ctx.textAlign = 'right';
      ctx.fillText('slow', W - 24, H - 38);
    }
    ctx.textAlign = 'left';
  }

  const stream = canvas.captureStream(FPS);
  const mime = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((resolve) => (rec.onstop = resolve));

  frame(0);
  rec.start();
  const t0 = performance.now();
  let prev = t0;
  await new Promise((resolve) => {
    function tick(now) {
      const real = now - t0;
      frame(Math.min(real * speed, duration), now - prev, real * speed);
      prev = now;
      onProgress?.(Math.min(1, real / totalMs));
      if (real >= totalMs) resolve();
      else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
  rec.stop();
  await done;
  return new Blob(chunks, { type: mime.split(';')[0] });
}
