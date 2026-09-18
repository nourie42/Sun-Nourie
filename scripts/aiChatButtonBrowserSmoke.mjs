import puppeteer from 'puppeteer';

const base = String(process.env.AI_CHAT_BASE_URL || 'https://sun-nourie-live.onrender.com').replace(/\/$/, '');
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 1 });
page.setDefaultTimeout(30000);

const errors = [];
const logs = [];
page.on('pageerror', e => errors.push('pageerror: ' + (e.stack || e.message || String(e))));
page.on('console', msg => logs.push('console ' + msg.type() + ': ' + msg.text()));
page.on('requestfailed', req => errors.push('requestfailed: ' + req.url() + ' :: ' + (req.failure()?.errorText || 'unknown')));

async function snapshot(label) {
  const state = await page.evaluate(() => ({
    href: location.href,
    readyState: document.readyState,
    best: !!document.getElementById('bestModeBtn'),
    choose: !!document.getElementById('chooseModelBtn'),
    settings: !!document.getElementById('settingsBtn'),
    council: !!document.getElementById('councilBtn'),
    providerSheet: document.getElementById('providerSheet')?.className || null,
    settingsSheet: document.getElementById('settingsSheet')?.className || null,
    chatPanel: document.getElementById('chatPanel')?.className || null,
    councilPanel: document.getElementById('councilPanel')?.className || null,
    mainScript: [...document.scripts].map(s=>s.src).find(src=>src.includes('main-chat-v2.js')) || null,
  }));
  console.log(label, JSON.stringify(state));
  return state;
}

try {
  const response = await page.goto(base + '/ai-council/?browser-smoke=' + Date.now(), { waitUntil:'networkidle2', timeout:60000 });
  console.log('HOME_STATUS', response?.status());
  await page.waitForSelector('#chooseModelBtn');
  await snapshot('INITIAL');

  await page.click('#chooseModelBtn');
  await page.waitForFunction(() => document.getElementById('providerSheet')?.classList.contains('show'));
  await snapshot('AFTER_CHOOSE_MODEL');

  await page.click('#providerBack');
  await page.waitForFunction(() => !document.getElementById('providerSheet')?.classList.contains('show'));

  await page.click('#settingsBtn');
  await page.waitForFunction(() => document.getElementById('settingsSheet')?.classList.contains('show'));
  await snapshot('AFTER_SETTINGS');

  await page.click('#settingsBack');
  await page.waitForFunction(() => !document.getElementById('settingsSheet')?.classList.contains('show'));

  await page.click('#councilBtn');
  await page.waitForFunction(() => document.getElementById('councilPanel')?.classList.contains('active'));
  const councilState = await snapshot('AFTER_TOP_COUNCIL');
  if (councilState.chatPanel?.includes('active')) throw new Error('Chat panel stayed active after Council click.');

  await page.goto(base + '/ai-council/bots/?browser-smoke=' + Date.now(), { waitUntil:'networkidle2', timeout:60000 });
  await page.waitForSelector('.bottom-nav a[href="/ai-council/?view=council"]');
  await page.click('.bottom-nav a[href="/ai-council/?view=council"]');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('view') === 'council');
  await page.waitForSelector('#councilPanel.active');
  await snapshot('AFTER_BOTS_COUNCIL');

  if (errors.length) {
    console.error('BROWSER_ERRORS\n' + errors.join('\n'));
    throw new Error('Browser console/request errors occurred.');
  }
  console.log('BROWSER_LOGS\n' + logs.join('\n'));
  console.log('AI Chat button browser smoke passed');
} finally {
  await browser.close();
}
