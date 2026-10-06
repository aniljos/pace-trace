// A small canvas-2D-like drawing surface that writes real vector PDF content (text stays text, shapes stay shapes).
// It implements just the subset of the CanvasRenderingContext2D API the report uses, so the same drawing code can
// target either a canvas (image export) or a PDF page.
import {
  PDFDocument,
  appendBezierCurve,
  clip,
  closePath,
  endPath,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingRgbColor,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
  LineCapStyle,
  LineJoinStyle,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff?url';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff?url';

const A4_W = 595.28;
const A4_H = 841.89;
const TAU = Math.PI * 2;

export function parseColor(str) {
  const s = String(str).trim();
  let m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const [r, g, b] = [...m[1]].map((c) => parseInt(c + c, 16) / 255);
    return { r, g, b, a: 1 };
  }
  m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16) / 255, g: parseInt(m[1].slice(2, 4), 16) / 255, b: parseInt(m[1].slice(4, 6), 16) / 255, a: 1 };
  m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (m) return { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255, a: m[4] == null ? 1 : +m[4] };
  return { r: 0, g: 0, b: 0, a: 1 };
}

// Bezier approximation of a circular arc, appended to `path` (coordinates are layout units)
function arcSegments(path, cx, cy, r, a0, a1, acw) {
  let sweep = a1 - a0;
  if (!acw && sweep < 0) sweep = (sweep % TAU) + TAU;
  if (acw && sweep > 0) sweep = (sweep % TAU) - TAU;
  sweep = Math.max(-TAU, Math.min(TAU, sweep));
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const d = sweep / n;
  const k = (4 / 3) * Math.tan(d / 4);
  let a = a0;
  for (let i = 0; i < n; i++) {
    const x0 = cx + r * Math.cos(a);
    const y0 = cy + r * Math.sin(a);
    const x3 = cx + r * Math.cos(a + d);
    const y3 = cy + r * Math.sin(a + d);
    path.push(['C', x0 - k * r * Math.sin(a), y0 + k * r * Math.cos(a), x3 + k * r * Math.sin(a + d), y3 - k * r * Math.cos(a + d), x3, y3]);
    a += d;
  }
}

class PdfGraphics {
  constructor(pdf, page, fonts, layoutW, layoutH) {
    this.pdf = pdf;
    this.page = page;
    this.fonts = fonts;
    this.k = A4_W / layoutW; // layout units -> PDF points
    this.H = A4_H;
    this.layoutH = layoutH;
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.lineWidth = 1;
    this.lineCap = 'butt';
    this.lineJoin = 'miter';
    this.globalAlpha = 1;
    this.font = '400 14px sans-serif';
    this.textAlign = 'left';
    this.textBaseline = 'alphabetic';
    this.path = [];
    this.cur = null;
    this.start = null;
    this.stack = [];
    this.gs = new Map();
  }

  X = (x) => x * this.k;
  Y = (y) => this.H - y * this.k;

  save() {
    const { fillStyle, strokeStyle, lineWidth, lineCap, lineJoin, globalAlpha, font, textAlign, textBaseline } = this;
    this.stack.push({ fillStyle, strokeStyle, lineWidth, lineCap, lineJoin, globalAlpha, font, textAlign, textBaseline });
    this.page.pushOperators(pushGraphicsState());
  }

  restore() {
    Object.assign(this, this.stack.pop());
    this.page.pushOperators(popGraphicsState());
  }

