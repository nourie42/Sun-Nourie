# Nourie Home

A phone-first dashboard for Home Assistant. It is one JavaScript file with no build step and no HACS dependency. Everything is on one dashboard: the first page has what gets used most, and the tabs at the bottom open the rest.

**Tabs**

| Tab | What it shows |
| --- | --- |
| Home | In order: alerts, the air score, PM0.3 over the last 24 hours for each room, the Quiet / Winix Turbo / Master Fan on and off buttons, a shortcut for each robot, this billing cycle's electric and water bills, and the Oura scores. Thermostats and most-used switches follow |
| Air | The air score and how it was worked out, PM0.3 over 24 hours or 7 days, the PM0.3 spike alert, purifier controls and every room's readings |
| Robots | The Dyson Vis Nav cards as before, a chart of each Vis Nav's dust score, and a room picker for every other vacuum: tap the rooms in the order to clean them, then Clean. The litter box is last |
| Energy | Electric and water: spent so far this billing cycle and the estimated bill at the end of it, with an hour-by-day heat map of electric use |
| Family | Everyone's Life360 location on a dark map, or a radar view by distance and direction from home |
| Health | Oura readiness, sleep, resilience, sick and heart scores, total sleep and ring battery |

Tap a tile to toggle it. Press and hold any tile, person, robot or reading to open Home Assistant's own details for it. The gear button opens **Customize**, where every automatic choice below can be changed from the phone.

### Air score

The score runs from 0 to 100 and is the average of these readings:

- the outdoor AQI (an AQI of 0 scores 100, and 300 or more scores 0);
- PM0.3 in the master bedroom, downstairs and Angel's room (under 100 particles per 0.1 L scores 100, and 20,000 or more scores 0);
- the Winix purifiers' own air quality (good, fair, poor or very poor);
- the Amazon air quality monitor.

"Show the math" lists each reading and what it scored. CO₂ is not shown unless `show_co2: true` is set.

### PM0.3 spike alert

On the Air tab, choose a phone and tap **Turn on phone alerts**. The dashboard saves a Home Assistant automation called *Nourie Home: … PM0.3 spike*. It notifies the phone when the master bedroom's PM0.3 stays over the threshold for 2 minutes while the upstairs climate is heating, cooling or running its fan, then waits 30 minutes before alerting again. The suggested threshold is two and a half times the last day's typical reading. Saving automations needs an admin account.

### Billing cycles

Tap **Billing cycle** on either bill to set the first and last day of the cycle, the price per kWh or per gallon, and any fixed monthly charge. The amounts update straight away. After the last day, the next cycle of the same length starts on its own. Usage comes from Home Assistant's Energy dashboard (the grid consumption and water sources), so those need to be set up under **Settings → Dashboards → Energy**. Until you enter a price, the price or cost set in the Energy dashboard is used.

### Room cleaning

Room cleaning uses Home Assistant's **Clean area** feature. Each robot's rooms need to be matched to Home Assistant areas once: open the robot, choose **Cleaning → By area**, then tap the gear. Reading that list needs an admin account.

## Install

The file is served from this repository through jsDelivr, so nothing has to be copied into Home Assistant. Use a commit link so updates only happen when you choose:

```
https://cdn.jsdelivr.net/gh/nourie42/Sun-Nourie@<commit>/home-assistant/nourie-home.js
```

Replace `<commit>` with a commit hash from this repository (or `main` once this is merged; jsDelivr can take up to 12 hours to notice a new `main`).

### Option 1: a dashboard (works entirely from the phone app)

1. Open your profile (bottom left in Home Assistant) and turn on **Advanced mode**. The Resources page only appears with it on.
2. Go to **Settings → Dashboards**, open the **⋮** menu, choose **Resources**, then **Add resource**. Paste the link above and pick **JavaScript module**.
3. Back in **Settings → Dashboards**, choose **Add dashboard → New dashboard from scratch**. Give it any name that is not already taken, for example *Home HUD*.
4. Open the new dashboard, tap the pencil, open **⋮ → Raw configuration editor** and replace everything with:

   ```yaml
   views:
     - title: Home
       path: home
       type: panel
       cards:
         - type: custom:nourie-home-card
   ```

5. Save. To open it by default on your phone, go to your profile and set **Dashboard** to the new dashboard.

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
| People | Life360 trackers, with their place, address, driving state, speed and battery. Set **People come from** in Customize (or `people_source: person`) to use Home Assistant `person` entities instead |
| Air | Every sensor with a PM0.3, PM1, PM2.5, PM10, VOC, CO, NO₂, ozone or AQI reading, grouped by device, with that device's temperature and humidity. PM0.3 sensors are found by name ("PM0.3", "0.3 µm") |
| Buttons | Scripts or scenes named like "Quiet on" and "Quiet off", the Winix fans (Turbo sets them to 100%, off returns them to Auto) and a fan or switch named "Master fan". Any pair can be changed or added in Customize |
| Oura | Sensors named like readiness, sleep score, resilience, sick score, heart score, total sleep and battery |
| Purifiers | Fans and switches named like purifiers (Winix, Levoit, Coway, "purifier", "ionizer") |
| Bills | The Energy dashboard's grid and water sources, read from Home Assistant's long-term statistics |
| Electric | Emporia Vue sensors (the HACS `emporia_vue` integration): `… Power Minute Average`, `… Energy Today`, `… Energy This Month`. A circuit named Mains, Total or Home is used as the whole-home total; otherwise the circuits are added up |
| Water | The Flume integration's current flow, day, week and month sensors and its leak and high-flow sensors |
| Robots | Every `vacuum` entity, which includes Dyson, Shark, Roborock and the Litter-Robot integration's litter box. Dyson robots and litter boxes keep the standard card; the others get the room picker. Dust score sensors are found by name |
| Most used | The lights, switches, fans and scenes people tapped most in the last five days, read from the logbook. Sirens, child locks and other settings switches are left out |

## Options

Most settings are easiest to change in Customize, which saves them in Home Assistant so every phone sees the same dashboard. Every option below is optional. For a dashboard card, add them under `- type: custom:nourie-home-card`. For the panel, put them under a `config:` key.

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
show_co2: false                # show CO₂ readings on the Air tab
people_source: life360         # or "person"
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
