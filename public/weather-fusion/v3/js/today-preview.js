/** A non-interactive preview inside the Today button. Every plotted point is an hourly forecast. */
export function todayHourlyPreview(hours, timeZone, useCelsius = false) {
  const readings = hours.map(hour => ({
    time: Date.parse(hour.time),
    temperature: Number.isFinite(hour.tempF) ? (useCelsius ? (hour.tempF - 32) * 5 / 9 : hour.tempF) : null,
    rain: Number.isFinite(hour.rainChance) && hour.rainChance >= 0 && hour.rainChance <= 100 ? hour.rainChance : null
  })).filter(hour => Number.isFinite(hour.time));
  if (!readings.some(hour => hour.temperature !== null || hour.rain !== null)) {
    return '<span class="beta-today-hourly"><span class="beta-hourly-preview-heading">Hourly forecast</span><span>Hourly forecast unavailable.</span></span>';
  }

  const width = 360, height = 140, left = 32, right = 38, top = 12, tempFloor = 69, rainFloor = 112;
  const chartWidth = width - left - right;
  const temperatures = readings.map(hour => hour.temperature).filter(Number.isFinite);
  const high = temperatures.length ? Math.max(...temperatures) : 0;
  const low = temperatures.length ? Math.min(...temperatures) : 0;
  const step = Math.max(2, Math.ceil((high - low) / 4));
  const min = Math.floor((low - 1) / step) * step;
  const max = Math.max(min + 2 * step, Math.ceil((high + 1) / step) * step);
  const first = readings[0].time;
  const span = readings.at(-1).time - first;
  const x = hour => left + (span > 0 ? (hour.time - first) * chartWidth / span : chartWidth / 2);
  const y = temp => tempFloor - (temp - min) * (tempFloor - top) / (max - min);
  const dot = (hour, size) => `<circle cx="${x(hour)}" cy="${y(hour.temperature)}" r="${size}" fill="#ffe1ac"/>`;
  let path = '', previous;
  for (const hour of readings) {
    if (hour.temperature === null) { previous = null; continue; }
    const adjacent = previous && hour.time - previous.time === 3600000;
    path += `${adjacent ? 'L' : 'M'}${x(hour).toFixed(1)},${y(hour.temperature).toFixed(1)} `;
    previous = hour;
  }
  const axes = temperatures.length ? [min, max].map(temp => `
    <line x1="${left}" x2="${width-right}" y1="${y(temp)}" y2="${y(temp)}"/>
    <text x="${left-7}" y="${y(temp)+4}" text-anchor="end">${temp}°</text>`).join('') : '';
  const barWidth = Math.min(11, chartWidth / readings.length * .6);
  const bars = readings.filter(hour => hour.rain > 0).map(hour => `
    <rect x="${x(hour)-barWidth/2}" y="${rainFloor-hour.rain*.29}" width="${barWidth}" height="${hour.rain*.29}" rx="2" fill="#79d1ef"/>`).join('');
  const time = new Intl.DateTimeFormat('en-US',{timeZone,hour:'numeric'});
  const ticks = [readings[0]];
  for (const hour of readings.slice(1, -1)) {
    if (x(hour) - x(ticks.at(-1)) >= 62 && x(readings.at(-1)) - x(hour) >= 62) ticks.push(hour);
  }
  if (readings.length > 1) ticks.push(readings.at(-1));
  const labels = ticks.map(hour => `<text x="${x(hour)}" y="132" text-anchor="middle">${time.format(hour.time)}</text>`).join('');
  const rainScale = readings.some(hour => hour.rain !== null) ? `
    <line x1="${left}" x2="${width-right}" y1="${rainFloor}" y2="${rainFloor}"/>
    <text x="${width-right+8}" y="${rainFloor+4}">0%</text>
    <text x="${width-right+8}" y="${rainFloor-25}">100%</text>` : '';
  const dots = readings.filter(hour => hour.temperature !== null).map(hour => dot(hour,readings.length === 1 ? 3.8 : 2.15)).join('');
  return `<span class="beta-today-hourly">
    <span class="beta-hourly-preview-head">
      <strong class="beta-hourly-preview-heading">Hourly forecast</strong>
      <span class="beta-hourly-preview-legend"><span>Temperature</span><span>Rain chance</span></span>
    </span>
    <svg class="beta-today-hourly-svg" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">
      ${axes}${rainScale}${bars}${labels}
      <path d="${path}" fill="none" stroke="#ffd394" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${dots}
    </svg>
  </span>`;
}