  // ---- path building ----
  beginPath() {
    this.path = [];
    this.cur = null;
  }
  moveTo(x, y) {
    this.path.push(['M', x, y]);
    this.cur = this.start = [x, y];
  }
  lineTo(x, y) {
    if (!this.cur) return this.moveTo(x, y);
    this.path.push(['L', x, y]);
    this.cur = [x, y];
  }
  closePath() {
    if (!this.cur) return;
    this.path.push(['Z']);
    this.cur = this.start;
  }
  rect(x, y, w, h) {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }
  arc(cx, cy, r, a0, a1, acw = false) {
    const sx = cx + r * Math.cos(a0);
    const sy = cy + r * Math.sin(a0);
    this.cur ? this.lineTo(sx, sy) : this.moveTo(sx, sy);
    arcSegments(this.path, cx, cy, r, a0, a1, acw);
    const full = Math.abs(a1 - a0) >= TAU - 1e-9 ? 0 : a1 - a0;
    const endA = full === 0 ? a0 : a1;
    this.cur = [cx + r * Math.cos(endA), cy + r * Math.sin(endA)];
  }
  // Canvas arcTo: rounded corner at (x1,y1) between the current point and (x2,y2)
  arcTo(x1, y1, x2, y2, r) {
    if (!this.cur) return this.moveTo(x1, y1);
    const [x0, y0] = this.cur;
    const v1 = [x0 - x1, y0 - y1];
    const v2 = [x2 - x1, y2 - y1];
    const l1 = Math.hypot(...v1);
    const l2 = Math.hypot(...v2);
    if (l1 < 1e-9 || l2 < 1e-9 || !r) return this.lineTo(x1, y1);
    const u1 = [v1[0] / l1, v1[1] / l1];
    const u2 = [v2[0] / l2, v2[1] / l2];
    const cross = u1[0] * u2[1] - u1[1] * u2[0];
    if (Math.abs(cross) < 1e-9) return this.lineTo(x1, y1);
    const half = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]))) / 2;
    const d = r / Math.tan(half);
    const t1 = [x1 + u1[0] * d, y1 + u1[1] * d];
    const t2 = [x1 + u2[0] * d, y1 + u2[1] * d];
    const bis = [u1[0] + u2[0], u1[1] + u2[1]];
    const bl = Math.hypot(...bis);
    const cd = r / Math.sin(half);
    const c = [x1 + (bis[0] / bl) * cd, y1 + (bis[1] / bl) * cd];
    this.lineTo(t1[0], t1[1]);
    arcSegments(this.path, c[0], c[1], r, Math.atan2(t1[1] - c[1], t1[0] - c[0]), Math.atan2(t2[1] - c[1], t2[0] - c[0]), cross > 0);
    this.cur = t2;
  }

  _pathOps() {
    const ops = [];
    for (const s of this.path) {
      if (s[0] === 'M') ops.push(moveTo(this.X(s[1]), this.Y(s[2])));
      else if (s[0] === 'L') ops.push(lineTo(this.X(s[1]), this.Y(s[2])));
      else if (s[0] === 'C') ops.push(appendBezierCurve(this.X(s[1]), this.Y(s[2]), this.X(s[3]), this.Y(s[4]), this.X(s[5]), this.Y(s[6])));
      else ops.push(closePath());
    }
    return ops;
  }

  _alpha(a) {
    const key = Math.round(a * 1000) / 1000;
    if (!this.gs.has(key)) {
      const dict = this.pdf.context.obj({ Type: 'ExtGState', ca: key, CA: key });
      this.gs.set(key, this.page.node.newExtGState(`GS${this.gs.size}`, dict));
    }
    return setGraphicsState(this.gs.get(key));
  }

  // ---- painting ----
  fill() {
    if (!this.path.length) return;
    const c = parseColor(this.fillStyle);
    this.page.pushOperators(this._alpha(c.a * this.globalAlpha), setFillingRgbColor(c.r, c.g, c.b), ...this._pathOps(), fill());
  }
  stroke() {
    if (!this.path.length) return;
    const c = parseColor(this.strokeStyle);
    const cap = { round: LineCapStyle.Round, square: LineCapStyle.Projecting }[this.lineCap] ?? LineCapStyle.Butt;
    const join = { round: LineJoinStyle.Round, bevel: LineJoinStyle.Bevel }[this.lineJoin] ?? LineJoinStyle.Miter;
    this.page.pushOperators(
      this._alpha(c.a * this.globalAlpha),
      setStrokingRgbColor(c.r, c.g, c.b),
      setLineWidth(this.lineWidth * this.k),
      setLineCap(cap),
      setLineJoin(join),
      ...this._pathOps(),
      stroke(),
    );
  }
  clip() {
    this.page.pushOperators(...this._pathOps(), clip(), endPath());
  }
  fillRect(x, y, w, h) {
    this.beginPath();
    this.rect(x, y, w, h);
    this.fill();
    this.beginPath();
  }

  // ---- text ----
  _font() {
    const m = this.font.match(/(\d+)\s+([\d.]+)px/);
    const weight = m ? +m[1] : 400;
    const size = m ? +m[2] : 14;
    return { size, font: this.fonts[weight >= 700 ? 700 : weight >= 600 ? 600 : 400] };
  }
  _clean(text) {
    // characters the embedded font lacks are replaced with plain equivalents
    const set = this.fonts.charset;
    return String(text)
      .replace(/\s*→\s*/g, ' to ')
      .replace(/▶/g, '>')
      .replace(/Δ/g, 'd')
      .replace(/[≥]/g, '>=')
      .replace(/[≤]/g, '<=')
      .replace(/./gu, (ch) => (set.has(ch.codePointAt(0)) ? ch : '?'));
  }
  measureText(text) {
    const { size, font } = this._font();
    return { width: font.widthOfTextAtSize(this._clean(text), size) };
  }
  fillText(text, x, y) {
    const t = this._clean(text);
    if (!t) return;
    const { size, font } = this._font();
    const w = font.widthOfTextAtSize(t, size);
    const x0 = this.textAlign === 'center' ? x - w / 2 : this.textAlign === 'right' ? x - w : x;
    const c = parseColor(this.fillStyle);
    const a = c.a * this.globalAlpha;
    // Transparency lives in the PDF graphics state and would carry over from an earlier translucent shape, so always set it explicitly
    this.page.pushOperators(this._alpha(a));
    this.page.drawText(t, { x: this.X(x0), y: this.Y(y), size: size * this.k, font, color: rgb(c.r, c.g, c.b) });
  }

  // Embeds a canvas as a JPEG at the given layout rectangle
  async image(canvas, x, y, w, h, quality = 0.93) {
    const b64 = canvas.toDataURL('image/jpeg', quality).split(',')[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const img = await this.pdf.embedJpg(bytes);
    this.page.pushOperators(this._alpha(this.globalAlpha));
    this.page.drawImage(img, { x: this.X(x), y: this.Y(y + h), width: w * this.k, height: h * this.k });
  }
}

// A4 PDF document; each page is drawn in layout units (layoutW x layoutH) through a PdfGraphics surface
export async function createPdf({ title, layoutW, layoutH }) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const load = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());
  const [f400, f600, f700] = await Promise.all([inter400, inter600, inter700].map(async (u) => pdf.embedFont(await load(u), { subset: true })));
  const fonts = { 400: f400, 600: f600, 700: f700, charset: new Set(f400.getCharacterSet()) };
  pdf.setTitle(title);
  pdf.setCreator('PaceTrace');
  pdf.setProducer('PaceTrace');
  return {
    addPage() {
      const page = pdf.addPage([A4_W, A4_H]);
      return new PdfGraphics(pdf, page, fonts, layoutW, layoutH);
    },
    save: () => pdf.save(),
  };
}
