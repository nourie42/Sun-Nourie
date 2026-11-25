import {weatherState} from '../../weather-state.js?v=current-rain-20261017-v3';

const HOUR = 3600000;
const WIDTH = 360, LEFT = 43, RIGHT = 38;
const percent = value => Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const windSpeed = value => Number.isFinite(value) && value >= 0 ? value : null;
const metrics = [
  {id:'temperature',label:'Temperature',color:'#ffd394'},
  {id:'dewpoint',label:'Dew point',color:'#d1b8ff'},
  {id:'rain',label:'Rain chance',color:'#79d1ef'},
  {id:'cloud',label:'Cloud cover',color:'#e0dbff'},
  {id:'wind',label:'Wind',color:'#a6efd3'}
];

/** Compact Today chart. Every plotted point is an hourly forecast. */
export function todayHourlyPreview(hours, timeZone, useCelsius = false) {
  const readings = hours.map(hour => ({
    time: Date.parse(hour.time),
    temperature: temperatureFor(hour, useCelsius),
    dewpoint: fromFahrenheit(hour.forecastDewPointF,useCelsius),
    rain: percent(hour.rainChance),
    cloud: percent(hour.forecastCloudCover),
    wind: windSpeed(hour.forecastWindMph)
  })).filter(hour => Number.isFinite(hour.time));
  const available = metrics.filter(({id}) => readings.some(hour => hour[id] !== null));
  if (!available.length) {
    return '<section class="beta-today-hourly" id="today-hourly"><span class="beta-hourly-preview-heading">Hourly forecast</span><span>Hourly forecast unavailable.</span></section>';
  }

  const width = WIDTH, left = LEFT, right = RIGHT, top = 12, tempFloor = 69, percentFloor = 112;
  const windFloor = 166, windHeight = 32, percentHeight = 29;
  const byId = Object.fromEntries(available.map(metric => [metric.id,metric]));
  const height = byId.wind ? 194 : 140;
  const temperatures = readings.flatMap(hour => [hour.temperature,hour.dewpoint]).filter(Number.isFinite);
  const actualHigh = temperatures.length ? Math.max(...temperatures) : 0;
  const actualLow = temperatures.length ? Math.min(...temperatures) : 0;
  const step = Math.max(2, Math.ceil((actualHigh - actualLow) / 4));
  const min = Math.floor((actualLow - 1) / step) * step;
  const max = Math.max(min + 2 * step, Math.ceil((actualHigh + 1) / step) * step);
  const maxWind = Math.max(5, Math.ceil(Math.max(...readings.map(hour => hour.wind ?? 0)) / 5) * 5);
  const x = timePosition(readings.map(hour => hour.time));
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
      const cx = x(hour.time).toFixed(1), cy = y(value).toFixed(1);
      path += `${adjacent ? 'L' : 'M'}${cx},${cy} `;
      dots += `<circle data-hour-point="${index}" class="${showDots || isolated ? 'today-point' : 'today-point today-point-muted'}" cx="${cx}" cy="${cy}" r="2.15" fill="${byId[id].color}"/>`;
      previous = hour;
    }
    return `<g data-today-series="${id}"><path d="${path}" fill="none" stroke="${byId[id].color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>${dots}</g>`;
  };
  const axis = (value, y, side = 'left') => `
    <line x1="${left}" x2="${width-right}" y1="${y}" y2="${y}"/>
    <text x="${side==='left'?left-7:width-right+7}" y="${y+4}" text-anchor="${side==='left'?'end':'start'}">${value}</text>`;
  const barWidth = Math.min(11, (WIDTH - LEFT - RIGHT) / readings.length * .6);
  const bars = readings.filter(hour => hour.rain > 0).map(hour => `
    <rect x="${x(hour.time)-barWidth/2}" y="${yPercent(hour.rain)}" width="${barWidth}" height="${percentFloor-yPercent(hour.rain)}" rx="2" fill="${byId.rain.color}"/>`).join('');
  const time = new Intl.DateTimeFormat('en-US',{timeZone,hour:'numeric'});
  const ticks = [readings[0]];
  for (const hour of readings.slice(1, -1)) {
    if (x(hour.time) - x(ticks.at(-1).time) >= 55 && x(readings.at(-1).time) - x(hour.time) >= 55) ticks.push(hour);
  }
  if (readings.length > 1) ticks.push(readings.at(-1));
  const labels = ticks.map(hour => `<text x="${x(hour.time)}" y="${height-8}" text-anchor="middle">${time.format(hour.time)}</text>`).join('');
  const percentScale = byId.rain || byId.cloud ? axis('100%',yPercent(100),'right') + axis('0%',yPercent(0),'right') : '';
  return `<section class="beta-today-hourly" id="today-hourly">
    <span class="beta-hourly-preview-head">
      <strong class="beta-hourly-preview-heading">Hourly forecast</strong>
      <span class="beta-hourly-preview-legend">${available.map(({id,label,color})=>`<span data-metric="${id}" style="--series-color:${color}">${label}</span>`).join('')}</span>
    </span>
    <svg class="beta-today-hourly-svg" viewBox="0 0 ${width} ${height}" role="slider" tabindex="0" aria-label="Select a forecast hour" aria-valuemin="1" aria-valuemax="${readings.length}" aria-valuenow="1">
      ${temperatures.length ? axis(min+'°',yTemp(min)) + axis(max+'°',yTemp(max)) : ''}
      ${byId.temperature ? line('temperature',yTemp,'',true) : ''}
      ${byId.dewpoint ? line('dewpoint',yTemp,'6 3') : ''}
      ${percentScale}<g data-today-series="rain">${bars}</g>
      ${byId.cloud ? line('cloud',yPercent,'3 4') : ''}
      ${byId.wind ? axis(maxWind+' mph',yWind(maxWind)) + axis('0',yWind(0)) + line('wind',yWind) : ''}
      ${labels}<line class="today-hour-cursor" y1="7" y2="${height-21}" hidden/>
    </svg>
    <div class="today-hour-controls" role="group" aria-label="Browse forecast hours">
      <button type="button" data-hour-step="-1" aria-label="Previous forecast hour" disabled>‹</button>
      <span class="today-hour-label">Tap the chart or use the arrows</span>
      <button type="button" data-hour-step="1" aria-label="Next forecast hour">›</button>
    </div>
    <div class="today-hour-details" aria-live="polite" hidden></div>
  </section>`;
}

