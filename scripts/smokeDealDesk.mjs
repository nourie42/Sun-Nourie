import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {mkdir, readFile} from 'node:fs/promises';
import express from 'express';
import {registerDealDeskRoutes} from '../src/dealDeskRoutes.js';
import {exampleDeal} from '../src/dealDeskModel.js';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const JSZip = require('jszip');

const live = process.env.DEAL_DESK_BASE_URL;
const output = process.env.DEAL_DESK_QA_DIR || '/tmp/deal-desk-qa';
let server;
let base = live;
if (!live) {
  const app = express();
  registerDealDeskRoutes(app, {
    env: {ANTHROPIC_API_KEY: 'test-not-real', AI_COUNCIL_ACCESS_CODE: 'test-code'},
    fetchImpl: async () => Response.json({content: [{type: 'text', text: JSON.stringify({
      deal: exampleDeal(), summary: 'Test review ready', evidence: [{field: 'gallons', source: 'fixture.xlsx/Sheet1/A1'}], warnings: ['Fictional QA data'],
    })}]}),
  });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
}
await mkdir(output, {recursive: true});
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  proxy: process.env.DEAL_DESK_PROXY ? {server: process.env.DEAL_DESK_PROXY} : undefined,
  args: ['--no-sandbox'],
});
try {
  for (const viewport of [{width: 1440, height: 1050}, {width: 390, height: 844}]) {
    const page = await browser.newPage({viewport, ignoreHTTPSErrors: process.env.DEAL_DESK_TEST_IGNORE_HTTPS_ERRORS === '1'});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => {if (msg.type() === 'error') errors.push(msg.text());});
    await page.goto(`${base}/deal-desk`, {waitUntil: 'networkidle'});
    await page.getByRole('heading', {name: 'From seller files to a defensible deal.'}).waitFor();
    assert.equal(await page.getByRole('tab').count(), 4);
    await page.screenshot({path: `${output}/${viewport.width}-intake.png`, fullPage: true});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Intake must not overflow viewport');
    await page.getByRole('button', {name: 'Load example'}).click();
    assert.match(await page.locator('.metrics').innerText(), /\$4,240,000/);
    assert.match(await page.locator('.metrics').innerText(), /\$95,000/);
    await page.getByRole('tab', {name: '02 · Economics'}).click();
    await page.getByRole('heading', {name: 'The conversion bridge'}).waitFor();
    assert.match(await page.locator('.result-band').innerText(), /\$4,240,000/);
    await page.screenshot({path: `${output}/${viewport.width}-economics.png`, fullPage: true});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Economics must not overflow viewport');
    await page.getByRole('tab', {name: '03 · Workbook guide'}).click();
    await page.getByRole('heading', {name: 'What the workbooks actually do'}).waitFor();
    assert.equal(await page.locator('.download-links a').count(), 3);
    const links = await page.locator('.download-links a').evaluateAll(nodes => nodes.map(n => n.href));
    assert.ok(links.every(url => url.startsWith('https://nourie-deal-desk.nourie42.chatgpt.site/downloads/')));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Workbook guide must not overflow viewport');
    await page.getByRole('tab', {name: '04 · Synergy playbook'}).click();
    await page.getByRole('heading', {name: 'Fuel purchasing & freight'}).waitFor();
    await page.getByRole('tab', {name: '01 · Deal inputs'}).click();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', {name: 'Export analysis'}).click();
    const download = await downloadPromise;
    const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(exported.deal.gallons, 15000000);
    assert.equal(exported.result.sun, 4240000);
    await page.getByRole('button', {name: 'Clear inputs'}).click();
    assert.doesNotMatch(await page.locator('.metrics').innerText(), /\$4,240,000/);
    await page.locator('input[type=file]').setInputFiles({name: 'saved.JSON', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported))});
    await page.getByRole('status').filter({hasText: '1 file(s) read.'}).waitFor();
    assert.match(await page.locator('.metrics').innerText(), /\$4,240,000/);

    const zip = new JSZip();
    zip.file('xl/workbook.xml', '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Annual gallons</t></is></c><c r="B1"><f>15000000</f><v>15000000</v></c></row></sheetData></worksheet>');
    await page.locator('input[type=file]').setInputFiles({name: 'fixture.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await zip.generateAsync({type: 'nodebuffer', compression: 'DEFLATE'})});
    await page.locator('.file-row').filter({hasText: 'fixture.xlsx'}).waitFor();
    if (!live) {
      await page.getByLabel('Workspace access code').fill('test-code');
      await page.getByRole('button', {name: 'Analyze with AI'}).click();
      await page.getByText('Test review ready', {exact: true}).waitFor();
      await page.getByRole('button', {name: 'Apply suggested inputs'}).click();
      assert.match(await page.locator('.metrics').innerText(), /\$4,240,000/);
      await page.getByLabel('Workspace access code').fill('incorrect');
      await page.getByRole('button', {name: 'Analyze with AI'}).click();
      await page.getByRole('status').filter({hasText: 'Enter your Deal Desk password'}).waitFor();
      assert.match(await page.locator('.metrics').innerText(), /\$4,240,000/, 'Failure must preserve inputs');
      // The intentional 401 generates one browser console error.
      assert.ok(errors.every(message => /401/.test(message)), errors.join('\n'));
    } else {
      assert.deepEqual(errors, []);
    }
    console.log(JSON.stringify({width: viewport.width, tabs: 4, exportImport: true, xlsx: true, aiTest: live ? 'not invoked on production' : 'mocked success/error passed', noOverflow: true}));
    await page.close();
  }
} finally {
  await browser.close();
  if (server) await new Promise(resolve => {server.close(resolve); server.closeAllConnections();});
}
