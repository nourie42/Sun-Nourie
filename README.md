# Weather Nourie shared settings

`weather-feels-like.json` is read by **both** the main site and the prerelease site
(about every 5 minutes). Edit it here, commit, and both sites follow. No redeploy needed.

## currentConditionsSource

| Value | What every city shows as "now" (air, wind, feels like) |
|---|---|
| `hourly-blend` (default) | The same hourly forecast blend the hourly cards use. Identical method for every city, as Knightdale already worked. |
| `station-when-accepted` | A nearby airport/station observation when it is fresh, close and agrees with the forecast; otherwise the hourly blend. |

Keep the quotes exactly as written. If the file is missing, unreachable or has a typo,
the sites keep the last good value (or `hourly-blend` if they have never read one), so a
bad edit cannot break the weather pages.

To confirm what a site is using, open its forecast API response and look at `feelsMethod`
(`status` is `remote` when it read this file, `last-good` or `default` when it could not).