function fromFahrenheit(value,useCelsius) {
  return Number.isFinite(value) ? (useCelsius ? (value-32)*5/9 : value) : null;
}

function temperatureFor(hour, useCelsius) {
  const value = Object.hasOwn(hour,'forecastTempF') ? hour.forecastTempF : hour.tempF;
  return fromFahrenheit(value,useCelsius);
}

function timePosition(times) {
  const first = times[0], span = times.at(-1)-first, width = WIDTH-LEFT-RIGHT;
  return time => LEFT + (span > 0 ? (time-first)*width/span : width/2);
}

export function bindTodayHourPicker(host, hours, {timeZone, useCelsius, selectedTime, onSelect}) {
  const svg = host.querySelector('.beta-today-hourly-svg');
  if (!svg) return;
  const points = hours.filter(hour=>Number.isFinite(Date.parse(hour.time)));
  const times = points.map(hour=>Date.parse(hour.time));
  const cursor = svg.querySelector('.today-hour-cursor');
  const details = host.querySelector('.today-hour-details');
  const stepBack = host.querySelector('[data-hour-step="-1"]');
  const stepForward = host.querySelector('[data-hour-step="1"]');
  const hourLabel = host.querySelector('.today-hour-label');
  const date = new Intl.DateTimeFormat('en-US',{timeZone,hour:'numeric',minute:'2-digit',timeZoneName:'short'});
  const x = timePosition(times);
  let index = -1;
  const reading = (value,suffix) => Number.isFinite(value) ? Math.round(value)+suffix : '—';

  function select(i) {
    index = Math.max(0,Math.min(i,points.length-1));
    const hour = points[index];
    const clock = date.format(times[index]);
    const condition = hour.forecastCondition || 'Sky conditions unavailable';
    const values = [
      ['Temperature',reading(temperatureFor(hour,useCelsius),'°')],
      ['Feels like',reading(fromFahrenheit(hour.forecastFeelsLikeF,useCelsius),'°')],
      ['Dew point',reading(fromFahrenheit(hour.forecastDewPointF,useCelsius),'°')],
      ['Humidity',reading(percent(hour.forecastHumidity),'%')],
      ['Cloud cover',reading(percent(hour.forecastCloudCover),'%')],
      ['Wind',reading(windSpeed(hour.forecastWindMph),' mph')],
      ['Rain chance',reading(percent(hour.rainChance),'%')],
      ['Rainfall',Number.isFinite(hour.precipIn) ? hour.precipIn.toFixed(2)+'″' : '—']
    ];
    hourLabel.textContent = clock;
    stepBack.disabled = index === 0;
    stepForward.disabled = index === points.length-1;
    svg.setAttribute('aria-valuenow',index+1);
    svg.setAttribute('aria-valuetext',clock);
    cursor.setAttribute('x1',x(times[index]));
    cursor.setAttribute('x2',x(times[index]));
    cursor.removeAttribute('hidden');
    const title = document.createElement('strong');
    svg.querySelectorAll('.today-point-selected').forEach(dot=>dot.classList.remove('today-point-selected'));
    svg.querySelectorAll(`[data-hour-point="${index}"]`).forEach(dot=>dot.classList.add('today-point-selected'));
    title.textContent = condition;
    const list = document.createElement('dl');
    list.innerHTML = values.map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
    details.replaceChildren(title,list);
    details.hidden = false;
    onSelect(hour.time);
  }

  stepBack.onclick = () => select(index-1);
  stepForward.onclick = () => select(index+1);
  svg.setAttribute('aria-valuetext',date.format(times[0]));
  const saved = points.findIndex(hour=>hour.time===selectedTime);
  if (saved >= 0) select(saved);
  svg.addEventListener('click',event=>{
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const target = new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse()).x;
    const hourIndex = times.reduce((nearest,time,i)=>
      Math.abs(x(time)-target) < Math.abs(x(times[nearest])-target) ? i : nearest,0);
    select(hourIndex);
  });
  svg.addEventListener('keydown',event=>{
    const movement = {ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1,Home:-points.length,End:points.length,Enter:0,' ':0};
    if (!Object.hasOwn(movement,event.key)) return;
    event.preventDefault();
    select(index+movement[event.key]);
  });
}

