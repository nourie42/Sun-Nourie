const HOUR = 3600000;
const percent = value => Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const windSpeed = value => Number.isFinite(value) && value >= 0 ? value : null;
const metrics = [
  {id:'temperature',label:'Temperature',color:'#ffd394'},
  {id:'rain',label:'Rain chance',color:'#79d1ef'},
  {id:'cloud',label:'Cloud cover',color:'#e0dbff'},
  {id:'wind',label:'Wind',color:'#a6efd3'}
];

/** A non-interactive preview inside the Today button. Every plotted point is an hourly forecast. */
export function todayHourlyPreview(hours, timeZone, useCelsius = false) {
  const readings = hours.map(hour => ({
    time: Date.parse(hour.time),
    temperature: Number.isFinite(hour.tempF) ? (useCelsius ? (hour.tempF - 32) * 5 / 9 : hour.tempF) : null,
    rain: percent(hour.rainChance),
    cloud: percent(hour.forecastCloudCover),
    wind: windSpeed(hour.forecastWindMph)
  })).filter(hour => Number.isFinite(hour.time));
  const available = metrics.filter(({id}) => readings.some(hour => hour[id] !== null));
  if (!available.length) {
    return '<span class="beta-today-hourly"><span class="beta-hourly-preview-heading">Hourly forecast</span><span>Hourly forecast unavailable.</span></span>';
  }

  const width = 360, left = 43, right = 38, top = 12, tempFloor = 69, percentFloor = 112;
  const windFloor = 166, windHeight = 32, percentHeight = 29;
  const byId = Object.fromEntries(available.map(metric => [metric.id,metric]));
  const height = byId.wind ? 194 : 140;
  const chartWidth = width - left - right;
  const temperatures = readings.map(hour => hour.temperature).filter(Number.isFinite);
  const actualHigh = temperatures.length ? Math.max(...temperatures) : 0;
  const actualLow = temperatures.length ? Math.min(...temperatures) : 0;
  const step = Math.max(2, Math.ceil((actualHigh - actualLow) / 4));
  const min = Math.floor((actualLow - 1) / step) * step;
  const max = Math.max(min + 2 * step, Math.ceil((actualHigh + 1) / step) * step);
  const maxWind = Math.max(5, Math.ceil(Math.max(...readings.map(hour => hour.wind ?? 0)) / 5) * 5);
  const first = readings[0].time;
  const span = readings.at(-1).time - first;
  const x = hour => left + (span > 0 ? (hour.time - first) * chartWidth / span : chartWidth / 2);
  const yTemp = value => tempFloor - (value - min) * (tempFloor - top) / (max - min);
  const yPercent = value => percentFloor - value * percentHeight / 100;
  const yWind = value => windFloor - value * windHeight / maxWind;

  const line = (id, y, dash = '', showDots = false) => {
    let path = '', previous, dots = '';
    for (const [index, hour] of readings.entries()) {
      const value = hour[id];
      if (value === null) { previous = null; continue; }
      const adjacent = previous && hour.time - previous.time === HOUR;
      const upcoming = readings[index+1];
      const isolated = !adjacent && !(upcoming && upcoming.time - hour.time === HOUR && upcoming[id] !== null);
      const cx = x(hour).toFixed(1), cy = y(value).toFixed(1);
      path += `${adjacent ? 'L' : 'M'}${cx},${cy} `;
      if (showDots || isolated) dots += `<circle cx="${cx}" cy="${cy}" r="2.15" fill="${byId[id].color}"/>`;
      previous = hour;
    }
    return `<g data-today-series="${id}"><path d="${path}" fill="none" stroke="${byId[id].color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>${dots}</g>`;
  };
  const axis = (value, y, side = 'left') => `
    <line x1="${left}" x2="${width-right}" y1="${y}" y2="${y}"/>
    <text x="${side==='left'?left-7:width-right+7}" y="${y+4}" text-anchor="${side==='left'?'end':'start'}">${value}</text>`;
  const barWidth = Math.min(11, chartWidth / readings.length * .6);
  const bars = readings.filter(hour => hour.rain > 0).map(hour => `
    <rect x="${x(hour)-barWidth/2}" y="${yPercent(hour.rain)}" width="${barWidth}" height="${percentFloor-yPercent(hour.rain)}" rx="2" fill="${byId.rain.color}"/>`).join('');
  const time = new Intl.DateTimeFormat('en-US',{timeZone,hour:'numeric'});
  const ticks = [readings[0]];
  for (const hour of readings.slice(1, -1)) {
    if (x(hour) - x(ticks.at(-1)) >= 55 && x(readings.at(-1)) - x(hour) >= 55) ticks.push(hour);
  }
  if (readings.length > 1) ticks.push(readings.at(-1));
  const labels = ticks.map(hour => `<text x="${x(hour)}" y="${height-8}" text-anchor="middle">${time.format(hour.time)}</text>`).join('');
  const percentScale = byId.rain || byId.cloud ? axis('100%',yPercent(100),'right') + axis('0%',yPercent(0),'right') : '';
  return `<span class="beta-today-hourly">
    <span class="beta-hourly-preview-head">
      <strong class="beta-hourly-preview-heading">Hourly forecast</strong>
      <span class="beta-hourly-preview-legend">${available.map(({id,label,color})=>`<span data-metric="${id}" style="--series-color:${color}">${label}</span>`).join('')}</span>
    </span>
    <svg class="beta-today-hourly-svg" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">
      ${byId.temperature ? axis(min+'°',yTemp(min)) + axis(max+'°',yTemp(max)) + line('temperature',yTemp,'',true) : ''}
      ${percentScale}<g data-today-series="rain">${bars}</g>
      ${byId.cloud ? line('cloud',yPercent,'3 4') : ''}
      ${byId.wind ? axis(maxWind+' mph',yWind(maxWind)) + axis('0',yWind(0)) + line('wind',yWind) : ''}
      ${labels}
    </svg>
  </span>`;
}
