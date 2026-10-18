/** Photographic scene selection and camera layout. All coordinates are photo UVs. */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const number = (value, fallback = 0) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback;
const bounds = {
  cool: [.427, .40, .563, .91], mild: [.427, .40, .563, .91], hot: [.412, .38, .60, .92],
  cold: [.415, .385, .575, .925], 'cold-scarf': [.415, .385, .575, .925], rain: [.365, .30, .585, .925], wet: [.415, .385, .58, .925],
  snow: [.415, .385, .58, .925], night: [.415, .385, .58, .925],
  'night-cool': [.415, .385, .58, .925], 'night-mild': [.415, .385, .58, .925], 'night-hot': [.405, .38, .60, .925],
  storm: [.42, .4, .58, .92], clouds: [0, 0, 1, 1], 'park-empty': [0, 0, 1, 1], 'hot-poses-alpha': [0, 0, 1, 1], 'snow-empty': [0, 0, 1, 1]
};
export const PHOTO_SCENES = Object.freeze(Object.fromEntries(Object.entries(bounds).map(([id, personBounds]) => [id, Object.freeze({
  id, file: id === 'snow-empty' ? '../player-snow-empty.png' : id === 'clouds' ? './assets/sky-storm.webp' : id === 'hot-poses-alpha' ? './assets/photo-hot-poses-alpha.png' : `./assets/photo-${id}.webp`, sourceWidth: id === 'clouds' ? 1672 : id === 'hot-poses-alpha' ? 1881 : 1536, sourceHeight: id === 'clouds' ? 940 : id === 'hot-poses-alpha' ? 836 : 1024,
  personX: .50, personBounds: Object.freeze(personBounds),
  garment: id === 'night' || id === 'cold-scarf' ? 'cold' : id.startsWith('night-') ? id.slice(6) : id === 'wet' ? 'rain' : id,
  showPerson: !['storm','clouds','park-empty','snow-empty'].includes(id), hasUmbrella: id === 'rain', photographicNight: id === 'night' || id.startsWith('night-'), auxiliary: ['clouds','park-empty','hot-poses-alpha','snow-empty'].includes(id),
  skyShiftX: id === 'night' ? .16 : 0,
  torso: Object.freeze([.505, .575, .060, .105]), hair: Object.freeze([.536, .466, .014, .042])
})])));

export function selectPhotoScene(frame = {}, outfit = {}) {
  const code = number(frame.weatherCode, -1), wind = number(frame.windSpeed), gust = number(frame.windGust);
  const native=frame.nativePolicy===true;
  const storm = native?outfit.storm===true:Boolean(outfit.storm||[95,96,97,99].includes(code));
  const snow = !storm && (native?outfit.snow===true:Boolean(outfit.snow||[71,73,75,77,85,86].includes(code)));
  const rain = !snow && (native?outfit.rain===true:Boolean(storm||outfit.rain||[51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)||number(frame.precipitation)>0));
  const umbrella = rain && !storm && outfit.umbrella === true && wind < 28 && gust < 35;
  const temperature = number(frame.feelsLike, number(frame.temperature, 65));
  let garment = ['hot', 'mild', 'cool', 'cold'].includes(outfit.garment) ? outfit.garment : temperature >= 82 ? 'hot' : temperature < 48 ? 'cold' : temperature < 64 ? 'cool' : 'mild';
  const night = frame.isDay === false;
  let key = storm ? 'storm' : snow ? 'snow' : rain ? umbrella ? 'rain' : 'wet' : garment;
  if (key === 'cold' && outfit.scarf === true) key = 'cold-scarf';
  if (night && !storm && !snow && !rain) key = garment === 'cold' ? 'night' : `night-${garment}`;
  const knownCode = code >= 0 && code <= 99;
  const overcast = (native&&outfit.possibleRain===true) || number(frame.cloudCover, code === 3 ? 100 : 0) >= 85 || code === 3 || [45, 48].includes(code) || !knownCode || typeof frame.isDay !== 'boolean';
  const skyKey = overcast && !['rain', 'wet', 'snow', 'storm'].includes(key) ? 'clouds' : null;
  const showSun = frame.isDay === true && [0, 1].includes(code) && number(frame.cloudCover, code === 0 ? 0 : 30) < 45 && !rain && !snow && !storm;
  return {
    key, asset: PHOTO_SCENES[key], night, skyKey, gradeNight: night && !PHOTO_SCENES[key].photographicNight,
    showPerson: !storm, umbrella, precipitation: snow ? 'snow' : rain ? 'rain' : null,
    wind: clamp(Math.max(wind / 25, gust / 45), 0, 1.4), fog: [45, 48].includes(code), overcast, showSun,
    garment: PHOTO_SCENES[key].garment
  };
}

export const PHOTO_HOT_ATLAS = Object.freeze({
  file: './assets/photo-hot-poses-alpha.png', width: 1881, height: 836, columns: 3, rows: 2,
  cellWidth: 627, cellHeight: 418, framesPerSecond: 3.5,
  targetCenterX: .486, targetFeetY: .906, targetHeight: .51,
  bounds: Object.freeze([[260,34,402,407],[238,33,384,410],[261,32,411,410],[249,8,396,390],[237,11,385,393],[261,10,408,389]].map(Object.freeze)),
  footX: Object.freeze([317.29,296.95,320.87,308.24,295.90,320.14])
});

/** Preserve natural proportions and the complete head/feet, including umbrellas. */
export function computePhotoLayout({ viewportWidth, viewportHeight, sourceWidth = 1536, sourceHeight = 1024, personX = .5, subjectBounds = [.427, .40, .563, .91], margin = 6 } = {}) {
  const width = Math.max(1, number(viewportWidth, 1)), height = Math.max(1, number(viewportHeight, 1));
  const originalWidth = Math.max(1, number(sourceWidth, 1536)), originalHeight = Math.max(1, number(sourceHeight, 1024));
  const b = subjectBounds.map((value, index) => clamp(number(value, index > 1 ? 1 : 0), 0, 1));
  const safeMargin = Math.min(Math.max(0, margin), width * .05), personWidth = Math.max(.001, b[2] - b[0]);
  const scale = Math.min(height / originalHeight, Math.max(1, width - safeMargin * 2) / (personWidth * originalWidth));
  const imageWidth = originalWidth * scale, imageHeight = originalHeight * scale;
  const minLeft = safeMargin - b[0] * imageWidth, maxLeft = width - safeMargin - b[2] * imageWidth;
  const left = clamp(width * .5 - clamp(personX, 0, 1) * imageWidth, minLeft, maxLeft);
  const top = height - imageHeight;
  return {
    scale, imageWidth, imageHeight, left, top,
    uvScale: [width / imageWidth, height / imageHeight], uvOffset: [-left / imageWidth, -top / imageHeight],
    subject: { left: left + b[0] * imageWidth, top: top + b[1] * imageHeight, right: left + b[2] * imageWidth, bottom: top + b[3] * imageHeight }
  };
}

/** Every asynchronous image completion must still match the latest forecast. */
export function createLatestRequestGate() {
  let token = 0, disposed = false;
  return { next: () => ++token, isCurrent: value => !disposed && value === token, dispose: () => { disposed = true; token++; } };
}
