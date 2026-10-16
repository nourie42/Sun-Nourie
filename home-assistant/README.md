# Nourie Home

A phone-first dashboard for Home Assistant, built around the things used most: air quality, a live family map from Life360, Emporia electric use, Flume water use and the Dyson robots. It is one JavaScript file with no build step and no HACS dependency.

**Tabs**

| Tab | What it shows |
| --- | --- |
| Home | Greeting and clock, outdoor conditions and the hourly forecast, a live "home flow" of power, water, air and who is home, alerts, room air at a glance, family, robots, your most-used switches, thermostats, lists and cameras |
| Air | An air score for the house, advice ("Open a window in the bedroom"), every room's CO₂ / PM2.5 / VOC with a 24-hour trend, and purifier controls |
| Map | Everyone's location on a dark map with accuracy rings and zones, or a radar view by distance and direction from home. Each person's card shows place, time there, distance, speed while driving and phone battery |
| Energy | Whole-home power right now and over 24 hours, today's and this month's kWh and cost, every Emporia circuit ranked by draw, Emporia smart plugs, then Flume flow, today / week / month gallons and a leak status |
| Robots | Each vacuum with battery, status, Clean / Pause / Dock / Find, suction level and its extra sensors, plus the litter box. Start all and Dock all buttons |

Tap a tile to toggle it. Press and hold any tile, person, robot or reading to open Home Assistant's own details for it.

## Install

The file is served from this repository through jsDelivr, so nothing has to be copied into Home Assistant. Use a commit link so updates only happen when you choose:

```
https://cdn.jsdelivr.net/gh/nourie42/Sun-Nourie@<commit>/home-assistant/nourie-home.js
```

Replace `<commit>` with a commit hash from this repository (or `main` once this is merged; jsDelivr can take up to 12 hours to notice a new `main`).

### Option 1: a dashboard (works entirely from the phone app)

1. Open your profile (bottom left in Home Assistant) and turn on **Advanced mode**. The Resources page only appears with it on.
2. Go to **Settings → Dashboards**, open the **⋮** menu, choose **Resources**, then **Add resource**. Paste the link above and pick **JavaScript module**.
3. Back in **Settings → Dashboards**, choose **Add dashboard → New dashboard from scratch**. Name it *Nourie Home*.
4. Open the new dashboard, tap the pencil, open **⋮ → Raw configuration editor** and replace everything with:

   ```yaml
   views:
     - title: Home
       path: home
       type: panel
       cards:
         - type: custom:nourie-home-card
   ```

5. Save. To open it by default on your phone, go to your profile and set **Dashboard** to *Nourie Home*.

### Option 2: a full-screen sidebar panel

This hides Home Assistant's own top bar, so the dashboard uses the whole screen. Add this to `configuration.yaml` and restart Home Assistant:

```yaml
panel_custom:
  - name: nourie-home-panel
    url_path: nourie-home
    sidebar_title: Nourie Home
    sidebar_icon: mdi:home-heart
    module_url: https://cdn.jsdelivr.net/gh/nourie42/Sun-Nourie@<commit>/home-assistant/nourie-home.js
```

To keep the file inside Home Assistant instead, copy `nourie-home.js` to `/config/www/` and use `module_url: /local/nourie-home.js`.

## What it finds on its own

| Section | Where the data comes from |
| --- | --- |
| People | `person` entities. When a person has a Life360 tracker, its place, address, driving state, speed and battery are used too. Without person entities it falls back to any GPS tracker |
| Air | Every sensor with a CO₂, PM1, PM2.5, PM10, VOC, CO, NO₂, ozone or AQI device class, grouped by device, with that device's temperature and humidity |
| Purifiers | Fans and switches named like purifiers (Winix, Levoit, Coway, "purifier", "ionizer") |
| Electric | Emporia Vue sensors (the HACS `emporia_vue` integration): `… Power Minute Average`, `… Energy Today`, `… Energy This Month`. A circuit named Mains, Total or Home is used as the whole-home total; otherwise the circuits are added up |
| Water | The Flume integration's current flow, day, week and month sensors and its leak and high-flow sensors |
| Robots | Every `vacuum` entity, which includes Dyson, Shark, Roborock and the Litter-Robot integration's litter box |
| Most used | The lights, switches, fans and scenes people tapped most in the last five days, read from the logbook. Sirens, child locks and other settings switches are left out |

## Options

Every option is optional. For a dashboard card, add them under `- type: custom:nourie-home-card`. For the panel, put them under a `config:` key.

```yaml
name: Alex                     # name in the greeting (defaults to your Home Assistant user)
exclude:                       # hide entities anywhere on the dashboard
  - sensor.garage_co2
people: [person.alex, person.jordan]
air_quality: [sensor.bedroom_co2, sensor.bedroom_pm2_5]
purifiers: [fan.bedroom_purifier, switch.ionizer]
favorites: [fan.bedroom_purifier, switch.office_desk, light.kitchen]
climate: [climate.living_room, climate.upstairs]
robots: [vacuum.upstairs_vis_nav, vacuum.downstairs_vis_nav]
energy:
  power: sensor.home_power_minute_average   # whole-home power
  today: sensor.home_energy_today
  month: sensor.home_energy_this_month
water:
  flow: sensor.flume_sensor_current
  today: sensor.flume_sensor_current_day
weather: weather.forecast_home
outdoor:                       # a weather station's own readings, if you have one
  temperature: sensor.backyard_station_temperature
  feels_like: sensor.backyard_station_feels_like
  humidity: sensor.backyard_station_humidity
cameras: [camera.front_door]
lists: [todo.shopping_list]
map:
  carto_key: YOUR_FREE_CARTO_KEY   # optional, see below
```

### Map tiles

CARTO, the map style Home Assistant used to use, has required a free key since August 2026. Without one its tiles show an "API key required" watermark. This dashboard uses Esri's keyless dark map instead. To use CARTO's dark map, request a free key at [carto.com/basemaps/apikey](https://carto.com/basemaps/apikey/) and add it as `map.carto_key`. Any other tile server works with `map.tile_url` (a `{z}/{x}/{y}` template) and `map.attribution`.

## Privacy

Everything runs in your browser or the Home Assistant app, using the session you are already signed in with. It never sends your data anywhere. It loads fonts from Google Fonts, the Leaflet map library from cdnjs and map images from Esri (or CARTO, if you add a key).

## Trying it without Home Assistant

`demo/index.html` runs the dashboard against a made-up home. Serve the repository root (for example `python3 -m http.server`) and open `/home-assistant/demo/`. Add `?card` to see it as a dashboard card under a toolbar.

The logic is covered by `test/nourieHome.test.js` (`node --test test/nourieHome.test.js`).
