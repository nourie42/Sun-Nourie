# WeatherNext 3 setup for Experimental Weather

The experimental Weather Nourie page uses Google's hosted WeatherNext 3 statistics. No local GPU is required.

## One-time Google setup

1. Request real-time WeatherNext access: https://developers.google.com/weathernext/guides/access-forecast
2. After approval, subscribe to the WeatherNext 3 BigQuery Analytics Hub listing and link it into a Google Cloud dataset.
3. Confirm the linked table ends in `weathernext_3_0_0_0p1deg`.
4. Create a Google Cloud service account with permission to run BigQuery jobs and read the linked WeatherNext dataset.

## GitHub repository configuration

Add these values to the `nourie42/Sun-Nourie` repository:

- Repository variable `WEATHERNEXT_BQ_TABLE`: full linked table name, for example `my-project.weather_ai.weathernext_3_0_0_0p1deg`.
- Repository secret `WEATHERNEXT_GCP_CREDENTIALS`: service-account JSON used by GitHub Actions.

The `.github/workflows/weathernext3-data.yml` workflow then runs after the main WeatherNext cycles are normally available, queries the hosted 0.1° hourly surface statistics, and publishes `models/weathernext3.json` to the existing `weather-fusion-data` branch.

## Forecast policy

WeatherNext 3 is comparison-only at first. Its temperature, wind, hourly precipitation and ensemble range are displayed on the experimental page, but it contributes zero points to Weather Nourie's current NWS/HRRR/ECMWF/NBM precipitation blend until local verification supports a weighting change.
