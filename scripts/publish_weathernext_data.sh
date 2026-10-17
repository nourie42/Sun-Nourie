#!/usr/bin/env bash
set -euo pipefail
cd "$WEATHER_DATA_DIR"
for file in models/weathernext-full.json models/weathernext-full-cost-stop.json; do
  if test -f "$file"; then git add -- "$file"; fi
done
git diff --cached --quiet && exit 0
git commit -m 'Update verified WeatherNext feed and billing safety status'
for attempt in 1 2 3 4 5; do
  git fetch origin weather-fusion-data
  git rebase FETCH_HEAD
  if git push origin HEAD:weather-fusion-data; then exit 0; fi
  sleep 3
done
exit 1
