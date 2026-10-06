import { colorFor, makePaceScale, milestones } from './analysis.js';
import { ZONES, hasHr, hrDrift, hrSmooth, routeColorRuns, timeInZones } from './hr.js';
import { analyzeFade, computeSplits } from './splits.js';
import { driftByUnit } from './hrdrift.js';
import { detectIntervals } from './intervals.js';
import { weatherAt, weatherSummary } from './weather.js';
import { aqiCategory, formatDistance, formatDuration, formatElevation, formatPace, formatTemp, toTemp } from './format.js';
import { buildMapBackground, mercX, mercY } from './mapTiles.js';
import { createPdf } from './pdfGraphics.js';
import { buildSummary } from './summary.js';
import { buildNotes } from './explain.js';

// A4 portrait. Layout units are 1240 x 1754 (about 150 dpi); canvases are drawn at SC x for sharp text.
const PW = 1240;
const PH = 1754;
const SC = 1.5;
const MX = 60;
const CW = PW - MX * 2;
const TOP = 52;
const BOTTOM = PH - 78; // footer lives below this
const FONT = 'system-ui, "Segoe UI", Roboto, sans-serif';

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const SOFT = '#f1f5f9';

const font = (g, size, weight = 400) => (g.font = `${weight} ${size}px ${FONT}`);
// text helper: T(g, 'hello', x, y, size, weight, color, align). Pass trunc(g, text, maxW) as the text to ellipsise it
// using the size and weight being drawn (so the measurement matches).
const T = (g, text, x, y, size = 14, weight = 400, color = INK, align = 'left') => {
  font(g, size, weight);
  if (text && typeof text === 'object') {
    let t = text.text;
    if (g.measureText(t).width > text.maxW) {
      while (t.length > 1 && g.measureText(t + '…').width > text.maxW) t = t.slice(0, -1);
      t += '…';
    }
    text = t;
  }
  g.fillStyle = color;
  g.textAlign = align;
  g.fillText(text, x, y);
  g.textAlign = 'left';
};
const trunc = (g, text, maxW) => ({ text, maxW });
const signed = (v, d = 0) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
const driftColor = (d) => (d < 3 ? '#16a34a' : d < 5 ? '#65a30d' : d < 8 ? '#d97706' : '#dc2626');

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ---------- page flow ----------
function makeDoc(newPage) {
  const doc = { pages: [], g: null, y: TOP };
  doc.add = () => {
    const page = newPage();
    doc.pages.push(page);
    doc.g = page.g;
    doc.y = TOP;
  };
  doc.ensure = (h) => {
    if (doc.y + h > BOTTOM) doc.add();
  };
  doc.add();
  return doc;
}

function heading(doc, title, sub, need = 70) {
  doc.ensure(Math.max(70, need));
  const { g } = doc;
  doc.y += 8;
  T(g, title, MX, doc.y + 16, 21, 700);
  if (sub) T(g, sub, PW - MX, doc.y + 16, 13, 400, MUTED, 'right');
  g.fillStyle = LINE;
  g.fillRect(MX, doc.y + 26, CW, 2);
  doc.y += 40;
}

function footer(g, n, total, weatherOn) {
  const note = weatherOn ? 'Weather & air quality: Open-Meteo.com (modelled, not measured on your route)  ·  ' : '';
  T(g, `${note}Map © OpenStreetMap contributors`, MX, PH - 40, 12, 400, MUTED);
  T(g, 'Made with Run Replay', MX, PH - 20, 12, 400, MUTED);
  T(g, `Page ${n} of ${total}`, PW - MX, PH - 20, 12, 400, MUTED, 'right');
}

// ---------- small building blocks ----------
function tile(g, x, y, w, h, t) {
  rr(g, x, y, w, h, 10);
  g.fillStyle = SOFT;
  g.fill();
  T(g, t.label, x + 12, y + 22, 12, 400, MUTED);
  font(g, 24, 700);
  T(g, trunc(g, t.value, w - 20), x + 12, y + 51, 24, 700, t.color || INK);
  if (t.sub) T(g, trunc(g, t.sub, w - 20), x + 12, y + 70, 11.5, 400, MUTED);
}

// Greedy word wrap using the font size and weight that will be drawn
function wrapLines(g, text, maxW, size, weight = 400) {
  font(g, size, weight);
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (line && g.measureText(test).width > maxW) {
      out.push(line);
      line = word;
    } else line = test;
  }
  if (line) out.push(line);
  return out;
}

// "What this means" note: a tinted box with a short title and paragraphs that can start with a bold lead-in
function explainBox(doc, paras) {
  if (!paras || !paras.length) return;
  const SIZE = 12;
  const LH = 16.5;
  const x0 = MX + 26;
  const maxW = CW - 26 - 16;
  let g = doc.g;
  const laid = paras.map((p) => {
    font(g, SIZE, 700);
    const leadW = p.lead ? g.measureText(`${p.lead} `).width : 0;
    font(g, SIZE, 400);
    const lines = [];
    let line = '';
    let limit = maxW - leadW;
    for (const word of p.text.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (line && g.measureText(test).width > limit) {
        lines.push(line);
        line = word;
        limit = maxW;
      } else line = test;
    }
    if (line) lines.push(line);
    return { ...p, leadW, lines };
  });
  const total = laid.reduce((a, p) => a + p.lines.length, 0);
  const h = 50 + (total - 1) * LH + (laid.length - 1) * 5;
  doc.ensure(h + 8);
  g = doc.g;
  const y = doc.y + 4;
  rr(g, MX, y, CW, h, 8);
  g.fillStyle = '#eff6ff';
  g.fill();
  g.fillStyle = '#2563eb';
  g.fillRect(MX + 12, y + 10, 3, h - 20);
  T(g, 'What this means', x0, y + 21, 12, 700, '#1d4ed8');
  let ty = y + 40;
  for (const p of laid) {
    p.lines.forEach((l, i) => {
      if (i === 0 && p.lead) {
        T(g, p.lead, x0, ty, SIZE, 700, INK);
        T(g, l, x0 + p.leadW, ty, SIZE, 400, '#334155');
      } else T(g, l, x0, ty, SIZE, 400, '#334155');
      ty += LH;
    });
    ty += 5;
  }
  doc.y = y + h + 12;
}

