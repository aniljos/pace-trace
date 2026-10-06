// Synthetic runs for the demo button and for generating sample GPX files.
// Both runs follow the same ~5 km loop but with different pacing, so comparison is interesting.

const CENTER = { lat: 51.5074, lon: -0.1278 }; // Hyde Park-ish loop

function loopPoint(f) {
  const a = f * Math.PI * 2;
  const r = 0.0105 + 0.0025 * Math.sin(a * 3);
  return { lat: CENTER.lat + r * Math.sin(a) * 0.62, lon: CENTER.lon + r * Math.cos(a) };
}

// paceFn(f) -> speed in m/s at fraction f of the loop
export function makeSampleGpx(name, paceFn, startIso) {
  const STEPS = 700;
  let t = Date.parse(startIso);
  let prev = loopPoint(0);
  const rows = [];
  for (let i = 0; i <= STEPS; i++) {
    const f = i / STEPS;
    const p = loopPoint(f);
    if (i) {
      const dLat = (p.lat - prev.lat) * 111320;
      const dLon = (p.lon - prev.lon) * 111320 * Math.cos((p.lat * Math.PI) / 180);
      t += (Math.hypot(dLat, dLon) / paceFn(f)) * 1000;
    }
    prev = p;
    const ele = 30 + 14 * Math.sin(f * Math.PI * 4) + 6 * Math.sin(f * 40);
    const hr = Math.round(120 + 12 * (paceFn(f) - 2.6) * 6 + 6 * f * 10);
    rows.push(
      `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><ele>${ele.toFixed(1)}</ele>` +
        `<time>${new Date(Math.round(t / 1000) * 1000).toISOString()}</time>` +
        `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="run-replay-sample" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
<trk><name>${name}</name><trkseg>
${rows.join('\n')}
</trkseg></trk></gpx>`;
}

// Steady runner that fades slightly, and a negative-split runner with a fast finish.
export const sampleSteady = () =>
  makeSampleGpx('Sunday long run', (f) => 3.1 - 0.5 * f + 0.25 * Math.sin(f * 25), '2026-09-27T07:30:00Z');
export const sampleNegative = () =>
  makeSampleGpx('Tempo run', (f) => 2.7 + 1.0 * f * f + 0.2 * Math.sin(f * 17), '2026-10-04T18:05:00Z');
