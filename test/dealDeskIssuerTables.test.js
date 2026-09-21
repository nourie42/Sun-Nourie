import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {arkoAnnualTables} from '../src/dealDeskIssuerTables.js';
import {applyIndustryEstimates} from '../deal-desk/lib/estimates.js';
import {calculate,validateImport} from '../src/dealDeskModel.js';
const source={id:'issuer',url:'https://www.globenewswire.com/news-release/2026/02/25/3245001/0/en/ARKO-Corp-Reports-Fourth-Quarter-and-Full-Year-2025-Results.html',text:fs.readFileSync(new URL('./fixtures/arko-fy2025-tables.txt',import.meta.url),'utf8')};
test('issuer table import reads all channels and reconciles to consolidated cash operating earnings',()=>{
 const r=arkoAnnualTables([source],'FY2025');assert.ok(r);assert.equal(r.deal.gallons,922726000);assert.equal(r.deal.insideGp,499781000);assert.equal(r.deal.sellerOpex,685144000);
 assert.deepEqual(r.channels.slice(0,2).map(c=>[c.sites,c.gallons,c.opex]),[[2099,989071000,57406000],[295,142848000,26120000]]);
 const filled=applyIndustryEstimates(r);validateImport(filled.deal);const v=calculate(filled.deal);
 assert.equal(v.totalSites,3512);assert.equal(v.seller,229792000);assert.equal(filled.deal.other,59020000);assert.equal(filled.evidence.find(e=>e.field==='other').status,'Estimated');assert.equal(filled.deal.sellerGa,0);assert.equal(filled.deal.retainedGa,0);
});
test('issuer adapter rejects wrong periods and layouts; figures are read from source rather than constants',()=>{
 assert.equal(arkoAnnualTables([source],'FY2024'),null);assert.equal(arkoAnnualTables([{...source,text:source.text.replaceAll('2025','2023')}],'FY2025'),null);
 assert.equal(arkoAnnualTables([{...source,text:source.text.replace('922,726','923,726')}],'FY2025').deal.gallons,923726000);
 assert.equal(arkoAnnualTables([{...source,text:source.text.replaceAll('(in thousands)','(in millions)')}],'FY2025'),null);
});
