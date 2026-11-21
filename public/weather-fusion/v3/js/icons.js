/**
 * Weather Nourie · Realistic Volumetric Atmospheric Weather Icon Renderer
 */

const SYNODIC_MONTH_MS = 29.53058867 * 86400000;
const NEW_MOON_REF_MS = Date.UTC(2000, 0, 6, 18, 14, 0);

/**
 * Returns astronomical lunar phase fraction in [0, 1):
 * 0 = New Moon, 0.25 = First Quarter, 0.5 = Full Moon, 0.75 = Last Quarter.
 */
export function getLunarPhaseFraction(date = new Date()) {
  const diff = (date instanceof Date ? date.getTime() : Number(date)) - NEW_MOON_REF_MS;
  const phase = ((diff % SYNODIC_MONTH_MS) + SYNODIC_MONTH_MS) % SYNODIC_MONTH_MS;
  return phase / SYNODIC_MONTH_MS;
}

function buildMoonPhasePaths(cx, cy, r, phase) {
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const isWaxing = phase < 0.5;
  const rx = Math.max(0.4, Math.abs(Math.cos(2 * Math.PI * phase)) * r);
  const topY = cy - r;
  const botY = cy + r;

  if (illumination < 0.02) {
    return { litPath: '', illumination };
  }
  if (illumination > 0.98) {
    return {
      litPath: `M ${cx} ${topY} A ${r} ${r} 0 1 1 ${cx} ${botY} A ${r} ${r} 0 1 1 ${cx} ${topY} Z`,
      illumination
    };
  }
  // Outer limb arc (right side for waxing, left side for waning)
  const outerSweep = isWaxing ? 1 : 0;
  // Inner terminator arc bends toward dark side (gibbous) or lit side (crescent)
  const isGibbous = illumination > 0.5;
  const innerSweep = isWaxing ? (isGibbous ? 1 : 0) : (isGibbous ? 0 : 1);
  const litPath = `M ${cx} ${topY} A ${r} ${r} 0 0 ${outerSweep} ${cx} ${botY} A ${rx.toFixed(2)} ${r} 0 0 ${innerSweep} ${cx} ${topY} Z`;
  return { litPath, illumination };
}

function volumetricCloud(uid, { scale = 1, tx = 0, ty = 0, dark = false } = {}) {
  const topCol = dark ? '#dce6f2' : '#ffffff';
  const midCol = dark ? '#9fb1c8' : '#dde8f5';
  const botCol = dark ? '#647994' : '#a8bdd6';
  const hiOpacity = dark ? '0.45' : '0.82';
  return `
    <g transform="translate(${tx},${ty}) scale(${scale})">
      <defs>
        <linearGradient id="${uid}-body" x1="0.35" y1="0.05" x2="0.65" y2="1">
          <stop offset="0%" stop-color="${topCol}"/>
          <stop offset="52%" stop-color="${midCol}"/>
          <stop offset="100%" stop-color="${botCol}"/>
        </linearGradient>
        <radialGradient id="${uid}-lobe1" cx="38%" cy="30%" r="65%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="${hiOpacity}"/>
          <stop offset="55%" stop-color="${midCol}" stop-opacity="0.72"/>
          <stop offset="100%" stop-color="${botCol}" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${uid}-lobe2" cx="42%" cy="28%" r="62%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="${dark ? '0.38' : '0.74'}"/>
          <stop offset="60%" stop-color="${midCol}" stop-opacity="0.58"/>
          <stop offset="100%" stop-color="${botCol}" stop-opacity="0"/>
        </radialGradient>
        <filter id="${uid}-soft" x="-15%" y="-15%" width="130%" height="135%">
          <feDropShadow dx="0" dy="2.2" stdDeviation="2.2" flood-color="#071224" flood-opacity="0.34"/>
        </filter>
      </defs>
      <g filter="url(#${uid}-soft)">
        <path d="M16 46h32a10.2 10.2 0 0 0 1.4-20.3A14.2 14.2 0 0 0 21.8 22a10.5 10.5 0 0 0-8.6 6.7A8.8 8.8 0 0 0 16 46z" fill="url(#${uid}-body)"/>
        <ellipse cx="30" cy="27" rx="11.5" ry="9.5" fill="url(#${uid}-lobe1)"/>
        <ellipse cx="43.5" cy="33.5" rx="9" ry="7.2" fill="url(#${uid}-lobe2)"/>
        <ellipse cx="20.5" cy="35.5" rx="8.2" ry="6.2" fill="url(#${uid}-lobe2)"/>
      </g>
    </g>
  `;
}

