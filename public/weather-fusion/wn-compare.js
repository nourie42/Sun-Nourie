/** View-only controls for the native canonical Weather Nourie comparison. */
export const COMPARISON_DAY_LIMIT = 7;
export const COMPARISON_MODEL_IDS = Object.freeze(['nws', 'hrrr', 'nam', 'nbm', 'ecmwf', 'wn', 'gfs']);
const finite = value => typeof value === 'number' && Number.isFinite(value);

/** Source numbers and published Weather Nourie values are never recalculated. */
export function comparisonChartData(built, hiddenModels = new Set()) {
  const hidden = hiddenModels instanceof Set ? hiddenModels : new Set(hiddenModels);
  const days = (built.days || []).slice(0, COMPARISON_DAY_LIMIT);
  const series = Object.fromEntries(['nourie', ...COMPARISON_MODEL_IDS, 'single'].map(id => [id, []]));
  days.forEach((day, index) => {
    if (!built.perModel) { series.single.push(finite(built.single?.[index]) ? built.single[index] : null); return; }
    const source = { ...built.modelMaps?.[index] };
    if (!Object.hasOwn(source, 'wn')) source.wn = built.wnVals?.[index];
    series.nourie.push(finite(built.forecastValues?.[index]) ? built.forecastValues[index] : null);
    COMPARISON_MODEL_IDS.forEach(id => series[id].push(finite(source[id]) ? source[id] : null));
  });
  const ids = built.perModel ? ['nourie', ...COMPARISON_MODEL_IDS.filter(id => series[id].some(finite))] : ['single'];
  const visible = ids.filter(id => id === 'nourie' || id === 'single' || !hidden.has(id));
  return { days, series, ids, visible, values: visible.flatMap(id => series[id]).filter(finite) };
}

/** Missing model days are separate subpaths, not straight lines across gaps. */
export function comparisonLinePath(values, x, y) {
  let path = '', pen = false;
  values.forEach((value, index) => {
    if (!finite(value)) { pen = false; return; }
    path += `${pen ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
    pen = true;
  });
  return path;
}

/** A move-only SVG path is invisible, so isolated model days need a real dot. */
export function comparisonIsolatedPoints(values) {
  return values.flatMap((value,index)=>finite(value)&&!finite(values[index-1])&&!finite(values[index+1])?[{index,value}]:[]);
}

/** A fixed probability scale prevents tiny differences looking like large ones. */
export function comparisonYAxis(values, unit, variable) {
  if (unit === '%') return { lo: 0, hi: 100 };
  const readings = values.filter(finite);
  if (!readings.length) return { lo: 0, hi: 1 };
  let lo = Math.min(...readings), hi = Math.max(...readings);
  const pad = Math.max(variable === 'snow' ? .4 : unit === 'in' ? .04 : .5, (hi - lo) * .1);
  lo = unit === '' || unit === 'in' || variable === 'wind' ? 0 : lo - pad;
  hi = Math.max(lo + pad, hi + pad);
  // The native temperature/wind/UV/AQI formatters use whole numbers. Give five
  // axis ticks at least one unit each, so a calm/constant forecast stays legible.
  if(unit!=='in'){lo=Math.floor(lo);hi=Math.ceil(Math.max(lo+4,hi));}
  return { lo, hi };
}

export function comparisonDayValues(chart, index) {
  const day = Math.max(0, Math.min(chart.days.length - 1, Math.round(index)));
  return chart.visible.map(id => ({ id, value: finite(chart.series[id]?.[day]) ? chart.series[id][day] : null }));
}
