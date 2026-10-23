import test from 'node:test';
import assert from 'node:assert/strict';
import { weatherDateTimeFormat } from '../src/weatherDateTimeFormat.js';

test('hourly forecast dates reuse a formatter across changing timestamps', () => {
  const options = { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' };
  const first = weatherDateTimeFormat('en-CA', options);
  for (let hour = 0; hour < 240; hour++) {
    const formatter = weatherDateTimeFormat('en-CA', { ...options });
    assert.equal(formatter, first);
    assert.match(formatter.format(new Date(Date.UTC(2026, 9, 23, hour))), /^2026-\d{2}-\d{2}$/);
  }
});

test('time zones, locales and clock options remain independent across DST changes', () => {
  const times = ['2026-03-08T06:59:00Z', '2026-03-08T07:00:00Z', '2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z'];
  for (const timeZone of ['America/New_York', 'America/North_Dakota/Beulah', 'UTC']) {
    for (const locale of ['en-US', 'en-CA']) {
      const options = { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
      const cached = weatherDateTimeFormat(locale, options);
      const reference = new Intl.DateTimeFormat(locale, options);
      for (const time of times) assert.deepEqual(cached.formatToParts(new Date(time)), reference.formatToParts(new Date(time)));
    }
  }
});

test('the formatter registry evicts old configurations rather than growing without a bound', () => {
  const options = { timeZone: 'UTC', year: 'numeric' };
  const first = weatherDateTimeFormat('en-US-x-old', options);
  for (let i = 0; i < 65; i++) weatherDateTimeFormat(`en-US-x-cache-${i}`, options);
  assert.notEqual(weatherDateTimeFormat('en-US-x-old', options), first);
});

test('invalid time zones still fail validation', () => {
  assert.throws(() => weatherDateTimeFormat('en-US', { timeZone: 'Invalid/Zone' }), RangeError);
});