let iconUidCounter = 0;

export function renderWeatherIconSvg(iconId = 'partly-day', size = 48) {
  const uid = `wx${++iconUidCounter}`;
  switch (iconId) {
    case 'clear-day':
      return `<svg class="wx-svg wx-clear-day" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <defs>
          <radialGradient id="${uid}-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#FFF9DC" stop-opacity="0.95"/>
            <stop offset="42%" stop-color="#FFD97D" stop-opacity="0.52"/>
            <stop offset="72%" stop-color="#F6B256" stop-opacity="0.16"/>
            <stop offset="100%" stop-color="#F6B256" stop-opacity="0"/>
          </radialGradient>
          <radialGradient id="${uid}-orb" cx="42%" cy="38%" r="58%">
            <stop offset="0%" stop-color="#FFFDF0"/>
            <stop offset="48%" stop-color="#FFE498"/>
            <stop offset="85%" stop-color="#F5B451"/>
            <stop offset="100%" stop-color="#E39234"/>
          </radialGradient>
        </defs>
        <circle cx="32" cy="32" r="29" fill="url(#${uid}-halo)"/>
        <circle cx="32" cy="32" r="14.5" fill="url(#${uid}-orb)"/>
      </svg>`;

    case 'clear-night': {
      const phase = getLunarPhaseFraction();
      const { litPath, illumination } = buildMoonPhasePaths(32, 32, 14.5, phase);
      const glowOp = (0.12 + illumination * 0.28).toFixed(2);
      return `<svg class="wx-svg wx-clear-night" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <defs>
          <radialGradient id="${uid}-mhalo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#DDEAFF" stop-opacity="${glowOp}"/>
            <stop offset="100%" stop-color="#DDEAFF" stop-opacity="0"/>
          </radialGradient>
          <radialGradient id="${uid}-mlit" cx="38%" cy="34%" r="68%">
            <stop offset="0%" stop-color="#FAFBFD"/>
            <stop offset="60%" stop-color="#DCE4F0"/>
            <stop offset="100%" stop-color="#AEBDD4"/>
          </radialGradient>
          <clipPath id="${uid}-mclip"><circle cx="32" cy="32" r="14.5"/></clipPath>
        </defs>
        <circle cx="32" cy="32" r="27" fill="url(#${uid}-mhalo)"/>
        <circle cx="32" cy="32" r="14.5" fill="rgba(148,172,208,0.16)" stroke="rgba(220,235,255,0.2)" stroke-width="0.6"/>
        ${litPath ? `<path d="${litPath}" fill="url(#${uid}-mlit)"/>` : ''}
        <g clip-path="url(#${uid}-mclip)" opacity="0.18">
          <circle cx="27" cy="27" r="3.4" fill="#6b7c96"/>
          <circle cx="36" cy="35" r="4.2" fill="#6b7c96"/>
          <circle cx="34" cy="24" r="2.2" fill="#6b7c96"/>
        </g>
        <circle cx="49" cy="17" r="1.2" fill="#F2F6FF" opacity="0.82"/>
        <circle cx="15" cy="20" r="0.9" fill="#DCE9FF" opacity="0.65"/>
      </svg>`;
    }

    case 'partly-night': {
      const phase = getLunarPhaseFraction();
      const { litPath } = buildMoonPhasePaths(24, 22, 10, phase);
      return `<svg class="wx-svg wx-partly-night" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <defs>
          <radialGradient id="${uid}-pnlit" cx="38%" cy="34%" r="68%">
            <stop offset="0%" stop-color="#FAFBFD"/>
            <stop offset="100%" stop-color="#B9C8DE"/>
          </radialGradient>
        </defs>
        <circle cx="24" cy="22" r="10" fill="rgba(148,172,208,0.16)"/>
        ${litPath ? `<path d="${litPath}" fill="url(#${uid}-pnlit)"/>` : ''}
        ${volumetricCloud(uid, { scale: 0.92, tx: 4, ty: 6, dark: true })}
      </svg>`;
    }

    case 'cloudy':
      return `<svg class="wx-svg wx-cloudy" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        ${volumetricCloud(`${uid}b`, { scale: 0.78, tx: 11, ty: -4, dark: true })}
        ${volumetricCloud(`${uid}f`, { scale: 0.96, tx: -1, ty: 5, dark: false })}
      </svg>`;

    case 'fog':
      return `<svg class="wx-svg wx-fog" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        ${volumetricCloud(uid, { scale: 0.88, tx: 3, ty: -4, dark: true })}
        <g stroke="rgba(220,234,250,0.68)" stroke-width="2.4" stroke-linecap="round">
          <line x1="14" y1="45" x2="50" y2="45"/>
          <line x1="19" y1="51" x2="45" y2="51"/>
        </g>
      </svg>`;

    case 'drizzle':
      return `<svg class="wx-svg wx-drizzle" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        ${volumetricCloud(uid, { scale: 0.9, tx: 2, ty: -4, dark: true })}
        <g stroke="rgba(168,214,252,0.82)" stroke-width="1.8" stroke-linecap="round">
          <line x1="24" y1="45" x2="21.5" y2="52"/>
          <line x1="33" y1="46" x2="30.5" y2="53"/>
          <line x1="42" y1="45" x2="39.5" y2="52"/>
        </g>
      </svg>`;

    case 'rain':
      return `<svg class="wx-svg wx-rain" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        ${volumetricCloud(uid, { scale: 0.92, tx: 2, ty: -5, dark: true })}
        <g stroke="rgba(150,206,252,0.88)" stroke-width="2" stroke-linecap="round">
          <line x1="22" y1="44" x2="18.5" y2="54"/>
          <line x1="31" y1="45" x2="27.5" y2="55"/>
          <line x1="40" y1="44" x2="36.5" y2="54"/>
          <line x1="47" y1="45" x2="44" y2="53"/>
        </g>
      </svg>`;

    case 'storm':
      return `<svg class="wx-svg wx-storm" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        ${volumetricCloud(uid, { scale: 0.92, tx: 2, ty: -6, dark: true })}
        <polygon points="33,38 25.5,48.5 31.8,48.5 29,58 40,45.5 33.8,45.5" fill="#F6D57A"/>
        <g stroke="rgba(150,206,252,0.75)" stroke-width="1.9" stroke-linecap="round">
          <line x1="20" y1="44" x2="17.5" y2="52"/>
          <line x1="44" y1="44" x2="41.5" y2="52"/>
        </g>
      </svg>`;

    case 'snow':
      return `<svg class="wx-svg wx-snow" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        ${volumetricCloud(uid, { scale: 0.9, tx: 2, ty: -4, dark: false })}
        <g fill="rgba(232,244,255,0.92)">
          <circle cx="22" cy="48" r="2.1"/>
          <circle cx="32" cy="51" r="2.2"/>
          <circle cx="42" cy="48" r="2.1"/>
          <circle cx="27" cy="55.5" r="1.7"/>
          <circle cx="37" cy="55.5" r="1.7"/>
        </g>
      </svg>`;

    case 'partly-day':
    default:
      return `<svg class="wx-svg wx-partly-day" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <defs>
          <radialGradient id="${uid}-phalo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#FFF7D6" stop-opacity="0.9"/>
            <stop offset="55%" stop-color="#F7C76E" stop-opacity="0.34"/>
            <stop offset="100%" stop-color="#F7C76E" stop-opacity="0"/>
          </radialGradient>
          <radialGradient id="${uid}-porb" cx="40%" cy="36%" r="60%">
            <stop offset="0%" stop-color="#FFFDF0"/>
            <stop offset="55%" stop-color="#FFE08C"/>
            <stop offset="100%" stop-color="#EBA343"/>
          </radialGradient>
        </defs>
        <circle cx="23" cy="23" r="20" fill="url(#${uid}-phalo)"/>
        <circle cx="23" cy="23" r="10" fill="url(#${uid}-porb)"/>
        ${volumetricCloud(uid, { scale: 0.92, tx: 4, ty: 5, dark: false })}
      </svg>`;
  }
}