export function todaySummary(hours, high, {observedRain = false} = {}) {
  const valid = hours.filter(hour=>hour.forecastCondition || Number.isFinite(hour.forecastCloudCover) || Number.isFinite(hour.rainChance));
  if (!valid.length) return '';
  const knownTemps = valid.map(hour=>hour.forecastTempF).filter(Number.isFinite);
  if (!Number.isFinite(high) && knownTemps.length) high = Math.max(...knownTemps);
  const temperature = !Number.isFinite(high) ? '' : high <= 32 ? 'freezing' : high < 48 ? 'cold' : high < 67 ? 'cool' : high < 78 ? 'mild' : high < 89 ? 'warm' : 'hot';
  const daylight = valid.filter(hour=>hour.isDay);
  const period = daylight.length ? 'today' : 'tonight';
  const classified = valid.map(hour=>({hour,...weatherState(hour.forecastCondition,hour.forecastCloudCover)}));
  const fraction = test => classified.filter(test).length / valid.length;
  const wet = fraction(({hour,kind,chance})=>hour.precipIn >= .01 || hour.rainChance >= 60 || kind==='rain'&&!chance);
  const wetPossible = fraction(({hour,kind})=>hour.rainChance >= 25 || kind==='rain');
  const winds = valid.map(hour=>windSpeed(hour.forecastWindMph)).filter(Number.isFinite);
  const wind = winds.length ? winds.reduce((sum,value)=>sum+value,0)/winds.length : 0;
  const andTemp = temperature ? ` and ${temperature}` : '';
  const lead = temperature ? temperature[0].toUpperCase()+temperature.slice(1)+' ' : '';
  if (fraction(row=>row.kind==='storm') >= .15) return `Thunderstorms possible ${period}`;
  if (fraction(row=>row.kind==='snow') >= .2) return `Snow in the forecast ${period}`;
  if (wet >= .5) {
    const breeze = wind >= 18 ? ', with strong winds' : wind >= 8 ? (high < 65 ? ', with a chilly breeze' : ', with a breeze') : '';
    return `Rainy${andTemp} ${period}${breeze}`;
  }
  if (wet || observedRain) return lead ? `${lead}${period} with periods of rain` : `Periods of rain ${period}`;
  if (wetPossible) return lead ? `${lead}${period} with a chance of showers` : `Showers possible ${period}`;
  const skyHours = classified.filter(row=>!daylight.length || row.hour.isDay);
  const sunny = skyHours.filter(row=>row.kind==='clear'&&(!Number.isFinite(row.hour.forecastCloudCover)||row.hour.forecastCloudCover<65)).length >= skyHours.length*.65;
  const partly = skyHours.filter(row=>row.kind==='partly-cloudy'||row.kind==='clear').length >= skyHours.length*.45;
  if (sunny) return `${daylight.length?'Sunny':'Clear'} ${period}${temperature&&high<65?' but '+temperature:temperature?', '+temperature:''}${wind>=18?' and windy':''}`;
  if (partly && daylight.length) return `Sun and clouds ${period}${temperature?', '+temperature:''}`;
  if (skyHours.some(row=>row.kind==='cloudy'||row.kind==='partly-cloudy')) return `Cloudy${andTemp} ${period}${wind>=18?', with strong winds':''}`;
  return temperature ? `${lead}${period}${wind>=18?' and windy':''}` : '';
}

