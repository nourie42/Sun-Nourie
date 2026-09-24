# WeatherNext 3 setup for Experimental Weather

The experimental Weather Nourie page uses Google's hosted WeatherNext 3 surface statistics. No local GPU is required. WeatherNext remains comparison-only until it has been validated against the site's existing forecast blend.

## One-time Google setup

1. Request real-time WeatherNext access at https://developers.google.com/weathernext/guides/access-forecast.
2. After approval, open the WeatherNext 3 BigQuery Analytics Hub listing and subscribe it into the Google Cloud project that will run the query.
3. Create a linked dataset and confirm that it contains the table `weathernext_3_0_0_0p1deg`.
4. Create a dedicated service account for the GitHub workflow.
5. Grant that service account:
   - `roles/bigquery.jobUser` on the Google Cloud project that runs the queries.
   - `roles/bigquery.dataViewer` on the linked WeatherNext dataset (or the narrowest scope that permits the linked table to be queried).
6. Create a JSON key for only that dedicated service account. Treat the JSON as a secret.

Google currently distributes WeatherNext 3 BigQuery data as linked Analytics Hub datasets. The 0.1-degree table contains hourly surface ensemble statistics including temperature, 10 m wind and 1-hour precipitation.

## GitHub repository configuration

In `nourie42/Sun-Nourie`, add:

- Repository variable `WEATHERNEXT_BQ_TABLE`: the fully qualified linked table name, for example `my-project.weather_ai.weathernext_3_0_0_0p1deg`.
- Repository secret `WEATHERNEXT_GCP_CREDENTIALS`: the dedicated service-account JSON.

Do not paste the service-account JSON into source code, issues, commits, Actions variables, or the website.

The `.github/workflows/weathernext3-data.yml` workflow then queries the latest completed 00/06/12/18 UTC WeatherNext 3 run and publishes a compact point feed to:

`weather-fusion-data/models/weathernext3.json`

The site reads that file only on `/weather-fusion/experimental-weather.html`.

## First-run verification

After the variable and secret are present:

1. Open **Actions → WeatherNext 3 point forecast data**.
2. Run **Run workflow**.
3. Confirm the job completes successfully.
4. Confirm `models/weathernext3.json` exists on the `weather-fusion-data` branch.
5. Open the Experimental Weather page and expand **Why this forecast**.
6. The WeatherNext card should change from **Awaiting Google feed** to **Connected feed**, display the latest run time, and show hourly temperature, wind, precipitation, and ensemble ranges.

If the selected location is outside the currently published WeatherNext point list, the experimental page will say the feed is connected but that the location is not covered. The normal Weather Nourie forecast remains unchanged.

## Forecast policy

WeatherNext 3 contributes zero points to the existing NWS/HRRR/ECMWF/NBM precipitation blend while it is being evaluated. Its data is shown as a separate experimental comparison. It must never silently replace NWS probabilities or turn ensemble precipitation amounts into an invented probability of precipitation.
