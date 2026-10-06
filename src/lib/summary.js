import { ZONES } from './hr.js';
import { aqiCategory, formatDistance, formatDuration, formatElevation, formatPace, formatTemp } from './format.js';
import { weatherAt } from './weather.js';

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const list = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

// Plain-English summary of a run, written from the same numbers the report shows.
// Returns { sections: [{ title, text }], pointers: [string] }
export function buildSummary({ run, units, tempUnit, unitMeters, splits, fade, wx, hrOk, drift, kmDrift, zones, maxHr, intervals }) {
  const unit = units === 'mi' ? 'mile' : 'km';
  const per = `/${units}`;
  const pace = (v) => `${formatPace(v, units, false)} ${per}`;
  const st = run.stats;
  const stoppedMs = Math.max(0, st.duration - st.movingTime);
  const pointers = [];

  // ---- 1. basics ----
  const d = new Date(run.startTime);
  const when = `${d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  let basics = `On ${when} you covered ${formatDistance(st.distance, units)} in ${formatDuration(st.duration)}`;
  if (stoppedMs > 30000) basics += ` (${formatDuration(st.movingTime)} of it moving)`;
  basics += `, at an average moving pace of ${pace(st.avgSpeed)}`;
  basics += st.elevGain != null ? `, with ${formatElevation(st.elevGain, units)} of climbing.` : '.';

  // ---- 2. pace story ----
  const full = splits.filter((s) => s.full);
  const paceBits = [];
  let onset = null;
  if (fade && full.length >= 6) {
    const third = Math.max(2, Math.floor(full.length / 3));
    const baseSpeed = median(full.slice(0, third).map((s) => s.speed));
    for (let i = third; i < full.length - 1; i++) {
      const tail = full.slice(i);
      const tailSpeed = tail.reduce((a, s) => a + s.meters, 0) / (tail.reduce((a, s) => a + s.movingMs, 0) / 1000);
      const next3 = mean(full.slice(i, i + 3).map((s) => s.speed));
      if (tailSpeed < baseSpeed * 0.95 && next3 < baseSpeed * 0.95) {
        onset = { split: full[i], baseSpeed, tailSpeed };
        break;
      }
    }
  }
  if (fade) {
    const diffSec = Math.abs(unitMeters / fade.second - unitMeters / fade.first);
    const diffTxt = `${Math.floor(diffSec / 60)}:${String(Math.round(diffSec % 60)).padStart(2, '0')}`;
    if (onset) {
      paceBits.push(`You held about ${pace(onset.baseSpeed)} for the first ${onset.split.n - 1} ${units === 'mi' ? 'miles' : 'km'}, then slowed to about ${pace(onset.tailSpeed)} for the rest.`);
    }
    if (fade.verdict.label === 'Negative split') {
      paceBits.push(`The second half was faster than the first (${pace(fade.second)} against ${pace(fade.first)}), a negative split.`);
    } else if (fade.verdict.label === 'Even split') {
      paceBits.push(`Pace was even from start to finish (${pace(fade.first)} in the first half, ${pace(fade.second)} in the second).`);
    } else {
      paceBits.push(`The second half averaged ${pace(fade.second)} against ${pace(fade.first)} in the first half (${diffTxt} per ${unit} slower), and the last quarter was about ${Math.abs(fade.fadePct).toFixed(0)}% slower than the first.`);
    }
    if (fade.fastest) paceBits.push(`The fastest ${unit} was ${unit} ${fade.fastest.n} (${pace(fade.fastest.speed)}) and the slowest was ${unit} ${fade.slowest.n} (${pace(fade.slowest.speed)}).`);
    if (fade.consistency) {
      const word = { 'Very even': 'was very even', Steady: 'was steady', Variable: 'varied', 'Very uneven': 'varied a lot' }[fade.consistency];
      paceBits.push(`Pace ${word} from ${unit} to ${unit} (about ±${fade.cv.toFixed(1)}%).`);
    }
  }
  if (run.stops.length && stoppedMs > 30000) {
    paceBits.push(`There ${run.stops.length === 1 ? 'was 1 stop' : `were ${run.stops.length} stops`} totalling ${formatDuration(stoppedMs)}, the longest ${formatDuration(Math.max(...run.stops.map((x) => x.dur)))}.`);
  }

  // ---- 3. effort ----
  const effort = [];
  if (st.avgHr != null) {
    let s = `Average heart rate was ${Math.round(st.avgHr)} bpm (max ${Math.round(st.maxHr)})`;
    if (hrOk && zones?.total) {
      const ranked = ZONES.map((z, i) => ({ z, share: zones.ms[i] / zones.total })).sort((a, b) => b.share - a.share);
      const [a, b] = ranked;
      const fmt = (r) => `zone ${r.z.id} (${r.z.name}, ${Math.round(r.share * 100)}%)`;
      s += `, with most of the time in ${a.share + b.share >= 0.7 && b.share >= 0.1 ? `${fmt(a)} and ${fmt(b)}` : fmt(a)} based on a max heart rate of ${maxHr} bpm.`;
    } else s += '.';
    effort.push(s);
  }
  if (drift) {
    const sp = drift.speedChangePct;
    const spTxt = sp <= -1 ? `your speed fell ${Math.abs(sp).toFixed(0)}%` : sp >= 1 ? `your speed rose ${sp.toFixed(0)}%` : 'your speed held steady';
    effort.push(`Heart rate went from ${Math.round(drift.first.hr)} to ${Math.round(drift.second.hr)} bpm between the first and second half while ${spTxt}, a drift of ${drift.decoupling.toFixed(1)}% (${drift.verdict.label.toLowerCase()}). ${drift.verdict.note}`);
  }
  if (kmDrift?.onset) effort.push(`Efficiency (speed per heartbeat) first dropped by 5% or more at ${unit} ${kmDrift.onset.n} and stayed lower after that.`);
  if (intervals) {
    const sm = intervals.summary;
    const typical = sm.basis === 'time' ? formatDuration(Math.round(sm.avgMs / 15000) * 15000) : formatDistance(Math.round(sm.avgDist / 50) * 50, units);
    effort.push(`The run contained ${sm.count} repeated efforts of about ${typical} at ${pace(sm.avgSpeed)} on average, with speed changing ${Math.abs(sm.speedChangePct).toFixed(1)}% ${sm.speedChangePct < 0 ? 'slower' : 'faster'} from the first to the last effort.`);
  }

  // ---- 4. conditions ----
  const conditions = [];
  let heat = null;
  let aqi = null;
  if (wx) {
    const a = weatherAt(wx, run.startTime);
    const b = weatherAt(wx, run.startTime + st.duration);
    const trend = (x, y, up, down, tol) => (y > x + tol ? up : y < x - tol ? down : 'staying near');
    conditions.push(`It was ${formatTemp(a.temp, tempUnit)} at the start, ${trend(a.temp, b.temp, 'rising to', 'falling to', 1)} ${formatTemp(b.temp, tempUnit)} by the end, with humidity ${trend(a.rh, b.rh, 'rising to', 'falling to', 3)} ${Math.round(b.rh)}% (from ${Math.round(a.rh)}%).`);
    heat = Math.max(a.feels, b.feels);
    if (a.aqi != null) {
      const avgAqi = (a.aqi + b.aqi) / 2;
      aqi = { value: avgAqi, cat: aqiCategory(avgAqi) };
      conditions.push(`Air quality averaged AQI ${Math.round(avgAqi)} (${aqi.cat.label.toLowerCase()}).`);
    }
    conditions.push('Weather and air quality are modelled for the area, not measured on your route.');
  }

  // ---- pointers ("Worth a look"): only what stands out ----
  if (onset) {
    pointers.push(`The slowdown from about ${unit} ${onset.split.n}: it could be fatigue, heat, fuelling or walk breaks. The data can't say which.`);
  } else if (fade && (fade.verdict.label === 'Faded' || fade.verdict.label === 'Slight fade')) {
    pointers.push('Pace eased through the run rather than at one clear point; the splits table shows where it changed most.');
  }
  if (drift && drift.decoupling >= 5) {
    pointers.push(`Heart-rate drift of ${drift.decoupling.toFixed(1)}% is above the 5% usually seen on steady aerobic runs. Heat, hydration, fuelling and starting pace are common contributors.`);
  }
  if (aqi && aqi.value >= 101) pointers.push(`Air quality was ${aqi.cat.label.toLowerCase()} (AQI ${Math.round(aqi.value)}), which can make the effort feel harder, especially for people sensitive to air pollution.`);
  if (heat != null && heat >= 29) pointers.push(`It felt warm (up to ${formatTemp(heat, tempUnit)}); warm, humid conditions usually raise heart rate and slow pace.`);
  if (stoppedMs > st.duration * 0.04 && stoppedMs > 60000) pointers.push(`Stops made up ${Math.round((stoppedMs / st.duration) * 100)}% of the elapsed time. The moving pace figures leave them out.`);
  if (fade?.cv != null && fade.cv >= 10) pointers.push('Pace varied a lot between splits. Stops, hills or run/walk sections can all cause this.');
  if (fade?.verdict.label === 'Negative split' && (!drift || drift.decoupling < 5)) pointers.push('A faster second half with little drift suggests the early pace was comfortable.');

  const sections = [{ title: 'The run', text: basics }];
  if (paceBits.length) sections.push({ title: 'How the run unfolded', text: paceBits.join(' ') });
  if (effort.length) sections.push({ title: 'Effort', text: effort.join(' ') });
  if (conditions.length) sections.push({ title: 'Conditions', text: conditions.join(' ') });

  return { sections, pointers: pointers.length ? pointers.slice(0, 3) : ['Nothing stands out: the run looks steady.'] };
}
