export const KM_PER_MI = 1.609344;

export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function distanceValue(meters, units) {
  return units === 'mi' ? meters / 1000 / KM_PER_MI : meters / 1000;
}

export function formatDistance(meters, units) {
  return `${distanceValue(meters, units).toFixed(2)} ${units}`;
}

// speed in m/s -> "5:30 /km"
export function formatPace(speed, units, withUnit = true) {
  if (!speed || speed < 0.3) return withUnit ? `--:-- /${units}` : '--:--';
  const secPerUnit = (units === 'mi' ? 1609.344 : 1000) / speed;
  const m = Math.floor(secPerUnit / 60);
  const s = Math.round(secPerUnit % 60);
  const [mm, ss] = s === 60 ? [m + 1, 0] : [m, s];
  const text = `${mm}:${String(ss).padStart(2, '0')}`;
  return withUnit ? `${text} /${units}` : text;
}

export function formatElevation(m, units) {
  if (m == null) return '--';
  return units === 'mi' ? `${Math.round(m * 3.28084)} ft` : `${Math.round(m)} m`;
}

// Temperatures are stored in degrees C; tempUnit is 'C' or 'F'
export function toTemp(c, tempUnit) {
  return tempUnit === 'F' ? c * 1.8 + 32 : c;
}

export function formatTemp(c, tempUnit) {
  return c == null ? '--' : `${Math.round(toTemp(c, tempUnit))}°${tempUnit}`;
}

// US EPA AQI categories
const AQI_BANDS = [
  [50, 'Good', '#16a34a'],
  [100, 'Moderate', '#ca8a04'],
  [150, 'Unhealthy for sensitive groups', '#ea580c'],
  [200, 'Unhealthy', '#dc2626'],
  [300, 'Very unhealthy', '#9333ea'],
  [Infinity, 'Hazardous', '#7f1d1d'],
];

export function aqiCategory(aqi) {
  if (aqi == null) return null;
  const [, label, color] = AQI_BANDS.find(([max]) => aqi <= max);
  return { label, color };
}
