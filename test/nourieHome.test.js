import test from 'node:test';
import assert from 'node:assert/strict';
import {
  airLevel,
  airScore,
  buildModel,
  personStatus,
  resample,
  spreadMarks,
  tileLayers,
} from '../home-assistant/nourie-home.js';
import { createMockHass } from '../home-assistant/demo/mock-hass.js';
import { demoHome } from '../home-assistant/demo/demo-data.js';

const NOW = Date.parse('2026-10-16T14:00:00Z');

function hassFrom(entities, extra = {}) {
  return createMockHass({ entities, ...extra }).hass;
}

const sensor = (id, name, state, attrs = {}, extra = {}) => ({ id, name, state, attrs, ...extra });

test('air thresholds follow the CO2 and PM2.5 bands shown on the Air tab', () => {
  assert.equal(airLevel('co2', 579), 0);
  assert.equal(airLevel('co2', 1000), 1);
  assert.equal(airLevel('co2', 1180), 2);
  assert.equal(airLevel('co2', 4200), 4);
  assert.equal(airLevel('pm25', 4.2), 0);
  assert.equal(airLevel('pm25', 16.4), 2);
  assert.equal(airLevel('pm25', 'unknown'), null);
  assert.equal(airScore('co2', 0), 100);
  assert.equal(airScore('co2', 4200), 0);
  const scores = [400, 800, 1200, 1800, 2500, 3500].map((v) => airScore('co2', v));
  assert.deepEqual([...scores].sort((a, b) => b - a), scores, 'scores fall as CO2 rises');
});

test('resample averages a step series over time, not over samples', () => {
  assert.deepEqual(resample([[0, 10], [50, 20]], 0, 100, 2), [10, 20]);
  assert.deepEqual(resample([[0, 0], [25, 100]], 0, 100, 2), [50, 100]);
  assert.deepEqual(resample([[60, 5]], 0, 100, 4), [null, null, 5, 5]);
  assert.deepEqual(resample([], 0, 100, 3), [null, null, null]);
});

test('the demo home builds every section of the dashboard', () => {
  const model = buildModel(createMockHass(demoHome).hass, {}, {}, NOW);

  assert.equal(model.people.length, 4);
  const jordan = model.people.find((p) => p.first === 'Jordan');
  assert.equal(jordan.driving, true);
  assert.equal(personStatus(jordan, model.units), 'Driving · 38 mph');
  assert.equal(personStatus(jordan, model.units, true), 'Driving');
  assert.equal(model.people.find((p) => p.first === 'Sam').battery, 12);

  assert.equal(model.air.rooms.length, 4);
  const kids = model.air.rooms.find((r) => r.name === 'Kids Room Air');
  assert.equal(kids.level, 2, 'PM2.5 16.4 makes the room fair even though CO2 is excellent');
  assert.equal(kids.primary.metric, 'pm25', 'the reading that sets the rating leads the card');
  assert.equal(kids.hum.value, 63);
  assert.ok(model.air.tips.some((t) => t.action?.entity === 'fan.kids_purifier'), 'offers to turn on the purifier in the same room');

  assert.equal(model.energy.mains.name, 'Emporia Vue');
  assert.equal(model.energy.totalW, 1840);
  assert.equal(model.energy.today, 23.4);
  assert.equal(model.energy.circuits.length, 9);
  assert.equal(model.energy.circuits[0].name, 'Air Conditioner');
  assert.deepEqual(model.energy.plugs, ['switch.emporia_garage_freezer']);

  assert.equal(model.water.has, true);
  assert.equal(model.water.today, 142);
  assert.equal(model.water.flowUnit, 'gal/min');
  assert.equal(model.water.leak, false);

  assert.equal(model.robots.length, 3);
  assert.equal(model.robots.find((r) => r.litter).name, 'Litter-Robot');
  assert.deepEqual(model.robots.find((r) => r.id === 'vacuum.downstairs_vis_nav').fanSpeeds, ['Quiet', 'Auto', 'Boost']);

  assert.equal(model.climate.length, 2);
  assert.equal(model.weather.temp, 64);
  assert.equal(model.lists[0].name, 'Shopping List');

  const titles = model.alerts.map((a) => a.title);
  assert.ok(titles.includes('Garage Door is open'));
  assert.ok(titles.includes("Sam's phone is at 12%"));
  assert.ok(!model.favorites.ids.includes('switch.garage_siren'), 'sirens never become one-tap tiles');
  assert.ok(!model.favorites.ids.includes('switch.primary_purifier_child_lock'), 'config switches stay out of the tiles');
});

test('learned favorites lead with what people tapped most and fill whole rows', () => {
  const learned = { ids: ['light.kitchen', 'fan.primary_purifier', 'switch.office_desk', 'switch.garage_siren'] };
  const model = buildModel(createMockHass(demoHome).hass, {}, { learned }, NOW);
  assert.equal(model.favorites.source, 'learned');
  assert.deepEqual(model.favorites.ids.slice(0, 3), ['light.kitchen', 'fan.primary_purifier', 'switch.office_desk']);
  assert.equal(model.favorites.ids.length % 3, 0);
  assert.ok(!model.favorites.ids.includes('switch.garage_siren'));
});

