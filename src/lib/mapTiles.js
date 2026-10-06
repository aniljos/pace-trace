// Web Mercator, normalised to 0..1 across the world, so the route lines up with OpenStreetMap tiles
export const mercX = (lon) => (lon + 180) / 360;
export const mercY = (lat) => {
  const sn = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + sn) / (1 - sn)) / (4 * Math.PI);
};

const loadTile = (url) =>
  new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // OSM tiles allow this, so the canvas stays exportable
    const timer = setTimeout(() => resolve(null), 10000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });

// Draws the OpenStreetMap tiles covering the map area into an offscreen canvas, optionally dimmed (0..1) so the route stands out.
// Returns null if no tile could be loaded.
export async function buildMapBackground({ s, ox, oy, minMx, minMy, mapW, h, dim = 0.42, px = 1 }) {
  const wx0 = minMx - ox / s;
  const wy0 = minMy - oy / s;
  const wx1 = minMx + (mapW - ox) / s;
  const wy1 = minMy + (h - oy) / s;
  let z = Math.min(18, Math.max(1, Math.ceil(Math.log2((s * px) / 256))));
  const range = (zz) => {
    const n = 2 ** zz;
    return {
      n,
      x0: Math.floor(wx0 * n),
      x1: Math.floor(wx1 * n),
      y0: Math.max(0, Math.floor(wy0 * n)),
      y1: Math.min(n - 1, Math.floor(wy1 * n)),
    };
  };
  let r = range(z);
  while (z > 1 && (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) > (px > 1 ? 140 : 60)) r = range(--z); // keep the tile count modest
  const jobs = [];
  for (let tx = r.x0; tx <= r.x1; tx++) {
    for (let ty = r.y0; ty <= r.y1; ty++) {
      const wrapped = ((tx % r.n) + r.n) % r.n;
      jobs.push(loadTile(`https://tile.openstreetmap.org/${z}/${wrapped}/${ty}.png`).then((img) => ({ img, tx, ty })));
    }
  }
  const tiles = await Promise.all(jobs);
  if (!tiles.some((t) => t.img)) return null;

  const bg = document.createElement('canvas');
  bg.width = mapW * px;
  bg.height = h * px;
  const g = bg.getContext('2d');
  g.fillStyle = '#cbd5e1';
  g.fillRect(0, 0, mapW * px, h * px);
  const size = (s * px) / r.n;
  for (const { img, tx, ty } of tiles) {
    if (img) g.drawImage(img, (ox + (tx / r.n - minMx) * s) * px, (oy + (ty / r.n - minMy) * s) * px, size + 1, size + 1);
  }
  if (dim > 0) {
    g.fillStyle = `rgba(15, 23, 42, ${dim})`;
    g.fillRect(0, 0, mapW * px, h * px);
  }
  return bg;
}

