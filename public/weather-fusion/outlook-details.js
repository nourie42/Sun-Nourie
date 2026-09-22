import {dailyDisplay,finite} from './weather-math.js?v=full-day-rain-v1';
import {conditionForRainChance} from './weather-state.js?v=weather-qa-v67';
import {forecastPeriodSummary} from './forecast-story.js?v=weather-qa-v67';

const HOUR = 3600000;
const chanceOf = row => {
  const value = row?.rainLikelihood?.value;
  if (finite(value) && value >= 0 && value <= 100) return value;
  return finite(row?.pop) && row.pop >= 0 && row.pop <= 100 ? row.pop : null;
};

function friendlyCondition(value) {
  const text = String(value || '').trim().replace(/\s+/g,' ');
  if (!text) return 'Forecast details are still filling in';
  const lower = text.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function dayName(day,index,zone) {
  if (index === 0) return 'Today';
  if (day?.label && !/^day\s*\d+$/i.test(day.label)) return day.label;
  const stamp = Date.parse(`${day?.date || ''}T12:00:00Z`);
  return Number.isFinite(stamp)
    ? new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'long'}).format(new Date(stamp))
    : `Day ${index + 1}`;
}

function timeLabel(value,zone) {
  return new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'})
    .format(new Date(value)).replace(':00','');
}

function localDayKey(value,zone) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'})
    .format(new Date(value));
}

function weekday(value,zone) {
  return new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'long'}).format(new Date(value));
}

function strongestGroup(groups=[]) {
  if (!groups.length) return null;
  return [...groups].sort((a,b) => {
    const peak = group => Math.max(...group.map(chanceOf).filter(finite),-1);
    return peak(b)-peak(a) || b.length-a.length || Date.parse(a[0].time)-Date.parse(b[0].time);
  })[0];
}

function timingText(group,zone) {
  if (!group?.length) return '';
  const start = Date.parse(group[0].time);
  const last = group.at(-1);
  const parsedEnd = Date.parse(last?.end);
  const end = Number.isFinite(parsedEnd) ? parsedEnd : Date.parse(last.time) + HOUR;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '';
  if (localDayKey(start,zone) === localDayKey(end-1,zone)) return `${timeLabel(start,zone)} to ${timeLabel(end,zone)}`;
  return `${weekday(start,zone)} ${timeLabel(start,zone)} to ${weekday(end-1,zone)} ${timeLabel(end,zone)}`;
}

function rainText(story,zone) {
  const chance = story?.chance;
  const group = strongestGroup(story?.groups);
  const timing = timingText(group,zone);
  if (!finite(chance)) {
    return timing ? `Rain timing currently points to ${timing}, but the overall chance is not available yet.` : 'Rain chance is not available yet.';
  }
  const rounded = Math.round(chance);
  if (rounded === 0) return 'No rain is expected.';
  if (rounded < 25) return `Only a small rain chance: ${rounded}%.`;
  let text = `Rain chance: ${rounded}%.`;
  text += timing ? ` Best window: ${timing}.` : ' The exact timing is still unclear.';
  if (finite(story.amount) && story.amount >= 0.02) {
    const amount = story.amount.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
    text += ` Forecast rain amount: about ${amount} in.`;
  }
  return text;
}

function tempText(day,phase) {
  if (phase === 'overnight') return finite(day?.low) ? `Low around ${Math.round(day.low)}°.` : '';
  if (phase === 'daytime') return finite(day?.high) ? `High near ${Math.round(day.high)}°.` : '';
  if (finite(day?.high) && finite(day?.low)) return `High near ${Math.round(day.high)}°, low around ${Math.round(day.low)}°.`;
  if (finite(day?.high)) return `High near ${Math.round(day.high)}°.`;
  if (finite(day?.low)) return `Low around ${Math.round(day.low)}°.`;
  return '';
}

function conditionsText(forecast,index,phase,now) {
  const day = forecast?.days?.[index] || {};
  if (phase === 'daytime') {
    const chance = forecastPeriodSummary(forecast,index,'daytime',now).chance;
    return `${friendlyCondition(conditionForRainChance(day.condition || '',chance))}.`;
  }
  if (phase === 'overnight') {
    const chance = forecastPeriodSummary(forecast,index,'overnight',now).chance;
    return `${friendlyCondition(conditionForRainChance(day.nightCondition || day.condition || '',chance))}.`;
  }
  const dayChance = forecastPeriodSummary(forecast,index,'daytime',now).chance;
  const nightChance = forecastPeriodSummary(forecast,index,'overnight',now).chance;
  const daytime = friendlyCondition(conditionForRainChance(day.condition || '',dayChance));
  const nighttime = friendlyCondition(conditionForRainChance(day.nightCondition || day.condition || '',nightChance));
  if (daytime.toLowerCase() === nighttime.toLowerCase()) return `${daytime}.`;
  return `${daytime} during the day, then ${nighttime.toLowerCase()} at night.`;
}

function periodText(forecast,index,phase,now) {
  const day = forecast?.days?.[index] || {};
  const story = forecastPeriodSummary(forecast,index,phase,now);
  const zone = forecast?.location?.timeZone || 'America/New_York';
  return [conditionsText(forecast,index,phase,now),tempText(day,phase),rainText(story,zone)].filter(Boolean).join(' ');
}

export function forecastOutlookDetails(forecast,now=Date.now()) {
  const days = forecast?.days || [];
  if (!days.length) return {summary:'',nearTerm:'',extended:''};
  const zone = forecast?.location?.timeZone || 'America/New_York';
  const display = dailyDisplay(days[0],0,now,zone);
  const summaryPhase = display.tonight ? 'overnight' : 'daytime';
  const summary = periodText(forecast,0,summaryPhase,now);

  const tonight = periodText(forecast,0,'overnight',now);
  const tomorrow = days[1] ? periodText(forecast,1,'overall',now) : '';
  const tomorrowLabel = days[1] ? dayName(days[1],1,zone) : 'Tomorrow';
  const nearTerm = [
    tonight ? `Tonight: ${tonight}` : '',
    tomorrow ? `${tomorrowLabel}: ${tomorrow}` : '',
  ].filter(Boolean).join('\n');

  const extended = days.slice(1,7).map((day,offset) => {
    const index = offset + 1;
    return `${dayName(day,index,zone)}: ${periodText(forecast,index,'overall',now)}`;
  }).join('\n');

  return {summary,nearTerm,extended};
}
