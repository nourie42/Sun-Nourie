/** Layered SVG condition scenes for the Remainder of Today tile. Deterministic: the same
 *  condition always draws the same picture. */

const SKY = {
  day: ['#3f8fe0', '#a9d6f7'],
  night: ['#0b1a3a', '#24447a'],
  overcast: ['#6d7787', '#3d4655'],
  dark: ['#33394f', '#161a2c'],
  storm: ['#2b3146', '#12152a'],
  snow: ['#a9bdd4', '#5f7694'],
  fog: ['#b9c2cc', '#7f8a97'],
  haze: ['#e6d4a4', '#a58f63'],
  dust: ['#d7a86e', '#7d5a3a'],
};

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function cloud(x, y, scale, opacity = 1, tone = 'light') {
  const top = tone === 'dark' ? '#c3cbd8' : '#ffffff';
  const bottom = tone === 'dark' ? '#6f7b8e' : '#c7d3e3';
  return `<g opacity="${opacity}" transform="translate(${x} ${y}) scale(${scale})">
    <path fill="url(#cloud-${tone})" d="M-44 14 Q-52 -2 -34 -6 Q-30 -26 -8 -24 Q4 -44 26 -30 Q44 -34 46 -12 Q62 -8 56 10 Q52 18 40 16 Z"/>
    <path fill="${bottom}" opacity=".35" d="M-40 14 Q0 6 50 12 L52 16 L-44 16 Z"/>
    <path fill="${top}" opacity=".18" d="M-20 -12 Q4 -36 26 -26"/>
  </g>`;
}

function sun(x, y, r, opacity = 1) {
  return `<g opacity="${opacity}">
    <circle cx="${x}" cy="${y}" r="${r * 2.6}" fill="url(#sun-glow)"/>
    <circle cx="${x}" cy="${y}" r="${r}" fill="#fff6c2"/>
    <circle cx="${x}" cy="${y}" r="${r * 0.72}" fill="#ffe36b"/>
  </g>`;
}

function moon(x, y, r) {
  return `<g>
    <circle cx="${x}" cy="${y}" r="${r * 2.4}" fill="url(#moon-glow)"/>
    <circle cx="${x}" cy="${y}" r="${r}" fill="#eef3ff"/>
    <circle cx="${x - r * 0.35}" cy="${y - r * 0.2}" r="${r * 0.2}" fill="#c9d3e8"/>
    <circle cx="${x + r * 0.3}" cy="${y + r * 0.3}" r="${r * 0.14}" fill="#c9d3e8"/>
  </g>`;
}

function stars(seed) {
  const next = rng(seed);
  return Array.from({ length: 26 }, () => {
    const x = next() * 300, y = next() * 110, r = 0.5 + next() * 1.1;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="#dbe8ff" opacity="${(0.4 + next() * 0.6).toFixed(2)}"/>`;
  }).join('');
}

function rain(seed, count, slant, color = '#cfe6ff', width = 1.3) {
  const next = rng(seed);
  return Array.from({ length: count }, () => {
    const x = next() * 320 - 10, y = next() * 180 - 20, len = 10 + next() * 9;
    return `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + slant * len * 0.35).toFixed(1)}" y2="${(y + len).toFixed(1)}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" opacity="${(0.55 + next() * 0.4).toFixed(2)}"/>`;
  }).join('');
}

function snow(seed, count, slant = 0.1) {
  const next = rng(seed);
  return Array.from({ length: count }, () => {
    const x = next() * 320 - 10, y = next() * 180 - 10, r = 1.2 + next() * 2.6;
    const dx = slant * r * 4;
    return `<g transform="translate(${(x + dx).toFixed(1)} ${y.toFixed(1)})"><circle r="${r.toFixed(2)}" fill="#ffffff" opacity="${(0.6 + next() * 0.4).toFixed(2)}"/></g>`;
  }).join('');
}

