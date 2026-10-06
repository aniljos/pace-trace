import { ZONES } from './hr.js';
import { formatDuration, formatPace } from './format.js';

// "What this means" notes for each report section. Every note says what the measure is, how to read it,
// and what it implies for this particular run. Each returns an array of { lead, text } paragraphs.

const ZONE_MEANING = {
  1: 'a very easy effort, like warming up or recovering',
  2: 'comfortable aerobic running, where you could hold a conversation',
  3: 'a steady, moderately hard effort',
  4: 'a hard effort close to your threshold, which most people can hold for 20 to 60 minutes',
  5: 'a near-maximal effort that is only sustainable in short bursts',
};

const diffText = (secPerUnit) => `${Math.floor(Math.abs(secPerUnit) / 60)}:${String(Math.round(Math.abs(secPerUnit) % 60)).padStart(2, '0')}`;

export function buildNotes({ run, units, unitMeters, fadeM, fadeE, splitsM, splitsE, drift, kmDrift, zones, maxHr, maxHrEstimated, intervals, zonesMode }) {
  const unit = units === 'mi' ? 'mile' : 'km';
  const notes = {};
  const pace = (v) => `${formatPace(v, units, false)} /${units}`;

  // ---------- page 1: route colours, pacing, consistency, drift ----------
  const p1 = [];
  const trend = fadeM?.verdict.label;
  if (fadeM) {
    const diffSec = Math.abs(unitMeters / fadeM.second - unitMeters / fadeM.first);
    const meaning = {
      'Negative split': 'You ran the second half faster than the first. This usually means the early pace was comfortable and you had energy left.',
      'Even split': 'Your two halves were within 1% of each other, which is a very evenly paced run.',
      'Slight fade': 'The second half was a little slower than the first (by under 4%), which is common over longer distances.',
      Faded: `The second half was ${Math.abs(fadeM.halfPct).toFixed(0)}% (${diffText(diffSec)} per ${unit}) slower than the first. A fade of this size is often linked to starting faster than you can sustain, tiredness, heat, or stopping.`,
    }[fadeM.verdict.label];
    const colours = zonesMode
      ? ''
      : trend === 'Faded' || trend === 'Slight fade'
        ? ' On the map, the route shifts from greener to redder along the way.'
        : trend === 'Negative split'
          ? ' On the map, the route shifts from redder to greener along the way.'
          : '';
    p1.push({ lead: `Pacing: ${fadeM.verdict.label}.`, text: meaning + colours });
    if (fadeM.consistency) {
      p1.push({
        lead: `Consistency: ${fadeM.consistency} (±${fadeM.cv.toFixed(1)}%).`,
        text: `This shows how much your ${unit}-by-${unit} paces differed from your average, by about ${fadeM.cv.toFixed(1)}% on average. Under 3% is very even, 3 to 6% steady, 6 to 10% variable and over 10% very uneven. Stops, hills and walking breaks all push the number up.`,
      });
    }
  }
  if (drift) {
    p1.push({
      lead: `Heart-rate drift: ${drift.decoupling.toFixed(1)}% (${drift.verdict.label.toLowerCase()}).`,
      text: 'This compares how fast you ran per heartbeat in the second half with the first. Under 5% is normal for a steady aerobic run; more suggests heat, dehydration, fatigue or a pace that was too hard.',
    });
  }
  notes.page1 = p1;

  // ---------- charts ----------
  const ch = [
    {
      lead: 'Reading the charts.',
      text: 'Each chart follows the run from start to finish. Pace is drawn with faster at the top. Heart rate rising while pace holds or falls points to fatigue or heat. Elevation helps explain pace changes on hills. Temperature, humidity and air quality are modelled for the area, so they show the trend rather than exact readings on your route.',
    },
  ];
  if (drift) {
    const sp = drift.speedChangePct;
    if (sp <= -3 && Math.abs(drift.hrChange) < 4) ch.push({ lead: 'In this run,', text: 'pace falls through the second half while heart rate stays level, which suggests you slowed down rather than your heart working harder.' });
    else if (drift.hrChange > 4 && Math.abs(sp) < 3) ch.push({ lead: 'In this run,', text: 'heart rate climbs while pace stays steady, the classic sign of cardiac drift from heat, dehydration or fatigue.' });
    else if (drift.hrChange > 4) ch.push({ lead: 'In this run,', text: 'heart rate rises while pace falls, which points to fatigue, heat, or a start that was too fast.' });
  }
  notes.charts = ch;

  // ---------- heart-rate zones ----------
  if (zones?.total && maxHr) {
    const idx = zones.ms.indexOf(Math.max(...zones.ms));
    const share = Math.round((zones.ms[idx] / zones.total) * 100);
    const z = [
      {
        lead: 'What zones are.',
        text: `Zones split your heart rate into five bands of effort, as a share of your maximum heart rate (set here to ${maxHr} bpm). Zones 1 and 2 are easy aerobic running, zone 3 is steady, zone 4 is hard, and zone 5 is close to maximum. The time in each zone shows how hard the run was overall.`,
      },
      { lead: 'In this run,', text: `${share}% of the time was in zone ${ZONES[idx].id} (${ZONES[idx].name}), ${ZONE_MEANING[ZONES[idx].id]}.` },
    ];
    if (maxHrEstimated) z.push({ lead: 'Accuracy.', text: 'The maximum heart rate here is only an estimate (the highest reading in this file). If your true maximum is higher, the zones will read harder than they really were. You can enter it in the Max HR box in the app.' });
    notes.zones = z;
  }

  // ---------- heart-rate drift ----------
  if (drift) {
    notes.drift = [
      {
        lead: 'What drift is.',
        text: `Drift (also called aerobic decoupling) compares your speed per heartbeat in the first half with the second half, using moving time only. Under 3% is excellent, 3 to 5% good, 5 to 8% moderate and above 8% high. A small drift means your heart rate stayed in step with your pace.`,
      },
      {
        lead: 'In this run,',
        text: `you ran ${pace(drift.first.speed)} at ${Math.round(drift.first.hr)} bpm in the first half and ${pace(drift.second.speed)} at ${Math.round(drift.second.hr)} bpm in the second, giving ${drift.decoupling.toFixed(1)}% (${drift.verdict.label.toLowerCase()}). ${drift.verdict.note} Heat, hills, hydration and interval training all affect drift, so treat it as a guide.`,
      },
    ];
  }

  // ---------- drift by km ----------
  if (kmDrift) {
    const last = kmDrift.rows[kmDrift.rows.length - 1];
    notes.kmDrift = [
      {
        lead: `How to read it.`,
        text: `Each ${unit} is compared with an early baseline (${kmDrift.baseLabel}, after the warm-up) using efficiency, which is speed per heartbeat. A red bar means you were less efficient than at the start; a bar above 5% marks a ${unit} where tiredness, heat or dehydration was starting to show. Grey bars mean you were more efficient than the baseline. Climbs raise heart rate without meaning fatigue, so check the elevation column.`,
      },
      {
        lead: 'In this run,',
        text: `${kmDrift.onset ? `efficiency first dropped by 5% or more at ${unit} ${kmDrift.onset.n} and stayed lower after that` : 'efficiency stayed close to the baseline until the end'}, and the last ${unit}${kmDrift.rows.length > 1 ? '' : ''} was ${Math.abs(last.drift).toFixed(0)}% ${last.drift >= 0 ? 'less' : 'more'} efficient than the baseline.`,
      },
    ];
  }

  // ---------- splits & fade ----------
  if (fadeM && splitsM?.length) {
    const s = [
      {
        lead: 'Moving vs elapsed pace.',
        text: `Moving pace leaves out time you spent stopped (traffic lights, water breaks), so it shows how fast you actually ran. Elapsed pace counts everything, as on a clock. When the two differ in a ${unit}, you stopped during it.`,
      },
      {
        lead: 'Fade.',
        text: `The halves and the last-versus-first quarter show whether you slowed down. A positive change in the last quarter means you finished faster than you started. Consistency is the typical ${unit}-to-${unit} swing in pace.`,
      },
    ];
    const stopped = splitsM.filter((x) => x.stoppedMs > 5000).sort((a, b) => b.stoppedMs - a.stoppedMs)[0];
    const e = stopped && splitsE?.find((x) => x.n === stopped.n);
    if (stopped && e) {
      s.push({ lead: 'In this run,', text: `${unit} ${stopped.n} reads ${formatPace(stopped.speed, units, false)} on moving pace but ${formatPace(e.speed, units, false)} on elapsed pace, because of ${formatDuration(stopped.stoppedMs)} stopped.${fadeE && fadeM.verdict.label !== fadeE.verdict.label ? ` Stops also change the overall verdict: ${fadeM.verdict.label.toLowerCase()} on moving pace, ${fadeE.verdict.label.toLowerCase()} on elapsed pace.` : ''}` });
    }
    notes.splits = s;
  }

  // ---------- intervals ----------
  if (intervals) {
    const sm = intervals.summary;
    notes.intervals = [
      {
        lead: 'What this shows.',
        text: 'The report looks for repeated hard efforts separated by easier recovery. Steady pace across the efforts shows good control; pace falling off, or heart rate climbing from one effort to the next, suggests building fatigue. A heart rate that drops well during each recovery is a sign of good fitness.',
      },
      {
        lead: 'In this run,',
        text: `pace changed ${Math.abs(sm.speedChangePct).toFixed(1)}% ${sm.speedChangePct < 0 ? 'slower' : 'faster'} from the first effort to the last${sm.hrFirst != null ? `, while average heart rate went from ${Math.round(sm.hrFirst)} to ${Math.round(sm.hrLast)} bpm` : ''}.`,
      },
    ];
  } else {
    notes.intervals = [{ lead: 'What this shows.', text: 'Intervals are found by looking for at least three hard efforts that stand out from your normal pace. None were found, so this reads as a steady run rather than a structured session.' }];
  }

  return notes;
}