/**
 * Generates rich SVG panoramic illustrations for the 3 Signature Exposure Cards:
 * 1. Shade Comfort
 * 2. Direct Sun / Active Precip
 * 3. For Pets & Sidewalk Heat
 */
export function renderExposureArtworkSvg(type, { isRaining = false, isDay = true, pawLevel = 'safe' } = {}) {
  if (type === 'shade') {
    return `<svg class="exposure-art-svg" viewBox="0 0 360 110" fill="none" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="shadeSky" x1="0" y1="0" x2="360" y2="110">
          <stop offset="0%" stop-color="#152b4a"/>
          <stop offset="100%" stop-color="#0f2038"/>
        </linearGradient>
      </defs>
      <rect width="360" height="110" fill="url(#shadeSky)"/>
      <circle cx="305" cy="28" r="36" fill="rgba(120,185,255,0.12)"/>
      <path d="M0 84 Q95 66 190 82 T360 76 L360 110 L0 110 Z" fill="rgba(24,52,86,0.85)"/>
      <!-- Canopy silhouette -->
      <path d="M-10 0 L155 0 Q135 45 75 56 Q25 65 -10 48 Z" fill="rgba(16,42,68,0.92)"/>
      <circle cx="52" cy="26" r="32" fill="rgba(46,110,155,0.25)"/>
      <circle cx="96" cy="18" r="26" fill="rgba(64,145,195,0.18)"/>
    </svg>`;
  }

  if (type === 'sun') {
    if (isRaining) {
      return `<svg class="exposure-art-svg" viewBox="0 0 360 110" fill="none" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="rainExpSky" x1="0" y1="0" x2="360" y2="110">
            <stop offset="0%" stop-color="#192d4b"/>
            <stop offset="100%" stop-color="#11223b"/>
          </linearGradient>
        </defs>
        <rect width="360" height="110" fill="url(#rainExpSky)"/>
        <g stroke="rgba(110,195,255,0.35)" stroke-width="1.6" stroke-linecap="round">
          <line x1="45" y1="12" x2="33" y2="46"/>
          <line x1="95" y1="22" x2="83" y2="56"/>
          <line x1="155" y1="10" x2="143" y2="44"/>
          <line x1="215" y1="20" x2="203" y2="54"/>
          <line x1="275" y1="14" x2="263" y2="48"/>
          <line x1="325" y1="24" x2="313" y2="58"/>
        </g>
        <path d="M0 86 Q110 74 220 86 T360 82 L360 110 L0 110 Z" fill="rgba(30,62,104,0.75)"/>
      </svg>`;
    }
    return `<svg class="exposure-art-svg" viewBox="0 0 360 110" fill="none" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="sunExpSky" x1="0" y1="0" x2="360" y2="110">
          <stop offset="0%" stop-color="#2c446e"/>
          <stop offset="55%" stop-color="#20365c"/>
          <stop offset="100%" stop-color="#162744"/>
        </linearGradient>
        <radialGradient id="sunBurst" cx="78%" cy="28%" r="48%">
          <stop offset="0%" stop-color="rgba(255,216,115,0.65)"/>
          <stop offset="45%" stop-color="rgba(255,175,80,0.22)"/>
          <stop offset="100%" stop-color="rgba(255,175,80,0)"/>
        </radialGradient>
      </defs>
      <rect width="360" height="110" fill="url(#sunExpSky)"/>
      <rect width="360" height="110" fill="url(#sunBurst)"/>
      <circle cx="282" cy="31" r="18" fill="#FFE082" opacity="0.92"/>
      <path d="M0 85 Q120 68 240 82 T360 76 L360 110 L0 110 Z" fill="rgba(34,58,92,0.82)"/>
    </svg>`;
  }

  // Pets & Sidewalk Heat card artwork
  const glowColor =
    pawLevel === 'danger'
      ? 'rgba(255,107,107,0.32)'
      : pawLevel === 'caution'
      ? 'rgba(255,192,105,0.28)'
      : 'rgba(99,226,183,0.24)';

  return `<svg class="exposure-art-svg" viewBox="0 0 360 110" fill="none" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="petSky" x1="0" y1="0" x2="360" y2="110">
        <stop offset="0%" stop-color="#1b3355"/>
        <stop offset="100%" stop-color="#12233c"/>
      </linearGradient>
    </defs>
    <rect width="360" height="110" fill="url(#petSky)"/>
    <circle cx="290" cy="36" r="48" fill="${glowColor}"/>
    <!-- Sidewalk perspective path -->
    <path d="M0 82 L360 76 L360 110 L0 110 Z" fill="rgba(26,44,72,0.92)"/>
    <path d="M165 78 L235 78 L295 110 L110 110 Z" fill="rgba(180,202,235,0.18)"/>
    <!-- Stylized paw print badge -->
    <g transform="translate(278, 26)" fill="rgba(255,255,255,0.82)">
      <ellipse cx="14" cy="20" rx="7.5" ry="6"/>
      <circle cx="5" cy="11" r="3.2"/>
      <circle cx="11" cy="7.5" r="3.2"/>
      <circle cx="18" cy="7.5" r="3.2"/>
      <circle cx="23.5" cy="11.5" r="3.2"/>
    </g>
  </svg>`;
}