function bolt(x, y, scale = 1) {
  return `<polyline transform="translate(${x} ${y}) scale(${scale})" points="0,0 -8,22 2,22 -7,46 12,16 2,16 8,0" fill="#fff7b0" stroke="#ffffff" stroke-width="1" stroke-linejoin="round" opacity=".95"/>`;
}

function fog(bands) {
  return bands.map(([y, opacity]) => `<rect x="-10" y="${y}" width="320" height="16" rx="8" fill="#ffffff" opacity="${opacity}"/>`).join('');
}

function ice(seed) {
  const next = rng(seed);
  return Array.from({ length: 14 }, () => {
    const x = next() * 300, y = next() * 170, s = 3 + next() * 3;
    return `<path d="M${x.toFixed(1)} ${(y - s).toFixed(1)} L${(x + s * 0.5).toFixed(1)} ${y.toFixed(1)} L${x.toFixed(1)} ${(y + s).toFixed(1)} L${(x - s * 0.5).toFixed(1)} ${y.toFixed(1)} Z" fill="#e8f7ff" opacity=".85"/>`;
  }).join('');
}

function rainbow() {
  return `<path d="M120 170 Q180 20 290 110" fill="none" stroke="#ff6b6b" stroke-width="5" opacity=".7"/>
    <path d="M124 170 Q184 26 290 116" fill="none" stroke="#ffd166" stroke-width="5" opacity=".7"/>
    <path d="M128 170 Q188 32 290 122" fill="none" stroke="#5ce0a0" stroke-width="5" opacity=".7"/>
    <path d="M132 170 Q192 38 290 128" fill="none" stroke="#6ab8ff" stroke-width="5" opacity=".7"/>`;
}

function defs() {
  return `<defs>
    <radialGradient id="sun-glow"><stop offset="0" stop-color="#fff3a6" stop-opacity=".9"/><stop offset="1" stop-color="#fff3a6" stop-opacity="0"/></radialGradient>
    <radialGradient id="moon-glow"><stop offset="0" stop-color="#dfe9ff" stop-opacity=".35"/><stop offset="1" stop-color="#dfe9ff" stop-opacity="0"/></radialGradient>
    <linearGradient id="cloud-light" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d3dded"/></linearGradient>
    <linearGradient id="cloud-dark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c3cbd8"/><stop offset="1" stop-color="#6f7b8e"/></linearGradient>
  </defs>`;
}

