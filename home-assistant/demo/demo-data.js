// A made-up home for trying the dashboard. Every name, place and reading here is fictional.
import { synthHistory } from './mock-hass.js';

const HOME = { lat: 39.7392, lon: -104.9903 };
const e = (id, name, state, attrs = {}, extra = {}) => ({ id, name, state, attrs, ...extra });

const areas = {
  living: { area_id: 'living', name: 'Living Room' },
  kitchen: { area_id: 'kitchen', name: 'Kitchen' },
  primary: { area_id: 'primary', name: 'Primary Bedroom' },
  kids: { area_id: 'kids', name: 'Kids Room' },
  office: { area_id: 'office', name: 'Office' },
  garage: { area_id: 'garage', name: 'Garage' },
  basement: { area_id: 'basement', name: 'Basement' },
};

const devices = {
  aq_living: { id: 'aq_living', name: 'Living Room Air', area_id: 'living', model: 'Air monitor' },
  aq_primary: { id: 'aq_primary', name: 'Primary Bedroom Air', area_id: 'primary', model: 'Air monitor' },
  aq_kids: { id: 'aq_kids', name: 'Kids Room Air', area_id: 'kids', model: 'Air monitor' },
  aq_office: { id: 'aq_office', name: 'Office Air', area_id: 'office', model: 'Air monitor' },
  vue: { id: 'vue', name: 'Emporia Vue', model: 'Vue 3' },
  flume: { id: 'flume', name: 'Flume Sensor', model: 'Flume 2' },
  vac_up: { id: 'vac_up', name: 'Upstairs Vis Nav', area_id: 'primary', model: '360 Vis Nav' },
  vac_down: { id: 'vac_down', name: 'Downstairs Vis Nav', area_id: 'living', model: '360 Vis Nav' },
  litter: { id: 'litter', name: 'Litter-Robot', area_id: 'basement', model: 'Litter-Robot 4' },
};

const at = (dLat, dLon) => ({ latitude: HOME.lat + dLat, longitude: HOME.lon + dLon });

