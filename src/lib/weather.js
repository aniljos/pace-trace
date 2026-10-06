// Historical weather from Open-Meteo (https://open-meteo.com, CC BY 4.0). No API key needed.
// Only the run's approximate start location (rounded to ~1 km) and its date are sent.

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality'; // CAMS air-quality model
const FORECAST = 'https://api.open-meteo.com/v1/forecast'; // covers the last few days the archive hasn't caught up with
const HOUR = 3600e3;
const cache = new Map();

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

async function query(base, lat, lon, from, to) {
  const url =
    `${base}?latitude=${lat}&longitude=${lon}&start_date=${from}&end_date=${to}` +
    `&hourly=temperature_2m,relative_humidity_2m,apparent_temperature&timezone=GMT`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather service returned ${res.status}`);
  const { hourly } = await res.json();
  const hours = [];
  hourly?.time?.forEach((t, i) => {
    const temp = hourly.temperature_2m[i];
    const rh = hourly.relative_humidity_2m[i];
    if (temp == null || rh == null) return;
    hours.push({ t: Date.parse(`${t}Z`), temp, rh, feels: hourly.apparent_temperature[i] ?? temp });
  });
  return hours;
}

// Hourly US AQI and PM2.5 as a Map of epoch ms -> { aqi, pm25 }. Optional: failures just mean no AQI.
async function queryAir(lat, lon, from, to) {
  const url = `${AIR}?latitude=${lat}&longitude=${lon}&start_date=${from}&end_date=${to}&hourly=us_aqi,pm2_5&timezone=GMT`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Air quality service returned ${res.status}`);
  const { hourly } = await res.json();
  const out = new Map();
  hourly?.time?.forEach((t, i) => {
    out.set(Date.parse(`${t}Z`), { aqi: hourly.us_aqi[i] ?? null, pm25: hourly.pm2_5[i] ?? null });
  });
  return out;
}

// Returns { hours: [{ t, temp (°C), rh (%), feels (°C) }] } covering the run
export async function fetchWeather(run) {
  const start = run.startTime;
  const end = run.startTime + run.stats.duration;
  const lat = run.points[0].lat.toFixed(2);
  const lon = run.points[0].lon.toFixed(2);
  const from = day(start - HOUR);
  const to = day(end + HOUR);
  const key = `${lat},${lon},${from},${to}`;
  if (!cache.has(key)) {
    const airPromise = queryAir(lat, lon, from, to).catch(() => new Map());
    const recent = Date.now() - end < 7 * 24 * HOUR;
    const order = recent ? [FORECAST, ARCHIVE] : [ARCHIVE, FORECAST];
    cache.set(
      key,
      (async () => {
        let lastErr;
        for (const base of order) {
          try {
            const hours = await query(base, lat, lon, from, to);
            if (hours.length >= 2) {
              const air = await airPromise;
              for (const h of hours) Object.assign(h, { aqi: air.get(h.t)?.aqi ?? null, pm25: air.get(h.t)?.pm25 ?? null });
              return { hours };
            }
          } catch (e) {
            lastErr = e;
          }
        }
        throw lastErr || new Error('No weather data for this date');
      })(),
    );
    cache.get(key).catch(() => cache.delete(key)); // allow retry after a failure
  }
  return cache.get(key);
}

// Linearly interpolated conditions at an absolute time (epoch ms)
export function weatherAt(w, absMs) {
  const h = w.hours;
  if (absMs <= h[0].t) return h[0];
  if (absMs >= h[h.length - 1].t) return h[h.length - 1];
  let lo = 0;
  let hi = h.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (h[mid].t <= absMs) lo = mid;
    else hi = mid;
  }
  const f = (absMs - h[lo].t) / (h[hi].t - h[lo].t);
  const mix = (k) => {
    const a = h[lo][k];
    const b = h[hi][k];
    if (a == null || b == null) return a ?? b ?? null;
    return a + (b - a) * f;
  };
  return { temp: mix('temp'), rh: mix('rh'), feels: mix('feels'), aqi: mix('aqi'), pm25: mix('pm25') };
}

export function weatherSummary(w, run) {
  const N = 24;
  let temp = 0, rh = 0, feels = 0;
  let min = Infinity, max = -Infinity;
  let aqiSum = 0, aqiN = 0, aqiMax = -Infinity, pm = 0, pmN = 0;
  for (let i = 0; i <= N; i++) {
    const s = weatherAt(w, run.startTime + (run.stats.duration * i) / N);
    temp += s.temp / (N + 1);
    rh += s.rh / (N + 1);
    feels += s.feels / (N + 1);
    min = Math.min(min, s.temp);
    max = Math.max(max, s.temp);
    if (s.aqi != null) {
      aqiSum += s.aqi;
      aqiN++;
      aqiMax = Math.max(aqiMax, s.aqi);
    }
    if (s.pm25 != null) {
      pm += s.pm25;
      pmN++;
    }
  }
  return {
    temp, rh, feels, min, max,
    aqi: aqiN ? aqiSum / aqiN : null,
    aqiMax: aqiN ? aqiMax : null,
    pm25: pmN ? pm / pmN : null,
  };
}