function frame(sky, body, isDay) {
  const [top, bottom] = sky;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 180" preserveAspectRatio="xMidYMid slice">
    ${defs()}
    <rect width="300" height="180" fill="url(#sky)"/>
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>
    ${body}
  </svg>`;
}

/** @returns {string} a complete SVG document for the given tile kind */
export function skySceneSvg(kind, isDay = true) {
  const night = !isDay;
  const celestial = (x, y, r, opacity = 1) => (night ? moon(x, y, r) : sun(x, y, r, opacity));
  const starField = night ? stars(7) : '';
  switch (kind) {
    case 'sunny':
      return frame(night ? SKY.night : SKY.day, starField + celestial(222, 48, 15) + cloud(70, 150, 0.35, 0.5), isDay);
    case 'mostly-sunny':
      return frame(night ? SKY.night : SKY.day, starField + celestial(206, 46, 14) + cloud(120, 62, 0.55) + cloud(250, 120, 0.4, 0.9), isDay);
    case 'partly-cloudy':
      return frame(night ? SKY.night : SKY.day, starField + celestial(200, 44, 14, 0.85) + cloud(110, 70, 0.7) + cloud(230, 116, 0.6, 0.95), isDay);
    case 'mostly-cloudy':
      return frame(night ? SKY.night : SKY.overcast, starField + celestial(236, 40, 10, 0.25) + cloud(70, 56, 0.85) + cloud(180, 90, 0.9, 1, 'dark') + cloud(260, 140, 0.8, 0.95, 'dark'), isDay);
    case 'cloudy':
      return frame(SKY.overcast, cloud(60, 60, 0.9, 1, 'dark') + cloud(160, 44, 0.95, 1, 'dark') + cloud(250, 96, 0.9, 1, 'dark') + cloud(110, 130, 1, 1, 'dark'), isDay);
    case 'light-rain':
      return frame(SKY.overcast, cloud(90, 40, 0.95, 1, 'dark') + cloud(220, 56, 0.9, 1, 'dark') + rain(11, 26, 0.25), isDay);
    case 'rain':
      return frame(SKY.dark, cloud(80, 36, 1, 1, 'dark') + cloud(210, 40, 1.05, 1, 'dark') + rain(12, 64, 0.3), isDay);
    case 'rain-windy':
      return frame(SKY.dark, cloud(70, 34, 1, 1, 'dark') + cloud(200, 38, 1.05, 1, 'dark') + rain(13, 70, 0.9) + '<path d="M-10 120 Q120 100 310 130" stroke="#d7e4f5" stroke-width="2" fill="none" opacity=".5"/>', isDay);
    case 'thunderstorms':
      return frame(SKY.storm, cloud(80, 34, 1.1, 1, 'dark') + cloud(220, 40, 1.1, 1, 'dark') + rain(14, 48, 0.25) + bolt(178, 76, 1.3), isDay);
    case 'severe-storms':
      return frame(['#3a2d5c', '#140f2a'], cloud(80, 30, 1.15, 1, 'dark') + cloud(220, 36, 1.15, 1, 'dark') + rain(15, 70, 0.4, '#e0d6ff') + bolt(150, 70, 1.6) + bolt(236, 90, 1.1), isDay);
    case 'light-snow':
      return frame(SKY.snow, cloud(90, 40, 0.9, 0.95) + cloud(220, 58, 0.85, 0.95) + snow(21, 30, 0.05), isDay);
    case 'snow':
      return frame(SKY.snow, cloud(80, 34, 1, 0.95) + cloud(220, 44, 1, 0.95) + snow(22, 70, 0.08), isDay);
    case 'blowing-snow':
      return frame(SKY.snow, snow(23, 46, 0.9) + '<path d="M-10 60 Q150 40 310 70 M-10 100 Q150 84 310 112 M-10 140 Q150 128 310 150" stroke="#ffffff" stroke-width="2" fill="none" opacity=".6"/>', isDay);
    case 'wintry-mix':
      return frame(SKY.snow, cloud(80, 34, 1, 0.95, 'dark') + cloud(220, 44, 1, 0.95, 'dark') + rain(31, 26, 0.2) + snow(32, 30, 0.08), isDay);
    case 'freezing-rain':
      return frame(SKY.snow, cloud(80, 34, 1, 1, 'dark') + cloud(220, 44, 1, 1, 'dark') + rain(33, 34, 0.15, '#e8f6ff') + ice(34), isDay);
    case 'ice':
      return frame(SKY.snow, ice(35) + snow(36, 18, 0.05), isDay);
    case 'fog':
      return frame(SKY.fog, fog([[30, 0.35], [60, 0.45], [92, 0.4], [124, 0.5], [154, 0.35]]), isDay);
    case 'haze':
      return frame(SKY.haze, sun(150, 60, 22, 0.55) + fog([[70, 0.25], [104, 0.3], [138, 0.22]]), isDay);
    case 'dust':
      return frame(SKY.dust, '<path d="M-10 90 Q120 60 310 92 L310 180 L-10 180 Z" fill="#8c6a48" opacity=".5"/>' + fog([[40, 0.18], [70, 0.2]]), isDay);
    case 'showers-sun':
      return frame(night ? SKY.night : SKY.day, celestial(214, 40, 14) + cloud(96, 70, 0.8) + rainbow() + rain(41, 16, 0.2), isDay);
    default:
      return frame(night ? SKY.night : SKY.day, celestial(222, 48, 15), isDay);
  }
}