const entities = [
  e('zone.home', 'Home', '1', { ...at(0, 0), radius: 120, icon: 'mdi:home' }),
  e('zone.school', 'School', '1', { ...at(0.021, 0.026), radius: 180 }),
  e('zone.work', 'Work', '0', { ...at(-0.13, 0.22), radius: 220 }),

  e('person.alex', 'Alex Rivera', 'home', { ...at(0.0002, -0.0001), gps_accuracy: 12, source: 'device_tracker.life360_alex', device_trackers: ['device_tracker.life360_alex'] }, { ago: 95 }),
  e('device_tracker.life360_alex', 'Alex Rivera', 'home', { ...at(0.0002, -0.0001), gps_accuracy: 12, source_type: 'gps', battery_level: 82, battery_charging: false, driving: false, speed: 0, place: 'Home', address: '1200 Sample Ave', at_loc_since: new Date(Date.now() - 95 * 60000).toISOString(), last_seen: new Date(Date.now() - 60000).toISOString() }, { platform: 'life360' }),
  e('person.jordan', 'Jordan Rivera', 'not_home', { ...at(-0.061, 0.051), gps_accuracy: 20, source: 'device_tracker.life360_jordan', device_trackers: ['device_tracker.life360_jordan'] }, { ago: 22 }),
  e('device_tracker.life360_jordan', 'Jordan Rivera', 'not_home', { ...at(-0.061, 0.051), gps_accuracy: 20, source_type: 'gps', battery_level: 54, battery_charging: true, driving: true, speed: 38, address: 'I-25 near Evans Ave, Denver', last_seen: new Date(Date.now() - 30000).toISOString() }, { platform: 'life360' }),
  e('person.sam', 'Sam Rivera', 'School', { ...at(0.0211, 0.0262), gps_accuracy: 15, source: 'device_tracker.life360_sam', device_trackers: ['device_tracker.life360_sam'] }, { ago: 300 }),
  e('device_tracker.life360_sam', 'Sam Rivera', 'School', { ...at(0.0211, 0.0262), gps_accuracy: 15, source_type: 'gps', battery_level: 12, battery_charging: false, driving: false, speed: 0, place: 'School', address: '400 Example St', at_loc_since: new Date(Date.now() - 300 * 60000).toISOString(), last_seen: new Date(Date.now() - 240000).toISOString() }, { platform: 'life360' }),
  e('person.riley', 'Riley Rivera', 'Work', { ...at(-0.1301, 0.2203), gps_accuracy: 25, source: 'device_tracker.life360_riley', device_trackers: ['device_tracker.life360_riley'] }, { ago: 420 }),
  e('device_tracker.life360_riley', 'Riley Rivera', 'Work', { ...at(-0.1301, 0.2203), gps_accuracy: 25, source_type: 'gps', battery_level: 67, driving: false, speed: 0, place: 'Work', address: '9 Placeholder Pkwy', at_loc_since: new Date(Date.now() - 420 * 60000).toISOString(), last_seen: new Date(Date.now() - 120000).toISOString() }, { platform: 'life360' }),

  e('weather.forecast_home', 'Forecast Home', 'partlycloudy', { temperature: 64, apparent_temperature: 62, humidity: 41, dew_point: 40, wind_speed: 7, wind_speed_unit: 'mph', temperature_unit: '°F', supported_features: 3 }),

  e('sensor.living_room_air_co2', 'Living Room Air CO2', 612, { device_class: 'carbon_dioxide', unit_of_measurement: 'ppm' }, { device: 'aq_living' }),
  e('sensor.living_room_air_pm25', 'Living Room Air PM2.5', 4.2, { device_class: 'pm25', unit_of_measurement: 'µg/m³' }, { device: 'aq_living' }),
  e('sensor.living_room_air_voc', 'Living Room Air VOC', 180, { device_class: 'volatile_organic_compounds_parts', unit_of_measurement: 'ppb' }, { device: 'aq_living' }),
  e('sensor.living_room_air_temperature', 'Living Room Air Temperature', 71.6, { device_class: 'temperature', unit_of_measurement: '°F' }, { device: 'aq_living' }),
  e('sensor.living_room_air_humidity', 'Living Room Air Humidity', 44, { device_class: 'humidity', unit_of_measurement: '%' }, { device: 'aq_living' }),
  e('sensor.primary_bedroom_air_co2', 'Primary Bedroom Air CO2', 1180, { device_class: 'carbon_dioxide', unit_of_measurement: 'ppm' }, { device: 'aq_primary' }),
  e('sensor.primary_bedroom_air_pm25', 'Primary Bedroom Air PM2.5', 2.1, { device_class: 'pm25', unit_of_measurement: 'µg/m³' }, { device: 'aq_primary' }),
  e('sensor.primary_bedroom_air_temperature', 'Primary Bedroom Air Temperature', 69.8, { device_class: 'temperature', unit_of_measurement: '°F' }, { device: 'aq_primary' }),
  e('sensor.primary_bedroom_air_humidity', 'Primary Bedroom Air Humidity', 48, { device_class: 'humidity', unit_of_measurement: '%' }, { device: 'aq_primary' }),
  e('sensor.kids_room_air_co2', 'Kids Room Air CO2', 540, { device_class: 'carbon_dioxide', unit_of_measurement: 'ppm' }, { device: 'aq_kids' }),
  e('sensor.kids_room_air_pm25', 'Kids Room Air PM2.5', 16.4, { device_class: 'pm25', unit_of_measurement: 'µg/m³' }, { device: 'aq_kids' }),
  e('sensor.kids_room_air_temperature', 'Kids Room Air Temperature', 72.4, { device_class: 'temperature', unit_of_measurement: '°F' }, { device: 'aq_kids' }),
  e('sensor.kids_room_air_humidity', 'Kids Room Air Humidity', 63, { device_class: 'humidity', unit_of_measurement: '%' }, { device: 'aq_kids' }),
  e('sensor.office_air_co2', 'Office Air CO2', 735, { device_class: 'carbon_dioxide', unit_of_measurement: 'ppm' }, { device: 'aq_office' }),
  e('sensor.office_air_pm25', 'Office Air PM2.5', 6.8, { device_class: 'pm25', unit_of_measurement: 'µg/m³' }, { device: 'aq_office' }),
  e('sensor.office_air_temperature', 'Office Air Temperature', 73.1, { device_class: 'temperature', unit_of_measurement: '°F' }, { device: 'aq_office' }),

  e('fan.primary_purifier', 'Primary Purifier', 'on', { percentage: 50, percentage_step: 25, preset_mode: 'Auto', preset_modes: ['Auto', 'Manual', 'Sleep'], supported_features: 57 }, { area: 'primary', platform: 'winix' }),
  e('fan.kids_purifier', 'Kids Purifier', 'off', { percentage: 0, percentage_step: 25, preset_modes: ['Auto', 'Manual', 'Sleep'], supported_features: 57 }, { area: 'kids', platform: 'winix' }),
  e('fan.primary_ceiling_fan', 'Primary Ceiling Fan', 'on', { percentage: 100, supported_features: 49 }, { area: 'primary' }),
  e('light.kitchen', 'Kitchen Lights', 'on', { brightness: 204 }, { area: 'kitchen', ago: 40 }),
  e('light.living_room_lamps', 'Living Room Lamps', 'off', {}, { area: 'living', ago: 300 }),
  e('light.porch', 'Porch Light', 'on', { brightness: 255 }, { ago: 12 }),
  e('switch.office_desk', 'Office Desk', 'on', { device_class: 'outlet' }, { area: 'office', ago: 70 }),
  e('switch.basement_dehumidifier', 'Basement Dehumidifier', 'on', { device_class: 'outlet' }, { area: 'basement', ago: 600 }),
  e('switch.garage_siren', 'Garage Siren', 'off', {}, { area: 'garage' }),
  e('switch.primary_purifier_child_lock', 'Primary Purifier Child Lock', 'off', {}, { area: 'primary', category: 'config' }),
  e('scene.movie_night', 'Movie Night', '2026-10-15T20:10:00Z', {}),

  e('climate.living_room', 'Living Room', 'cool', { current_temperature: 75.5, temperature: 74, hvac_action: 'cooling', hvac_modes: ['off', 'heat', 'cool', 'heat_cool'], min_temp: 50, max_temp: 90, target_temp_step: 1, current_humidity: 46 }, { area: 'living' }),
  e('climate.upstairs', 'Upstairs', 'heat_cool', { current_temperature: 71, target_temp_low: 68, target_temp_high: 75, hvac_action: 'idle', hvac_modes: ['off', 'heat', 'cool', 'heat_cool'], min_temp: 50, max_temp: 90 }, { area: 'primary' }),

  e('binary_sensor.front_door', 'Front Door', 'off', { device_class: 'door' }, { ago: 35 }),
  e('binary_sensor.back_door', 'Back Door', 'off', { device_class: 'door' }, { ago: 180 }),
  e('binary_sensor.garage_door', 'Garage Door', 'on', { device_class: 'garage_door' }, { ago: 14 }),
  e('binary_sensor.basement_leak', 'Basement Leak Sensor', 'off', { device_class: 'moisture' }, { area: 'basement' }),

  e('sensor.emporia_vue_power_minute_average', 'Emporia Vue Power Minute Average', 1840, { device_class: 'power', unit_of_measurement: 'W' }, { platform: 'emporia_vue', device: 'vue' }),
  e('sensor.emporia_vue_energy_today', 'Emporia Vue Energy Today', 23.4, { device_class: 'energy', unit_of_measurement: 'kWh' }, { platform: 'emporia_vue', device: 'vue' }),
  e('sensor.emporia_vue_energy_this_month', 'Emporia Vue Energy This Month', 412, { device_class: 'energy', unit_of_measurement: 'kWh' }, { platform: 'emporia_vue', device: 'vue' }),
  ...[
    ['air_conditioner', 'Air Conditioner', 1120, 9.8, 188],
    ['kitchen', 'Kitchen', 236, 3.1, 61],
    ['office', 'Office', 142, 1.9, 40],
    ['refrigerator', 'Refrigerator', 96, 1.4, 38],
    ['lighting', 'Lighting', 84, 0.9, 22],
    ['dryer', 'Dryer', 0, 2.6, 31],
    ['washer', 'Washer', 0, 0.4, 7],
    ['water_heater', 'Water Heater', 0, 2.2, 52],
    ['ev_charger', 'EV Charger', 0, 0, 120],
  ].flatMap(([key, label, watts, today, month]) => [
    e(`sensor.${key}_power_minute_average`, `${label} Power Minute Average`, watts, { device_class: 'power', unit_of_measurement: 'W' }, { platform: 'emporia_vue', device: 'vue' }),
    e(`sensor.${key}_energy_today`, `${label} Energy Today`, today, { device_class: 'energy', unit_of_measurement: 'kWh' }, { platform: 'emporia_vue', device: 'vue' }),
    e(`sensor.${key}_energy_this_month`, `${label} Energy This Month`, month, { device_class: 'energy', unit_of_measurement: 'kWh' }, { platform: 'emporia_vue', device: 'vue' }),
  ]),
  e('switch.emporia_garage_freezer', 'Garage Freezer Plug', 'on', { device_class: 'outlet' }, { platform: 'emporia_vue' }),
  e('sensor.electric_cost_this_month', 'Electric Cost This Month', 58.41, { device_class: 'monetary', unit_of_measurement: '$' }),

  e('sensor.flume_sensor_current', 'Flume Sensor Current', 0, { unit_of_measurement: 'gal/m', device_class: 'volume_flow_rate' }, { platform: 'flume', device: 'flume', key: 'current_interval' }),
  e('sensor.flume_sensor_current_day', 'Flume Sensor Current day', 142, { unit_of_measurement: 'gal', device_class: 'water' }, { platform: 'flume', device: 'flume', key: 'today' }),
  e('sensor.flume_sensor_current_week', 'Flume Sensor Current week', 986, { unit_of_measurement: 'gal', device_class: 'water' }, { platform: 'flume', device: 'flume', key: 'week_to_date' }),
  e('sensor.flume_sensor_current_month', 'Flume Sensor Current month', 3410, { unit_of_measurement: 'gal', device_class: 'water' }, { platform: 'flume', device: 'flume', key: 'month_to_date' }),
  e('binary_sensor.flume_sensor_leak_detected', 'Flume Sensor Leak detected', 'off', { device_class: 'problem' }, { platform: 'flume', device: 'flume', key: 'leak', category: 'diagnostic' }),
  e('binary_sensor.flume_sensor_high_flow', 'Flume Sensor High flow', 'off', { device_class: 'problem' }, { platform: 'flume', device: 'flume', key: 'flow', category: 'diagnostic' }),

  e('vacuum.upstairs_vis_nav', 'Upstairs Vis Nav', 'docked', { battery_level: 100, fan_speed: 'Auto', fan_speed_list: ['Quiet', 'Auto', 'Boost'], supported_features: 14204 }, { device: 'vac_up' }),
  e('sensor.upstairs_vis_nav_last_clean', 'Upstairs Vis Nav Last clean area', 612, { unit_of_measurement: 'ft²' }, { device: 'vac_up' }),
  e('vacuum.downstairs_vis_nav', 'Downstairs Vis Nav', 'cleaning', { battery_level: 64, fan_speed: 'Boost', fan_speed_list: ['Quiet', 'Auto', 'Boost'], supported_features: 14204 }, { device: 'vac_down' }),
  e('sensor.downstairs_vis_nav_cleaned_area', 'Downstairs Vis Nav Cleaned area', 238, { unit_of_measurement: 'ft²' }, { device: 'vac_down' }),
  e('vacuum.litter_robot', 'Litter-Robot Litter box', 'docked', { status: 'Ready' }, { device: 'litter', platform: 'litterrobot' }),
  e('sensor.litter_robot_waste_drawer', 'Litter-Robot Waste drawer', 46, { unit_of_measurement: '%' }, { device: 'litter', platform: 'litterrobot' }),

  e('todo.shopping_list', 'Shopping List', 5, {}),
  e('todo.hardware_store', 'Hardware Store', 2, {}),
];

