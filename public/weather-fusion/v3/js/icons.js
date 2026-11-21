/**
 * Weather Nourie · Custom Animated SVG Weather Icon & Scene Renderer
 */

export function renderWeatherIconSvg(iconId = 'partly-day', size = 48) {
  switch (iconId) {
    case 'clear-day':
      return `<svg class="wx-svg wx-clear-day" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <defs>
          <radialGradient id="sunCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#FFF4B8"/>
            <stop offset="60%" stop-color="#FFD15C"/>
            <stop offset="100%" stop-color="#FF9E2C"/>
          </radialGradient>
        </defs>
        <circle cx="32" cy="32" r="15" fill="url(#sunCore)" />
        <g stroke="#FFD15C" stroke-width="3" stroke-linecap="round" opacity="0.88">
          <line x1="32" y1="7" x2="32" y2="12"/>
          <line x1="32" y1="52" x2="32" y2="57"/>
          <line x1="7" y1="32" x2="12" y2="32"/>
          <line x1="52" y1="32" x2="57" y2="32"/>
          <line x1="14.3" y1="14.3" x2="17.8" y2="17.8"/>
          <line x1="46.2" y1="46.2" x2="49.7" y2="49.7"/>
          <line x1="49.7" y1="14.3" x2="46.2" y2="17.8"/>
          <line x1="17.8" y1="46.2" x2="14.3" y2="49.7"/>
        </g>
      </svg>`;

    case 'clear-night':
      return `<svg class="wx-svg wx-clear-night" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <defs>
          <linearGradient id="moonGrad" x1="16" y1="12" x2="48" y2="52">
            <stop offset="0%" stop-color="#E5F0FF"/>
            <stop offset="100%" stop-color="#90B8F8"/>
          </linearGradient>
        </defs>
        <path d="M41.5 39.8A16.5 16.5 0 0 1 24.2 17c0-1.9.3-3.7.9-5.4A16.5 16.5 0 1 0 46.9 39c-1.7.5-3.5.8-5.4.8z" fill="url(#moonGrad)"/>
        <circle cx="46" cy="18" r="1.6" fill="#FFE89E"/>
        <circle cx="52" cy="27" r="1.2" fill="#E5F0FF" opacity="0.8"/>
      </svg>`;

    case 'partly-night':
      return `<svg class="wx-svg wx-partly-night" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <path d="M36 27A11 11 0 0 1 24.5 12c.2-1 .5-2 .9-3A11 11 0 1 0 39 26.5c-1 .3-2 .5-3 .5z" fill="#B6D2FF"/>
        <path d="M21 48h24a10 10 0 0 0 1.4-19.9A13.5 13.5 0 0 0 20.3 25 9.5 9.5 0 0 0 21 48z" fill="rgba(215,230,255,0.88)" stroke="rgba(255,255,255,0.45)" stroke-width="1.2"/>
      </svg>`;

    case 'cloudy':
      return `<svg class="wx-svg wx-cloudy" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <path d="M24 41h24a8.5 8.5 0 0 0 1-16.9A11.5 11.5 0 0 0 26.5 21 8 8 0 0 0 24 41z" fill="rgba(165,186,218,0.62)"/>
        <path d="M18 49h26a10 10 0 0 0 1.5-19.9A13.5 13.5 0 0 0 19.3 26 9.5 9.5 0 0 0 18 49z" fill="rgba(232,241,255,0.92)" stroke="rgba(255,255,255,0.5)" stroke-width="1.2"/>
      </svg>`;

    case 'fog':
      return `<svg class="wx-svg wx-fog" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <path d="M19 39h25a9 9 0 0 0 1.2-17.9A12.5 12.5 0 0 0 21 18.5 8.5 8.5 0 0 0 19 39z" fill="rgba(205,220,242,0.82)"/>
        <g stroke="#9CC2F5" stroke-width="2.6" stroke-linecap="round">
          <line x1="15" y1="45" x2="49" y2="45"/>
          <line x1="19" y1="51" x2="45" y2="51"/>
        </g>
      </svg>`;

    case 'drizzle':
      return `<svg class="wx-svg wx-drizzle" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <path d="M24 38h22a8 8 0 0 0 1-15.9A11 11 0 0 0 26 19.5a7.5 7.5 0 0 0-2 18.5z" fill="rgba(148,172,208,0.58)"/>
        <path d="M19 43h25a9.5 9.5 0 0 0 1.2-18.9A13 13 0 0 0 20.5 21 9 9 0 0 0 19 43z" fill="rgba(220,234,255,0.92)"/>
        <g stroke="#6EC6FF" stroke-width="2.4" stroke-linecap="round">
          <line x1="24" y1="48" x2="22" y2="54"/>
          <line x1="33" y1="48" x2="31" y2="54"/>
          <line x1="42" y1="48" x2="40" y2="54"/>
        </g>
      </svg>`;

    case 'rain':
      return `<svg class="wx-svg wx-rain" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <path d="M18 42h27a9.5 9.5 0 0 0 1.3-18.9A13.5 13.5 0 0 0 20 19.5 9.5 9.5 0 0 0 18 42z" fill="rgba(202,220,248,0.94)" stroke="rgba(255,255,255,0.45)" stroke-width="1.2"/>
        <g stroke="#5AB9FF" stroke-width="2.6" stroke-linecap="round">
          <line x1="22" y1="46" x2="19" y2="55"/>
          <line x1="31" y1="46" x2="28" y2="55"/>
          <line x1="40" y1="46" x2="37" y2="55"/>
        </g>
      </svg>`;

    case 'storm':
      return `<svg class="wx-svg wx-storm" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <path d="M18 41h27a9.5 9.5 0 0 0 1.3-18.9A13.5 13.5 0 0 0 20 18.5 9.5 9.5 0 0 0 18 41z" fill="rgba(175,196,232,0.95)" stroke="rgba(255,255,255,0.4)" stroke-width="1.2"/>
        <polygon points="33,38 25,49 32,49 29,59 41,46 34,46" fill="#FFD452"/>
        <g stroke="#5AB9FF" stroke-width="2.3" stroke-linecap="round">
          <line x1="20" y1="45" x2="18" y2="52"/>
          <line x1="44" y1="45" x2="42" y2="52"/>
        </g>
      </svg>`;

    case 'snow':
      return `<svg class="wx-svg wx-snow" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <path d="M18 42h27a9.5 9.5 0 0 0 1.3-18.9A13.5 13.5 0 0 0 20 19.5 9.5 9.5 0 0 0 18 42z" fill="rgba(225,238,255,0.94)"/>
        <g fill="#B8E2FF">
          <circle cx="22" cy="49" r="2.3"/>
          <circle cx="32" cy="52" r="2.3"/>
          <circle cx="42" cy="49" r="2.3"/>
          <circle cx="27" cy="56" r="1.9"/>
          <circle cx="37" cy="56" r="1.9"/>
        </g>
      </svg>`;

    case 'partly-day':
    default:
      return `<svg class="wx-svg wx-partly-day" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <defs>
          <radialGradient id="pSun" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#FFF2B2"/>
            <stop offset="100%" stop-color="#FFA938"/>
          </radialGradient>
        </defs>
        <circle cx="23" cy="23" r="10.5" fill="url(#pSun)"/>
        <g stroke="#FFC952" stroke-width="2.4" stroke-linecap="round">
          <line x1="23" y1="7" x2="23" y2="10"/>
          <line x1="7" y1="23" x2="10" y2="23"/>
          <line x1="11.7" y1="11.7" x2="13.8" y2="13.8"/>
          <line x1="34.3" y1="11.7" x2="32.2" y2="13.8"/>
        </g>
        <path d="M20 48h25a9.5 9.5 0 0 0 1.3-18.9A13 13 0 0 0 21.5 26 9 9 0 0 0 20 48z" fill="rgba(236,244,255,0.94)" stroke="rgba(255,255,255,0.55)" stroke-width="1.2"/>
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