const HAZARD_ORDER = ['thunderstorms','strong winds','gusty winds','heavy rain','rain','scattered showers','snow'];

function dayHazards({qpf = 0, chance = 0, wind = 0, gust = 0, snow = 0, storm = false} = {}) {
  const hazards = [];
  if (storm) hazards.push('thunderstorms');
  if (gust >= 40 || wind >= 25) hazards.push('strong winds');
  else if (gust >= 30 || wind >= 18) hazards.push('gusty winds');
  if (qpf >= .75 || (qpf >= .5 && chance >= 80)) hazards.push('heavy rain');
  else if (qpf >= .1 && chance >= 50) hazards.push('rain');
  else if (chance >= 40) hazards.push('scattered showers');
  if (snow >= .5) hazards.push('snow');
  return hazards.sort((a,b)=>HAZARD_ORDER.indexOf(a)-HAZARD_ORDER.indexOf(b));
}

const joinHazards = list => list.length < 3 ? list.join(' and ') : `${list.slice(0,-1).join(', ')} and ${list.at(-1)}`;
const capitalize = text => text[0].toUpperCase() + text.slice(1);

/** One-line headline covering today and tomorrow. Returns '' when there is nothing notable tomorrow. */
export function twoDayHeadline(today, tomorrow) {
  const first = dayHazards(today), second = dayHazards(tomorrow);
  if (!second.length) return '';
  if (!first.length) return `${capitalize(joinHazards(second))} tomorrow`;
  const shared = first.filter(hazard => second.includes(hazard));
  if (!shared.length) return `${capitalize(joinHazards(first))} today, ${joinHazards(second)} tomorrow`;
  const stormSystem = shared.includes('strong winds') && (shared.includes('heavy rain') || shared.includes('thunderstorms'));
  const base = stormSystem
    ? `Storm system will bring ${joinHazards(shared)} today and tomorrow`
    : `${capitalize(joinHazards(shared))} today and tomorrow`;
  const extras = [[first.filter(hazard => !second.includes(hazard)), 'today'], [second.filter(hazard => !first.includes(hazard)), 'tomorrow']]
    .filter(([list]) => list.length)
    .map(([list, day]) => `${joinHazards(list)} ${day}`);
  return extras.length ? `${base}, with ${extras.join(' and ')}` : base;
}
