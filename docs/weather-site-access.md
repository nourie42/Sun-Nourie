# Weather Site Access

Public weather access is disabled by default. The server checks a password before
serving weather pages, static weather assets, comparison pages, and weather APIs,
including the alternate What's Up weather tracker. Unauthenticated requests return
HTTP 401. The `/health` endpoint and unrelated applications remain accessible.

The requested emergency password is represented by a salted scrypt hash in
`src/weatherSiteAccess.js`, never a plaintext password in browser code. A private
`WEATHER_SITE_PASSWORD` environment variable can override that hash.

Successful sign-in creates a signed, HttpOnly, SameSite=Strict cookie lasting 12
hours. Production cookies are Secure. Signing keys are randomly generated at
startup and passed privately to the gateway's child processes. Restarting the
service invalidates sessions unless `WEATHER_SITE_COOKIE_SECRET` is configured.
Multi-instance deployments must share a private signing key. POST
`/weather-fusion/logout` clears the cookie and revokes it in the handling process.

This restriction does not certify forecast or warning accuracy. Public access
should remain restricted until warning coverage and outage behavior have been
independently validated. Content already loaded into an existing browser tab
cannot be remotely withdrawn, but subsequent unauthenticated weather requests
are blocked.
