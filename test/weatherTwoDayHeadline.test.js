import test from 'node:test';
import assert from 'node:assert/strict';
import {twoDayHeadline} from '../public/weather-fusion/v3/js/today-preview.js';

const calm = {qpf:0,chance:5,wind:6,gust:12,snow:0,storm:false};
const heavyWindy = {qpf:1.1,chance:100,wind:22,gust:46,snow:0,storm:false};
const heavyRain = {qpf:.9,chance:100,wind:12,gust:22,snow:0,storm:false};
const lightRain = {qpf:.2,chance:70,wind:10,gust:18,snow:0,storm:false};

test('heavy rain with strong winds on both days is a storm-system headline', () => {
  assert.equal(
    twoDayHeadline(heavyWindy, heavyWindy),
    'Storm system will bring strong winds and heavy rain today and tomorrow'
  );
});

test('the same single hazard on both days is not called a storm system', () => {
  assert.equal(twoDayHeadline(heavyRain, heavyRain), 'Heavy rain today and tomorrow');
  assert.equal(twoDayHeadline(lightRain, lightRain), 'Rain today and tomorrow');
});

test('different hazards each day are stated separately', () => {
  assert.equal(twoDayHeadline(lightRain, heavyWindy), 'Rain today, strong winds and heavy rain tomorrow');
});

test('a quiet today with a notable tomorrow leads with tomorrow', () => {
  assert.equal(twoDayHeadline(calm, heavyRain), 'Heavy rain tomorrow');
});

test('nothing notable tomorrow returns nothing so the regular today summary is used', () => {
  assert.equal(twoDayHeadline(heavyWindy, calm), '');
  assert.equal(twoDayHeadline(calm, calm), '');
});

test('wind thresholds separate gusty from strong and never claim wind that is not forecast', () => {
  assert.equal(twoDayHeadline({...calm,gust:32},{...calm,gust:33}), 'Gusty winds today and tomorrow');
  assert.equal(twoDayHeadline({...calm,wind:26},{...calm,wind:27}), 'Strong winds today and tomorrow');
  assert.equal(twoDayHeadline({...calm,gust:29,wind:17},{...calm,gust:29,wind:17}), '');
});

test('thunderstorms and snow are reported and rain chances alone stay modest', () => {
  assert.equal(twoDayHeadline({...calm,storm:true},{...calm,storm:true}), 'Thunderstorms today and tomorrow');
  assert.equal(twoDayHeadline({...calm,snow:1,qpf:.1,chance:60},{...calm,snow:1,qpf:.1,chance:60}), 'Rain and snow today and tomorrow');
  assert.equal(twoDayHeadline({...calm,chance:45},{...calm,chance:45}), 'Scattered showers today and tomorrow');
});

test('hazards that differ between the two days are added after what they share', () => {
  const stormTomorrow = {...heavyWindy, storm:true};
  assert.equal(
    twoDayHeadline(heavyWindy, stormTomorrow),
    'Storm system will bring strong winds and heavy rain today and tomorrow, with thunderstorms tomorrow'
  );
  assert.equal(
    twoDayHeadline(heavyRain, {...heavyRain, gust:44}),
    'Heavy rain today and tomorrow, with strong winds tomorrow'
  );
});