const forecast = (type) => {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const conditions = ['partlycloudy', 'partlycloudy', 'cloudy', 'rainy', 'rainy', 'cloudy', 'clear-night', 'clear-night', 'clear-night', 'sunny'];
  return conditions.map((condition, i) => ({
    datetime: new Date(now.getTime() + (i + 1) * (type === 'hourly' ? 3600000 : 86400000)).toISOString(),
    condition,
    temperature: Math.round(64 - i * 1.4 + (i > 7 ? 4 : 0)),
    precipitation_probability: condition === 'rainy' ? 60 : condition === 'cloudy' ? 20 : 0,
  }));
};

export const demoHome = {
  areas,
  devices,
  entities,
  user: { name: 'Alex Rivera' },
  config: { latitude: HOME.lat, longitude: HOME.lon, unit_system: { temperature: '°F', length: 'mi' } },
  forecast,
  history: synthHistory,
  logbook: () => [
    ...Array(14).fill({ entity_id: 'light.kitchen', context_user_id: 'u' }),
    ...Array(11).fill({ entity_id: 'fan.primary_purifier', context_user_id: 'u' }),
    ...Array(9).fill({ entity_id: 'switch.office_desk', context_user_id: 'u' }),
    ...Array(6).fill({ entity_id: 'light.porch', context_user_id: 'u' }),
    ...Array(4).fill({ entity_id: 'fan.primary_ceiling_fan', context_user_id: 'u' }),
    ...Array(3).fill({ entity_id: 'scene.movie_night', context_user_id: 'u' }),
    ...Array(2).fill({ entity_id: 'light.living_room_lamps', context_user_id: 'u' }),
    ...Array(30).fill({ entity_id: 'switch.basement_dehumidifier' }),
  ],
};