// Line chart over time with min/max labels, optional zone bands
function chart(g, x, y, w, h, o) {
  rr(g, x, y, w, h, 8);
  g.fillStyle = '#fff';
  g.fill();
  g.strokeStyle = LINE;
  g.lineWidth = 1.5;
  g.stroke();
  T(g, o.title, x + 10, y + 19, 13, 700);
  const vals = o.pts.map((p) => p[1]).filter((v) => v != null && !Number.isNaN(v));
  if (!vals.length) {
    T(g, 'no data', x + w / 2, y + h / 2, 13, 400, MUTED, 'center');
    return;
  }
  let lo0 = Math.min(...vals);
  let hi0 = Math.max(...vals);
  if (o.clip && vals.length > 20) {
    const sorted = [...vals].sort((a, b) => a - b);
    lo0 = sorted[Math.floor(sorted.length * 0.03)];
    hi0 = sorted[Math.floor(sorted.length * 0.97)];
  }
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  T(g, o.summary ? o.summary(lo0, hi0, avg) : '', x + w - 10, y + 19, 11.5, 400, MUTED, 'right');
  const padV = (hi0 - lo0 || 1) * 0.1;
  const lo = lo0 - padV;
  const hi = hi0 + padV;
  const px = x + 46;
  const py = y + 28;
  const pw = w - 58;
  const ph = h - 28 - 22;
  const X = (t) => px + (t / o.duration) * pw;
  const Y = (v) => py + ph - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * ph;

  if (o.bands) {
    for (const b of o.bands) {
      const t = Math.min(hi, b.hi);
      const bt = Math.max(lo, b.lo);
      if (t <= bt) continue;
      g.fillStyle = b.color;
      g.globalAlpha = 0.16;
      g.fillRect(px, Y(t), pw, Y(bt) - Y(t));
      g.globalAlpha = 1;
    }
  }
  g.strokeStyle = LINE;
  g.lineWidth = 1;
  for (const f of [0, 0.5, 1]) {
    g.beginPath();
    g.moveTo(px, py + ph * f);
    g.lineTo(px + pw, py + ph * f);
    g.stroke();
  }
  // line (breaks at gaps)
  g.strokeStyle = o.color;
  g.lineWidth = 1.7;
  g.lineJoin = 'round';
  g.beginPath();
  let pen = false;
  for (const [t, v] of o.pts) {
    if (v == null || Number.isNaN(v)) {
      pen = false;
      continue;
    }
    pen ? g.lineTo(X(t), Y(v)) : g.moveTo(X(t), Y(v));
    pen = true;
  }
  g.stroke();
  T(g, o.fmt(hi), px - 5, py + 9, 11, 400, MUTED, 'right');
  T(g, o.fmt(lo), px - 5, py + ph, 11, 400, MUTED, 'right');
  T(g, '0:00', px, y + h - 8, 11, 400, MUTED);
  T(g, formatDuration(o.duration / 2), px + pw / 2, y + h - 8, 11, 400, MUTED, 'center');
  T(g, formatDuration(o.duration), px + pw, y + h - 8, 11, 400, MUTED, 'right');
}

