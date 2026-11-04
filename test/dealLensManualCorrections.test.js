import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('manual fact corrections change displayed model source but preserve original extracted figure',()=>{
  const ctx=vm.createContext({});
  ctx.window=ctx;
  vm.runInContext(fs.readFileSync('public/deal-lens/intake-state.js','utf8'),ctx);
  const original={key:'fuelGrossProfitUsd',value:450000,scope:'portfolio',source:'Site P&L',period:'FY2025'};
  const deal={reportedFacts:[original],factCorrections:{}};
  const token=ctx.DealIntake.token(original);
  deal.factCorrections[token]={value:475000,priorValue:450000};
  const rows=ctx.DealIntake.facts(deal);
  assert.equal(rows[0].value,475000);
  assert.equal(rows[0].manuallyCorrected,true);
  assert.equal(original.value,450000);
});

test('pasted fuel agreement table is read without inventing unknown supplier fields',()=>{
  const ctx=vm.createContext({OriginalModel:{definitions:[]},DealRoster:{read:()=>[],counts:()=>({assets:0,sites:0})},DealPaste:{number:v=>Number(v)}});
  ctx.window=ctx;
  vm.runInContext(fs.readFileSync('public/deal-lens/plain-intake.js','utf8'),ctx);
  const input=[
    'Deal name: Sample Deal',
    'FUEL SUPPLY AGREEMENT',
    '| Field | Value | Source |',
    '| --- | --- | --- |',
    '| Current distributor | ABC Fuel Company | Signed supply contract page 2 |',
    '| Terminal / loading point | Terminal A | Fuel invoice |',
    '| Contract expiration date | 2028-06-30 | Contract page 10 |',
    '| UNAM payoff / exposure | Not provided | No executed contract |'
  ].join('\n');
  const result=ctx.DealPlain.parse(input);
  assert.equal(result.fuelSupply.fuelDistributor,'ABC Fuel Company');
  assert.equal(result.fuelSupply.fuelTerminal,'Terminal A');
  assert.equal(result.fuelSupply.fuelContractEnd,'2028-06-30');
  assert.equal(Object.hasOwn(result.fuelSupply,'fuelUnams'),false);
});
