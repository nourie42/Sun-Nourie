import { isExperimentalWeatherPage } from './car-wash.js?v=low-rain-display-v1';
import { mountExperimentalAccuracy } from './experimental-accuracy.js?v=exp-v3';

function injectExperimentalNavShortcuts() {
  const shell = document.querySelector('.shell');
  if (!shell || document.getElementById('exp-top-pills')) return;

  const dock = document.createElement('nav');
  dock.id = 'exp-top-pills';
  dock.className = 'exp-top-pills';
  dock.setAttribute('aria-label', 'Experimental views and quick sections');

  const topbar = shell.querySelector('.topbar');
  if (topbar) {
    shell.insertBefore(dock, topbar);
  } else {
    shell.prepend(dock);
  }

  const pills = [
    ...shell.querySelectorAll(':scope > a.experimental-back, :scope > a[class^="experimental-"]'),
  ];
  for (const link of pills) dock.appendChild(link);

  const accPill = document.createElement('a');
  accPill.id = 'exp-jump-accuracy';
  accPill.className = 'experimental-wn-link';
  accPill.href = '#experimental-accuracy-section';
  accPill.innerHTML = '<span aria-hidden="true">🎯</span> Model Accuracy';

  const backLink = dock.querySelector('#experimental-back');
  if (backLink) {
    backLink.insertAdjacentElement('afterend', accPill);
  } else {
    dock.prepend(accPill);
  }
}

function ensureExperimentalStylesheet() {
  if (document.getElementById('experimental-enhance-css')) return;
  const link = document.createElement('link');
  link.id = 'experimental-enhance-css';
  link.rel = 'stylesheet';
  link.href = '/weather-fusion/experimental-enhance.css?v=exp-acc-v8';
  document.head.appendChild(link);
}

async function bootExperimentalEnhancements() {
  if (!isExperimentalWeatherPage()) return;
  ensureExperimentalStylesheet();
  injectExperimentalNavShortcuts();
  try {
    await import('./wn-blend.js?v=exp-compare-v1');
  } catch {
    // Non-fatal if lazy compare falls back to click
  }
  mountExperimentalAccuracy();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootExperimentalEnhancements);
  } else {
    bootExperimentalEnhancements();
  }
}