// ---------- the report ----------
export async function buildReport({ run, weather, weatherOn, units, tempUnit, colorMode, maxHr, maxHrEstimated = false, basis, format = 'pdf' }) {
  const unitMeters = units === 'mi' ? 1609.344 : 1000;
  const unitWord = units === 'mi' ? 'mile' : 'km';
  const st = run.stats;
  const duration = run.ts[run.ts.length - 1];

  const splitsM = computeSplits(run, unitMeters, 'moving');
  const splitsE = computeSplits(run, unitMeters, 'elapsed');
  const fadeM = analyzeFade(run, splitsM, 'moving');
  const fadeE = analyzeFade(run, splitsE, 'elapsed');
  const scale = makePaceScale([run]);
  const wx = weatherOn ? weather[run.id]?.data : null;
  const wsum = wx ? weatherSummary(wx, run) : null;
  const hrOk = hasHr(run) && !!maxHr;
  const drift = hrOk ? hrDrift(run) : null;
  const kmDrift = hrOk ? driftByUnit(run, unitMeters, units) : null;
  const driftByN = new Map((kmDrift?.rows || []).map((r) => [r.n, r]));
  const zonesMode = colorMode === 'zone' && hrOk;
  const intervals = detectIntervals(run);

  const zonesTop = hrOk ? timeInZones(run, maxHr) : null;
  const notes = buildNotes({ run, units, unitMeters, fadeM, fadeE, splitsM, splitsE, drift, kmDrift, zones: zonesTop, maxHr, maxHrEstimated, intervals, zonesMode });

  // PDF output draws real text and vector shapes; image output draws onto canvases
  const pdfDoc = format === 'pdf' ? await createPdf({ title: `${run.name} - run report`, layoutW: PW, layoutH: PH }) : null;
  const newPage = pdfDoc
    ? () => {
        const g = pdfDoc.addPage();
        return { g, handle: g };
      }
    : () => {
        const c = document.createElement('canvas');
        c.width = PW * SC;
        c.height = PH * SC;
        const g = c.getContext('2d');
        g.scale(SC, SC);
        g.fillStyle = '#fff';
        g.fillRect(0, 0, PW, PH);
        g.textBaseline = 'alphabetic';
        return { g, handle: c };
      };
  const placeImage = async (gfx, canvas, x, y, w, h) => (gfx.image ? gfx.image(canvas, x, y, w, h) : gfx.drawImage(canvas, x, y, w, h));
  const doc = makeDoc(newPage);
  let g = doc.g;

  // ===== header =====
  g.fillStyle = INK;
  g.fillRect(0, 0, PW, 108);
  T(g, 'RUN REPORT', MX, 38, 13, 600, '#94a3b8');
  font(g, 32, 700);
  T(g, trunc(g, run.name, CW), MX, 76, 32, 700, '#fff');
  T(g, new Date(run.startTime).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' }), MX, 98, 14.5, 400, '#cbd5e1');
  doc.y = 126;

  // ===== stat tiles =====
  const tiles = [
    { label: 'Distance', value: formatDistance(st.distance, units) },
    { label: 'Elapsed time', value: formatDuration(st.duration) },
    { label: 'Moving time', value: formatDuration(st.movingTime), sub: `stopped ${formatDuration(Math.max(0, st.duration - st.movingTime))}` },
    { label: 'Avg pace (moving)', value: formatPace(st.avgSpeed, units) },
    { label: 'Avg pace (elapsed)', value: formatPace(st.distance / (st.duration / 1000), units) },
  ];
  if (st.elevGain != null) tiles.push({ label: 'Elevation gain', value: formatElevation(st.elevGain, units) });
  if (st.avgHr != null) {
    tiles.push({ label: 'Average heart rate', value: `${Math.round(st.avgHr)} bpm` });
    tiles.push({ label: 'Max heart rate', value: `${Math.round(st.maxHr)} bpm` });
  }
  if (wsum) {
    tiles.push({ label: 'Temperature', value: formatTemp(wsum.temp, tempUnit), sub: `feels like ${formatTemp(wsum.feels, tempUnit)}` });
    tiles.push({ label: 'Humidity', value: `${Math.round(wsum.rh)}%` });
    if (wsum.aqi != null) {
      const cat = aqiCategory(wsum.aqi);
      tiles.push({ label: 'Air quality (US AQI)', value: String(Math.round(wsum.aqi)), sub: cat.label, color: cat.color });
    }
  }
  const tcols = 6;
  const tgap = 10;
  const tw = (CW - tgap * (tcols - 1)) / tcols;
  tiles.slice(0, 12).forEach((t, i) => tile(g, MX + (i % tcols) * (tw + tgap), doc.y + Math.floor(i / tcols) * (82 + tgap), tw, 82, t));
  doc.y += Math.ceil(Math.min(tiles.length, 12) / tcols) * (82 + tgap) + 6;

  // ===== map (smaller, extra padding so the whole route shows) =====
  const mapW = CW;
  const mapH = 450;
  doc.ensure(mapH + 20);
  g = doc.g;
  const mapY = doc.y;
  let minMx = Infinity, maxMx = -Infinity, minMy = Infinity, maxMy = -Infinity;
  for (const p of run.points) {
    const mx = mercX(p.lon);
    const my = mercY(p.lat);
    minMx = Math.min(minMx, mx); maxMx = Math.max(maxMx, mx);
    minMy = Math.min(minMy, my); maxMy = Math.max(maxMy, my);
  }
  const spanX = Math.max(maxMx - minMx, 1e-9);
  const spanY = Math.max(maxMy - minMy, 1e-9);
  const pad = 110; // generous margin: zoomed out so the full route and its labels fit
  const s = Math.min((mapW - pad * 2) / spanX, (mapH - pad * 2) / spanY);
  const ox = (mapW - spanX * s) / 2;
  const oy = (mapH - spanY * s) / 2;
  const proj = (lat, lon) => [ox + (mercX(lon) - minMx) * s, oy + (mercY(lat) - minMy) * s];

  const MS = 2; // the map is a picture: draw it at 2x so streets and labels stay sharp
  const bg = await buildMapBackground({ s, ox, oy, minMx, minMy, mapW, h: mapH, dim: 0, px: MS });
  const mc = document.createElement('canvas');
  mc.width = mapW * MS;
  mc.height = mapH * MS;
  const mg = mc.getContext('2d');
  mg.fillStyle = '#e2e8f0';
  mg.fillRect(0, 0, mc.width, mc.height);
  if (bg) mg.drawImage(bg, 0, 0, mc.width, mc.height);
  mg.scale(MS, MS);
  if (!bg) T(mg, 'Map unavailable (offline?): route shown without a background', mapW / 2, 30, 14, 400, MUTED, 'center');
  mg.fillStyle = 'rgba(255,255,255,0.2)';
  mg.fillRect(0, 0, mapW, mapH);

  mg.lineCap = mg.lineJoin = 'round';
  mg.strokeStyle = '#fff';
  mg.lineWidth = 12;
  mg.beginPath();
  run.points.forEach((p, i) => {
    const [x, y] = proj(p.lat, p.lon);
    i ? mg.lineTo(x, y) : mg.moveTo(x, y);
  });
  mg.stroke();
  mg.lineWidth = 7;
  for (const cr of routeColorRuns(run, scale, colorMode, maxHr)) {
    mg.strokeStyle = cr.color;
    mg.beginPath();
    for (let i = cr.from; i <= cr.to; i++) {
      const [x, y] = proj(run.points[i].lat, run.points[i].lon);
      i === cr.from ? mg.moveTo(x, y) : mg.lineTo(x, y);
    }
    mg.stroke();
  }
  const marks = milestones(run, unitMeters, units);
  for (const m of marks.filter((k) => k.kind === 'unit')) {
    const [x, y] = proj(m.lat, m.lon);
    mg.beginPath();
    mg.arc(x, y, 10.5, 0, Math.PI * 2);
    mg.fillStyle = '#fff';
    mg.fill();
    mg.lineWidth = 2;
    mg.strokeStyle = INK;
    mg.stroke();
    mg.textBaseline = 'middle';
    T(mg, String(parseInt(m.label, 10)), x, y + 1, 10.5, 700, INK, 'center');
    mg.textBaseline = 'alphabetic';
  }
  const flag = (m, text, color) => {
    const [x, y] = proj(m.lat, m.lon);
    mg.beginPath();
    mg.arc(x, y, 8, 0, Math.PI * 2);
    mg.fillStyle = color;
    mg.fill();
    mg.lineWidth = 3;
    mg.strokeStyle = '#fff';
    mg.stroke();
    font(mg, 13, 700);
    const w = mg.measureText(text).width + 18;
    rr(mg, x - w / 2, y - 40, w, 24, 12);
    mg.fillStyle = color;
    mg.fill();
    T(mg, text, x, y - 23, 13, 700, '#fff', 'center');
  };
  flag(marks[0], 'Start', '#16a34a');
  flag(marks[marks.length - 1], `Finish ${formatDuration(duration)}`, INK);

  // legend + credit
  const lx = 14;
  const ly = mapH - 52;
  rr(mg, lx, ly, 330, 38, 9);
  mg.fillStyle = 'rgba(255,255,255,0.94)';
  mg.fill();
  if (zonesMode) {
    ZONES.forEach((z, i) => {
      mg.fillStyle = z.color;
      mg.fillRect(lx + 12 + i * 61, ly + 8, 56, 9);
      T(mg, `Z${z.id}`, lx + 12 + i * 61, ly + 31, 11, 400, MUTED);
    });
  } else {
    const gr = mg.createLinearGradient(lx + 12, 0, lx + 318, 0);
    [0, 0.35, 0.7, 1].forEach((f) => gr.addColorStop(f, colorFor(f)));
    mg.fillStyle = gr;
    mg.fillRect(lx + 12, ly + 8, 306, 9);
    T(mg, 'fast', lx + 12, ly + 31, 11, 400, MUTED);
    T(mg, 'slow  (route coloured by pace)', lx + 318, ly + 31, 11, 400, MUTED, 'right');
  }
  font(mg, 11);
  const credit = '© OpenStreetMap contributors';
  const cw = mg.measureText(credit).width + 10;
  mg.fillStyle = 'rgba(255,255,255,0.85)';
  mg.fillRect(mapW - cw, mapH - 18, cw, 18);
  T(mg, credit, mapW - cw + 5, mapH - 5, 11, 400, '#334155');
  g.save();
  rr(g, MX, mapY, mapW, mapH, 12);
  g.clip();
  await placeImage(g, mc, MX, mapY, mapW, mapH);
  g.restore();
  rr(g, MX, mapY, mapW, mapH, 12);
  g.strokeStyle = LINE;
  g.lineWidth = 1.5;
  g.stroke();
  doc.y = mapY + mapH + 14;

  // ===== highlights =====
  const boxes = [];
  if (fadeM) {
    boxes.push({ title: 'Pacing (moving)', big: fadeM.verdict.label, color: fadeM.verdict.color, line: `1st half ${formatPace(fadeM.first, units, false)} → 2nd half ${formatPace(fadeM.second, units, false)} /${units}` });
    if (fadeM.consistency) boxes.push({ title: 'Consistency', big: fadeM.consistency, line: `±${fadeM.cv.toFixed(1)}% between ${units === 'mi' ? 'miles' : 'km'}` });
  }
  if (drift) boxes.push({ title: 'Heart-rate drift', big: `${drift.decoupling.toFixed(1)}%  ${drift.verdict.label}`, color: drift.verdict.color, line: `HR ${Math.round(drift.first.hr)} → ${Math.round(drift.second.hr)} bpm` });
  if (boxes.length) {
    doc.ensure(86);
    g = doc.g;
    const bw = (CW - 12 * (boxes.length - 1)) / boxes.length;
    boxes.forEach((b, i) => {
      const x = MX + i * (bw + 12);
      rr(g, x, doc.y, bw, 74, 10);
      g.fillStyle = SOFT;
      g.fill();
      T(g, b.title, x + 14, doc.y + 20, 12, 400, MUTED);
      font(g, 22, 700);
      T(g, trunc(g, b.big, bw - 24), x + 14, doc.y + 47, 22, 700, b.color || INK);
      T(g, trunc(g, b.line, bw - 24), x + 14, doc.y + 65, 12, 400, MUTED);
    });
    doc.y += 86;
  }

  explainBox(doc, notes.page1);

  // ===== plain-English summary =====
  {
    const zonesAll = hrOk ? timeInZones(run, maxHr) : null;
    const sum = buildSummary({ run, units, tempUnit, unitMeters, splits: splitsM, fade: fadeM, wx, hrOk, drift, kmDrift, zones: zonesAll, maxHr, intervals });
    const innerW = CW - 40;
    const BODY = 12.5;
    const LH = 17.5;
    const blocks = sum.sections.map((sec) => ({ title: sec.title, lines: wrapLines(g, sec.text, innerW, BODY) }));
    const pointerLines = sum.pointers.map((t) => wrapLines(g, t, innerW - 18, BODY));
    const boxH =
      14 + // top padding
      blocks.reduce((a, b) => a + 18 + b.lines.length * LH + 6, 0) +
      26 + pointerLines.reduce((a, l) => a + l.length * LH + 3, 0) +
      36; // disclaimer
    heading(doc, 'Summary', 'in plain English', boxH + 46);
    doc.ensure(boxH + 10);
    g = doc.g;
    const bx = MX;
    const by = doc.y;
    rr(g, bx, by, CW, boxH, 12);
    g.fillStyle = '#f8fafc';
    g.fill();
    g.strokeStyle = LINE;
    g.lineWidth = 1.5;
    g.stroke();
    let y = by + 26;
    blocks.forEach((b) => {
      T(g, b.title, bx + 20, y, 13, 700, INK);
      y += 18;
      b.lines.forEach((l) => {
        T(g, l, bx + 20, y, BODY, 400, '#1e293b');
        y += LH;
      });
      y += 6;
    });
    g.fillStyle = LINE;
    g.fillRect(bx + 20, y - 2, CW - 40, 1.5);
    y += 18;
    T(g, 'Worth a look', bx + 20, y, 13, 700, INK);
    y += 18;
    pointerLines.forEach((lines) => {
      T(g, '•', bx + 22, y, BODY, 400, '#1e293b');
      lines.forEach((l) => {
        T(g, l, bx + 38, y, BODY, 400, '#1e293b');
        y += LH;
      });
      y += 3;
    });
    T(g, 'Written automatically from the data in this file. These are observations, not medical advice.', bx + 20, by + boxH - 14, 11, 400, MUTED);
    doc.y = by + boxH + 14;
  }

  // ===== charts =====
  heading(doc, 'Progress charts', 'over the run, by elapsed time');
  const N = 260;
  const n = run.ts.length;
  const idxs = Array.from({ length: N }, (_, k) => Math.round((k * (n - 1)) / (N - 1)));
  const hrS = hrSmooth(run);
  const wAt = (i) => (wx ? weatherAt(wx, run.startTime + run.ts[i]) : null);
  const charts = [
    { title: `Pace (/${units}, faster = higher)`, color: '#3b82f6', clip: true, pts: idxs.map((i) => [run.ts[i], run.speed[i] > 0.5 ? run.speed[i] : null]), fmt: (v) => formatPace(v, units, false), summary: (lo, hi, avg) => `avg ${formatPace(avg, units, false)}` },
  ];
  if (hrOk) {
    charts.push({
      title: 'Heart rate (bpm) with zones',
      color: '#ef4444',
      pts: idxs.map((i) => [run.ts[i], Number.isNaN(hrS[i]) ? null : hrS[i]]),
      fmt: (v) => String(Math.round(v)),
      summary: (lo, hi, avg) => `avg ${Math.round(avg)} · max ${Math.round(hi)}`,
      bands: ZONES.map((z) => ({ lo: z.lo * maxHr, hi: Number.isFinite(z.hi) ? z.hi * maxHr : 999, color: z.color })),
    });
  }
  if (run.points.some((p) => p.ele != null)) {
    charts.push({ title: `Elevation (${units === 'mi' ? 'ft' : 'm'})`, color: '#64748b', pts: idxs.map((i) => [run.ts[i], run.points[i].ele == null ? null : units === 'mi' ? run.points[i].ele * 3.28084 : run.points[i].ele]), fmt: (v) => String(Math.round(v)), summary: (lo, hi) => `${Math.round(lo)}–${Math.round(hi)}` });
  }
  if (wx) {
    charts.push({ title: `Temperature (°${tempUnit})`, color: '#f97316', pts: idxs.map((i) => [run.ts[i], toTemp(wAt(i).temp, tempUnit)]), fmt: (v) => String(Math.round(v)), summary: (lo, hi, avg) => `avg ${avg.toFixed(1)}°` });
    charts.push({ title: 'Humidity (%)', color: '#0ea5e9', pts: idxs.map((i) => [run.ts[i], wAt(i).rh]), fmt: (v) => String(Math.round(v)), summary: (lo, hi, avg) => `avg ${Math.round(avg)}%` });
    if (wsum?.aqi != null) charts.push({ title: 'Air quality (US AQI)', color: '#a855f7', pts: idxs.map((i) => [run.ts[i], wAt(i).aqi]), fmt: (v) => String(Math.round(v)), summary: (lo, hi, avg) => `avg ${Math.round(avg)}` });
  }
  const chW = (CW - 14) / 2;
  const chH = 128;
  for (let i = 0; i < charts.length; i += 2) {
    doc.ensure(chH + 14);
    g = doc.g;
    charts.slice(i, i + 2).forEach((c, k) => chart(g, MX + k * (chW + 14), doc.y, chW, chH, { ...c, duration }));
    doc.y += chH + 12;
  }

  explainBox(doc, notes.charts);

  // ===== HR zones =====
  if (hrOk) {
    const z = timeInZones(run, maxHr);
    heading(doc, 'Heart-rate zones', `max HR ${maxHr} bpm`, 230);
    doc.ensure(190);
    g = doc.g;
    let x = MX;
    g.save();
    rr(g, MX, doc.y, CW, 22, 11);
    g.clip();
    ZONES.forEach((zn, i) => {
      const w = z.total ? (z.ms[i] / z.total) * CW : 0;
      g.fillStyle = zn.color;
      g.fillRect(x, doc.y, w, 22);
      x += w;
    });
    g.restore();
    doc.y += 40;
    const colX = [MX, MX + 300, MX + 520, MX + 640];
    ['Zone', 'Range', 'Time', 'Share'].forEach((h, i) => T(g, h, colX[i], doc.y, 12, 600, MUTED));
    doc.y += 8;
    ZONES.forEach((zn, i) => {
      doc.y += 24;
      const lo = Math.round(zn.lo * maxHr);
      const hi = Number.isFinite(zn.hi) ? Math.round(zn.hi * maxHr) - 1 : null;
      g.fillStyle = zn.color;
      g.beginPath();
      g.arc(colX[0] + 6, doc.y - 5, 5, 0, Math.PI * 2);
      g.fill();
      T(g, `Z${zn.id} ${zn.name}`, colX[0] + 18, doc.y, 14, 600);
      T(g, hi == null ? `${lo}+ bpm` : zn.lo === 0 ? `<${Math.round(zn.hi * maxHr)} bpm` : `${lo}–${hi} bpm`, colX[1], doc.y, 14, 400, MUTED);
      T(g, formatDuration(z.ms[i]), colX[2], doc.y, 14);
      T(g, `${z.total ? ((z.ms[i] / z.total) * 100).toFixed(0) : 0}%`, colX[3], doc.y, 14, 600);
    });
    doc.y += 14;
    explainBox(doc, notes.zones);
  }

  // ===== HR drift (whole run) =====
  if (hrOk) {
    heading(doc, 'Heart-rate drift', 'first half vs second half, moving time only', 170);
    doc.ensure(120);
    g = doc.g;
    if (drift) {
      T(g, `${drift.decoupling.toFixed(1)}%`, MX, doc.y + 30, 34, 700, drift.verdict.color);
      T(g, drift.verdict.label, MX + 130, doc.y + 30, 20, 700, drift.verdict.color);
      const cx = [MX + 520, MX + 650, MX + 780, MX + 910];
      ['', 'First half', 'Second half', 'Change'].forEach((h, i) => T(g, h, cx[i], doc.y + 14, 12, 600, MUTED));
      T(g, 'Pace', cx[0], doc.y + 36, 14, 600);
      T(g, formatPace(drift.first.speed, units, false), cx[1], doc.y + 36, 14);
      T(g, formatPace(drift.second.speed, units, false), cx[2], doc.y + 36, 14);
      T(g, `${signed(drift.speedChangePct, 1)}% speed`, cx[3], doc.y + 36, 14, 400, MUTED);
      T(g, 'Avg HR', cx[0], doc.y + 58, 14, 600);
      T(g, String(Math.round(drift.first.hr)), cx[1], doc.y + 58, 14);
      T(g, String(Math.round(drift.second.hr)), cx[2], doc.y + 58, 14);
      T(g, `${signed(drift.hrChange, 0)} bpm`, cx[3], doc.y + 58, 14, 400, MUTED);
      T(g, trunc(g, drift.verdict.note, CW), MX, doc.y + 82, 13, 400, INK);
      T(g, trunc(g, `Drift = fall in speed-per-heartbeat from the first to the second half${drift.warmupSkipped ? ' (first 5 min skipped as warm-up)' : ''}. Hills, heat and intervals distort it.${drift.reliable ? '' : ' Short run: rough guide only.'}`, CW), MX, doc.y + 102, 11.5, 400, MUTED);
      doc.y += 122;
    } else {
      T(g, 'Not enough moving heart-rate data (needs about 10 minutes).', MX, doc.y + 20, 13, 400, MUTED);
      doc.y += 40;
    }
    explainBox(doc, notes.drift);
  }

  // ===== drift by km =====
  if (kmDrift) {
    const rows = kmDrift.rows;
    heading(doc, `Heart-rate drift by ${unitWord}`, `efficiency = speed per heartbeat · baseline ${kmDrift.baseLabel}`, 400);
    doc.ensure(40 + 3 * 20);
    g = doc.g;
    kmDrift.insights.forEach((t) => {
      T(g, '•', MX + 2, doc.y + 12, 13, 400, MUTED);
      T(g, trunc(g, t, CW - 20), MX + 16, doc.y + 12, 13);
      doc.y += 20;
    });
    doc.y += 6;

    // graph: pace + HR lines, drift bars underneath
    const gh = 250;
    doc.ensure(gh + 24);
    g = doc.g;
    const gx = MX + 46;
    const gw = CW - 46 - 40;
    const lineH = 150;
    const gy = doc.y + 6;
    const cnt = rows.length;
    const X = (i) => gx + (cnt === 1 ? gw / 2 : (i / (cnt - 1)) * gw);
    const sp = rows.map((r) => r.speed);
    const hrv = rows.map((r) => r.hr);
    const pd = (a, b) => (b - a || 1) * 0.12;
    const sLo = Math.min(...sp) - pd(Math.min(...sp), Math.max(...sp));
    const sHi = Math.max(...sp) + pd(Math.min(...sp), Math.max(...sp));
    const hLo = Math.min(...hrv) - pd(Math.min(...hrv), Math.max(...hrv));
    const hHi = Math.max(...hrv) + pd(Math.min(...hrv), Math.max(...hrv));
    const YS = (v) => gy + lineH - ((v - sLo) / (sHi - sLo)) * lineH;
    const YH = (v) => gy + lineH - ((v - hLo) / (hHi - hLo)) * lineH;
    g.strokeStyle = LINE;
    g.lineWidth = 1;
    for (const f of [0, 0.5, 1]) {
      g.beginPath();
      g.moveTo(gx, gy + lineH * f);
      g.lineTo(gx + gw, gy + lineH * f);
      g.stroke();
    }
    g.fillStyle = 'rgba(100,116,139,0.13)';
    g.fillRect(X(kmDrift.skip) - 8, gy, X(kmDrift.skip + kmDrift.nBase - 1) - X(kmDrift.skip) + 16, lineH);
    const poly = (Yf, key, color) => {
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      rows.forEach((r, i) => (i ? g.lineTo(X(i), Yf(r[key])) : g.moveTo(X(i), Yf(r[key]))));
      g.stroke();
      g.fillStyle = color;
      rows.forEach((r, i) => {
        g.beginPath();
        g.arc(X(i), Yf(r[key]), 2.8, 0, Math.PI * 2);
        g.fill();
      });
    };
    poly(YS, 'speed', '#3b82f6');
    poly(YH, 'hr', '#ef4444');
    T(g, formatPace(sHi, units, false), gx - 6, gy + 9, 11, 400, '#3b82f6', 'right');
    T(g, formatPace(sLo, units, false), gx - 6, gy + lineH, 11, 400, '#3b82f6', 'right');
    T(g, String(Math.round(hHi)), gx + gw + 6, gy + 9, 11, 400, '#ef4444');
    T(g, String(Math.round(hLo)), gx + gw + 6, gy + lineH, 11, 400, '#ef4444');
    // drift bars
    const by = gy + lineH + 20;
    const bh = 54;
    const zeroY = by + bh * 0.72;
    const maxD = Math.max(10, ...rows.map((r) => Math.abs(r.drift)));
    g.strokeStyle = LINE;
    g.beginPath();
    g.moveTo(gx, zeroY);
    g.lineTo(gx + gw, zeroY);
    g.stroke();
    T(g, 'drift', gx - 6, by + 10, 11, 400, MUTED, 'right');
    const barW = Math.max(3, Math.min(18, (gw / cnt) * 0.7));
    rows.forEach((r, i) => {
      const h = (Math.min(Math.abs(r.drift), maxD) / maxD) * (bh * 0.68);
      g.globalAlpha = r.isBase ? 0.45 : 1;
      g.fillStyle = r.drift >= 0 ? driftColor(r.drift) : '#94a3b8';
      g.fillRect(X(i) - barW / 2, r.drift >= 0 ? zeroY - h : zeroY, barW, Math.max(h, 1));
      g.globalAlpha = 1;
    });
    const stepL = cnt > 16 ? Math.ceil(cnt / 14) : 1;
    rows.forEach((r, i) => (i % stepL === 0 || i === cnt - 1) && T(g, String(r.n), X(i), by + bh + 14, 11, 400, MUTED, 'center'));
    T(g, units, gx - 6, by + bh + 14, 11, 400, MUTED, 'right');
    // key
    const ky = by + bh + 32;
    g.fillStyle = '#3b82f6';
    g.fillRect(gx, ky - 8, 14, 4);
    T(g, `pace (up = faster)`, gx + 20, ky - 2, 12, 400, MUTED);
    g.fillStyle = '#ef4444';
    g.fillRect(gx + 150, ky - 8, 14, 4);
    T(g, 'heart rate', gx + 170, ky - 2, 12, 400, MUTED);
    g.fillStyle = '#d97706';
    g.fillRect(gx + 260, ky - 10, 8, 8);
    T(g, `drift: efficiency lost vs baseline (${kmDrift.baseLabel})`, gx + 274, ky - 2, 12, 400, MUTED);
    doc.y = ky + 16;

    // table (two columns on long runs)
    const twoCols = rows.length > 18;
    const per = twoCols ? Math.ceil(rows.length / 2) : rows.length;
    const colW = twoCols ? (CW - 24) / 2 : CW;
    const rh = 22;
    const hasElev = rows.some((r) => r.elev != null);
    const cx = (w) => [0, 0.09, 0.2, 0.34, 0.5, 0.66, 0.82].map((f) => f * w);
    const drawTable = (list, x0, y0) => {
      const c = cx(colW);
      ['', 'pace', 'HR', 'pace chg', 'HR chg', 'drift', hasElev ? 'elev' : ''].forEach((h, i) => T(g, i ? h : units, x0 + c[i], y0, 11.5, 600, MUTED));
      g.fillStyle = LINE;
      g.fillRect(x0, y0 + 5, colW, 1.5);
      list.forEach((r, k) => {
        const y = y0 + 8 + (k + 1) * rh - 6;
        if (r.isBase) {
          g.fillStyle = 'rgba(100,116,139,0.1)';
          g.fillRect(x0 - 4, y - 15, colW + 8, rh);
        }
        T(g, String(r.n), x0 + c[0], y, 13.5, 600);
        T(g, formatPace(r.speed, units, false), x0 + c[1], y, 13.5, 700);
        T(g, String(Math.round(r.hr)), x0 + c[2], y, 13.5);
        T(g, r.isBase ? '—' : `${signed(r.dSpeedPct, 1)}%`, x0 + c[3], y, 13.5, 400, MUTED);
        T(g, r.isBase ? '—' : signed(r.dHr, 0), x0 + c[4], y, 13.5, 400, MUTED);
        T(g, r.isBase ? 'base' : `${signed(r.drift, 1)}%`, x0 + c[5], y, 13.5, 700, r.isBase ? MUTED : driftColor(r.drift));
        if (hasElev) T(g, r.elev != null ? `${r.elev >= 0 ? '+' : '−'}${formatElevation(Math.abs(r.elev), units).replace(' ', '')}` : '--', x0 + c[6], y, 13.5, 400, MUTED);
      });
    };
    doc.ensure(per * rh + 40);
    g = doc.g;
    drawTable(rows.slice(0, per), MX, doc.y + 14);
    if (twoCols) drawTable(rows.slice(per), MX + colW + 24, doc.y + 14);
    doc.y += per * rh + 38;
    explainBox(doc, notes.kmDrift);
  }

  // ===== splits & fade (moving + elapsed) =====
  heading(doc, `Splits & fade (per ${unitWord})`, 'moving pace leaves out stops · elapsed pace includes them', 320);
  doc.ensure(130);
  g = doc.g;
  const fadeBlock = (x, w, title, fade) => {
    rr(g, x, doc.y, w, 112, 10);
    g.fillStyle = SOFT;
    g.fill();
    T(g, title, x + 12, doc.y + 20, 13, 700);
    if (!fade) return;
    const items = [
      ['Verdict', fade.verdict.label, fade.verdict.color],
      ['1st half', formatPace(fade.first, units, false)],
      ['2nd half', formatPace(fade.second, units, false), fade.halfPct >= 0 ? '#16a34a' : '#d97706'],
      ['Last vs first qtr', `${signed(fade.fadePct, 1)}%`, fade.fadePct >= 0 ? '#16a34a' : '#d97706'],
      ['Consistency', fade.consistency ? `${fade.consistency} ±${fade.cv.toFixed(1)}%` : '--'],
      ['Fastest / slowest', fade.fastest ? `${formatPace(fade.fastest.speed, units, false)} / ${formatPace(fade.slowest.speed, units, false)}` : '--'],
    ];
    const iw = (w - 24) / 3;
    items.forEach(([k, v, col], i) => {
      const ix = x + 12 + (i % 3) * iw;
      const iy = doc.y + 42 + Math.floor(i / 3) * 34;
      T(g, k, ix, iy, 11, 400, MUTED);
      font(g, 14, 700);
      T(g, trunc(g, v, iw - 6), ix, iy + 17, 14, 700, col || INK);
    });
  };
  const bw2 = (CW - 14) / 2;
  fadeBlock(MX, bw2, 'Moving pace', fadeM);
  fadeBlock(MX + bw2 + 14, bw2, 'Elapsed pace', fadeE);
  doc.y += 124;

  const speedsM = splitsM.map((x) => x.speed);
  const top = Math.max(...speedsM);
  const low = Math.min(...speedsM);
  const span = top - low || 1;
  const hasHrCol = splitsM.some((x) => x.hr != null);
  const hasElevCol = splitsM.some((x) => x.elev != null);
  const eByN = new Map(splitsE.map((x) => [x.n, x]));
  const col = { n: MX, mt: MX + 56, mp: MX + 150, ep: MX + 245, bar: MX + 345, hr: MX + 690, el: MX + 760, st: MX + 850, dr: MX + CW };
  const header = (y) => {
    const gg = doc.g;
    T(gg, units, col.n, y, 11.5, 600, MUTED);
    T(gg, 'moving', col.mt, y, 11.5, 600, MUTED);
    T(gg, 'pace (mov)', col.mp, y, 11.5, 600, MUTED);
    T(gg, 'pace (elap)', col.ep, y, 11.5, 600, MUTED);
    if (hasHrCol) T(gg, 'HR', col.hr, y, 11.5, 600, MUTED);
    if (hasElevCol) T(gg, 'elev', col.el, y, 11.5, 600, MUTED);
    T(gg, 'stopped', col.st, y, 11.5, 600, MUTED);
    if (kmDrift) T(gg, 'drift', col.dr, y, 11.5, 600, MUTED, 'right');
    gg.fillStyle = LINE;
    gg.fillRect(MX, y + 6, CW, 1.5);
  };
  const rowH = 25;
  doc.ensure(rowH * 3 + 30);
  header(doc.y + 12);
  doc.y += 20;
  splitsM.forEach((sp, r) => {
    if (doc.y + rowH > BOTTOM) {
      doc.add();
      header(doc.y + 12);
      doc.y += 20;
    }
    const gg = doc.g;
    const y = doc.y;
    if (r % 2 === 0) {
      gg.fillStyle = '#f8fafc';
      gg.fillRect(MX - 6, y, CW + 12, rowH);
    }
    const base = y + 17;
    const e = eByN.get(sp.n);
    T(gg, sp.full ? String(sp.n) : (sp.meters / unitMeters).toFixed(2), col.n, base, 13.5, 600);
    T(gg, formatDuration(sp.movingMs), col.mt, base, 13.5);
    T(gg, formatPace(sp.speed, units, false), col.mp, base, 13.5, 700, fadeM && sp === fadeM.fastest ? '#16a34a' : fadeM && sp === fadeM.slowest ? '#dc2626' : INK);
    T(gg, e ? formatPace(e.speed, units, false) : '--', col.ep, base, 13.5, 400, MUTED);
    const rel = (sp.speed - low) / span;
    rr(gg, col.bar, y + 7, 300 * (0.35 + rel * 0.65), 11, 5.5);
    gg.fillStyle = colorFor(1 - rel);
    gg.fill();
    if (hasHrCol) T(gg, sp.hr != null ? String(Math.round(sp.hr)) : '--', col.hr, base, 13.5);
    if (hasElevCol) T(gg, sp.elev != null ? `${sp.elev >= 0 ? '+' : '−'}${formatElevation(Math.abs(sp.elev), units).replace(' ', '')}` : '--', col.el, base, 13.5, 400, MUTED);
    T(gg, sp.stoppedMs > 5000 ? formatDuration(sp.stoppedMs) : '', col.st, base, 13.5, 400, MUTED);
    if (kmDrift) {
      const d = driftByN.get(sp.n);
      if (d && sp.full) T(gg, d.isBase ? 'base' : `${signed(d.drift, 1)}%`, col.dr, base, 13.5, 700, d.isBase ? MUTED : driftColor(d.drift), 'right');
    }
    doc.y += rowH;
  });
  doc.y += 6;
  doc.ensure(40);
  T(doc.g, 'Bars: longer = faster within this run (moving pace). Drift = efficiency lost vs the baseline. Stopped = time paused inside that split.', MX, doc.y + 12, 11.5, 400, MUTED);
  doc.y += 24;
  explainBox(doc, notes.splits);

  // ===== intervals =====
  heading(doc, 'Intervals', undefined, 140);
  if (!intervals) {
    doc.ensure(30);
    T(doc.g, 'No repeated hard efforts found: this looks like a steady run.', MX, doc.y + 12, 13, 400, MUTED);
    doc.y += 28;
  } else {
    const sm = intervals.summary;
    const typical = sm.basis === 'time' ? formatDuration(Math.round(sm.avgMs / 15000) * 15000) : `~${units === 'mi' ? `${(Math.round(sm.avgDist / 50) * 50 / unitMeters).toFixed(2)} mi` : `${Math.round(sm.avgDist / 50) * 50} m`}`;
    doc.ensure(60);
    g = doc.g;
    T(g, `${sm.count} × ${typical} at ${formatPace(sm.avgSpeed, units)}`, MX, doc.y + 16, 18, 700);
    T(g, `${intervals.kind === 'run/walk' ? 'run / walk blocks' : sm.regular ? 'intervals' : 'variable efforts'} · first → last rep ${signed(sm.speedChangePct, 1)}% speed · pace spread ±${sm.paceSpread.toFixed(1)}%${sm.hrFirst != null ? ` · HR ${Math.round(sm.hrFirst)} → ${Math.round(sm.hrLast)}` : ''}`, MX, doc.y + 38, 12.5, 400, MUTED);
    doc.y += 54;
    const ic = [MX, MX + 50, MX + 170, MX + 270, MX + 370, MX + 520];
    const ihead = (y) => ['#', 'distance', 'time', 'pace', 'HR avg/max', 'recovery'].forEach((h, i) => T(doc.g, h, ic[i], y, 11.5, 600, MUTED));
    doc.ensure(rowH * 3);
    ihead(doc.y + 10);
    doc.y += 18;
    intervals.reps.forEach((rp, r) => {
      if (doc.y + rowH > BOTTOM) {
        doc.add();
        ihead(doc.y + 10);
        doc.y += 18;
      }
      const gg = doc.g;
      const y = doc.y + 17;
      if (r % 2 === 0) {
        gg.fillStyle = '#f8fafc';
        gg.fillRect(MX - 6, doc.y, CW + 12, rowH);
      }
      T(gg, String(rp.n), ic[0], y, 13.5, 600);
      T(gg, units === 'mi' ? `${(rp.dist / 1609.344).toFixed(2)} mi` : rp.dist < 1000 ? `${Math.round(rp.dist)} m` : `${(rp.dist / 1000).toFixed(2)} km`, ic[1], y, 13.5);
      T(gg, formatDuration(rp.ms), ic[2], y, 13.5);
      T(gg, formatPace(rp.speed, units, false), ic[3], y, 13.5, 700);
      T(gg, rp.avgHr != null ? `${Math.round(rp.avgHr)} / ${rp.maxHr ?? '--'}` : '--', ic[4], y, 13.5);
      T(gg, rp.rec ? `${formatDuration(rp.rec.ms)}${rp.rec.hrDrop != null ? `  ↓${Math.round(rp.rec.hrDrop)} bpm` : ''}` : '--', ic[5], y, 13.5, 400, MUTED);
      doc.y += rowH;
    });
  }

  explainBox(doc, notes.intervals);

  doc.pages.forEach((p, i) => footer(p.g, i + 1, doc.pages.length, weatherOn));
  if (pdfDoc) return { kind: 'pdf', bytes: await pdfDoc.save() };
  return { kind: 'image', pages: doc.pages.map((p) => p.handle) };
}

const toJpeg = (canvas, q = 0.9) => new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));

// All pages in one JPEG, stacked top to bottom
export async function pagesToImage(pages) {
  const c = document.createElement('canvas');
  c.width = pages[0].width;
  c.height = pages.reduce((a, p) => a + p.height, 0);
  const g = c.getContext('2d');
  let y = 0;
  for (const p of pages) {
    g.drawImage(p, 0, y);
    y += p.height;
  }
  return toJpeg(c, 0.88);
}
