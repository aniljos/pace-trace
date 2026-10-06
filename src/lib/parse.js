import FitParser from 'fit-file-parser';

// Every parser returns { name, points: [{ lat, lon, t, ele, hr }] } where t is epoch ms.

function num(el, tag) {
  const n = el.getElementsByTagName(tag)[0];
  if (!n) return null;
  const v = parseFloat(n.textContent);
  return Number.isFinite(v) ? v : null;
}

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('File is not valid XML');
  return doc;
}

export function parseGPX(text) {
  const doc = parseXml(text);
  const points = [];
  for (const pt of doc.getElementsByTagName('trkpt')) {
    const time = pt.getElementsByTagName('time')[0]?.textContent;
    points.push({
      lat: parseFloat(pt.getAttribute('lat')),
      lon: parseFloat(pt.getAttribute('lon')),
      t: time ? Date.parse(time) : NaN,
      ele: num(pt, 'ele'),
      // Garmin extension <gpxtpx:hr>; getElementsByTagName matches the qualified name
      hr: num(pt, 'gpxtpx:hr') ?? num(pt, 'ns3:hr') ?? num(pt, 'hr'),
    });
  }
  const name = doc.getElementsByTagName('name')[0]?.textContent?.trim();
  return { name, points };
}

export function parseTCX(text) {
  const doc = parseXml(text);
  const points = [];
  for (const tp of doc.getElementsByTagName('Trackpoint')) {
    const pos = tp.getElementsByTagName('Position')[0];
    if (!pos) continue;
    const time = tp.getElementsByTagName('Time')[0]?.textContent;
    const hrNode = tp.getElementsByTagName('HeartRateBpm')[0];
    points.push({
      lat: num(pos, 'LatitudeDegrees'),
      lon: num(pos, 'LongitudeDegrees'),
      t: time ? Date.parse(time) : NaN,
      ele: num(tp, 'AltitudeMeters'),
      hr: hrNode ? num(hrNode, 'Value') : null,
    });
  }
  return { name: undefined, points };
}

export async function parseFIT(buffer) {
  const parser = new FitParser({ mode: 'list', speedUnit: 'm/s', lengthUnit: 'm', force: true });
  const data = await parser.parseAsync(buffer);
  const points = (data.records || []).map((r) => ({
    lat: r.position_lat,
    lon: r.position_long,
    t: r.timestamp instanceof Date ? r.timestamp.getTime() : Date.parse(r.timestamp),
    ele: r.enhanced_altitude ?? r.altitude ?? null,
    hr: r.heart_rate ?? null,
  }));
  return { name: undefined, points };
}

function clean(points) {
  const out = [];
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || !Number.isFinite(p.t)) continue;
    if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) continue;
    if (out.length && p.t <= out[out.length - 1].t) continue; // duplicate/out-of-order timestamp
    out.push(p);
  }
  return out;
}

export async function parseActivityFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  let raw;
  if (ext === 'gpx') raw = parseGPX(await file.text());
  else if (ext === 'tcx') raw = parseTCX(await file.text());
  else if (ext === 'fit') raw = await parseFIT(await file.arrayBuffer());
  else throw new Error(`Unsupported file type ".${ext}" — use GPX, TCX or FIT`);

  const points = clean(raw.points);
  if (points.length < 2) {
    throw new Error('No GPS track points with timestamps found (indoor/treadmill activity?)');
  }
  const fallback = file.name.replace(/\.[^.]+$/, '');
  return { name: raw.name || fallback, points };
}