test('a device air index never outvotes its own particle readings', () => {
  const hass = hassFrom([
    sensor('sensor.hall_aqi', 'Hallway Air Quality Monitor Air quality index', 95, { device_class: 'aqi' }, { device: 'hall' }),
    sensor('sensor.hall_pm25', 'Hallway Air Quality Monitor PM2.5', 1, { device_class: 'pm25', unit_of_measurement: 'µg/m³' }, { device: 'hall' }),
    sensor('sensor.bedroom_co2', 'Bedroom C02', 4200, { device_class: 'carbon_dioxide', unit_of_measurement: 'ppm' }, { area: 'bedroom' }),
  ], { devices: { hall: { id: 'hall', name: 'Hallway Air Quality Monitor' } }, areas: { bedroom: { area_id: 'bedroom', name: 'Bedroom' } } });
  const model = buildModel(hass, {}, {}, NOW);
  const hall = model.air.rooms.find((r) => r.name === 'Hallway Air Quality Monitor');
  assert.equal(hall.level, 0);
  const bedroom = model.air.rooms.find((r) => r.name === 'Bedroom');
  assert.equal(bedroom.level, 4);
  assert.ok(model.alerts.some((a) => a.title === 'Bedroom: CO₂ 4,200 ppm' && a.tab === 'air'));
});

test('Emporia circuits without a mains channel add up to an estimated total', () => {
  const hass = hassFrom([
    sensor('sensor.dryer_power_minute_average', 'dryer Power Minute Average', 1200, { device_class: 'power', unit_of_measurement: 'W' }),
    sensor('sensor.washer_power_minute_average', 'washer Power Minute Average', 300, { device_class: 'power', unit_of_measurement: 'W' }),
    sensor('sensor.dryer_energy_this_month', 'dryer Energy This Month', 41.2, { device_class: 'energy', unit_of_measurement: 'kWh' }),
    sensor('sensor.dryer_cost', 'Dryer Energy Cost This Month', 8.4, { device_class: 'monetary', unit_of_measurement: '$' }),
    sensor('sensor.washer_cost', 'Washer Energy Cost This Month', 2.1, { device_class: 'monetary', unit_of_measurement: '$' }),
  ]);
  const e = buildModel(hass, {}, {}, NOW).energy;
  assert.equal(e.mains, null);
  assert.equal(e.estimated, true);
  assert.equal(e.totalW, 1500);
  assert.equal(e.circuits[0].name, 'Dryer');
  assert.equal(e.month, 41.2);
  assert.equal(Math.round(e.monthCost * 100), 1050);
});

test('robot names, errors and litter boxes are read the way they appear in the app', () => {
  const hass = hassFrom([
    { id: 'vacuum.dyson', name: 'Dyson ABC-US-XYZ1234A', state: 'docked', attrs: { battery_level: 100 } },
    { id: 'vacuum.rosie', name: 'Rosie', state: 'error', attrs: { error: 'brush_stuck' } },
    { id: 'vacuum.kitty_corner_litter_box', name: 'Kitty Corner Litter box', state: 'docked', attrs: {} },
  ]);
  const model = buildModel(hass, {}, {}, NOW);
  const dyson = model.robots.find((r) => r.id === 'vacuum.dyson');
  assert.equal(dyson.name, 'Dyson ABC');
  assert.match(dyson.sub, /ABC-US-XYZ1234A/);
  assert.equal(dyson.statusText, 'Docked');
  const litter = model.robots.find((r) => r.litter);
  assert.equal(litter.name, 'Kitty Corner');
  assert.equal(litter.statusText, 'Ready');
  assert.ok(model.alerts.some((a) => a.title === 'Rosie needs help' && a.detail === 'Brush stuck'));
});

test('people fall back to GPS trackers when there are no person entities', () => {
  const hass = hassFrom([
    { id: 'zone.home', name: 'Home', state: '0', attrs: { latitude: 40, longitude: -75, radius: 100 } },
    { id: 'device_tracker.life360_kim', name: 'Kim', state: 'not_home', attrs: { latitude: 40.1, longitude: -75, source_type: 'gps', place: 'Gym', speed: 0 }, platform: 'life360' },
  ]);
  const [kim] = buildModel(hass, {}, {}, NOW).people;
  assert.equal(kim.name, 'Kim');
  assert.equal(personStatus(kim, { metric: false }), 'Gym');
  assert.ok(Math.abs(kim.distKm - 11.1) < 0.2);
  assert.ok(kim.bearing < 1 || kim.bearing > 359, 'due north of home');
});

test('radar markers are pushed apart until their labels clear each other', () => {
  const marks = spreadMarks([{ x: 0, y: 0, fixed: true }, { x: 30, y: 30 }, { x: 34, y: 32 }]);
  const [, a, b] = marks;
  const gap = Math.hypot((a.x - b.x) / 54, (a.y - b.y) / 36);
  assert.ok(gap >= 0.99, `markers still overlap (${gap.toFixed(2)})`);
  assert.deepEqual([marks[0].x, marks[0].y], [0, 0]);
});

test('the map uses keyless tiles unless a CARTO key or custom URL is set', () => {
  const plain = tileLayers();
  assert.equal(plain.length, 2);
  assert.match(plain[0].url, /World_Dark_Gray_Base/);
  const carto = tileLayers({ carto_key: 'abc 123' });
  assert.match(carto[0].url, /rastertiles\/dark_all\/.*\?key=abc%20123$/);
  const custom = tileLayers({ tile_url: 'https://tiles.example.com/{z}/{x}/{y}.png', attribution: 'Example' });
  assert.deepEqual(custom.map((l) => [l.url, l.options.attribution]), [['https://tiles.example.com/{z}/{x}/{y}.png', 'Example']]);
});
