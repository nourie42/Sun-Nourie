# Distributor Intelligence routing fix

The public Render entrypoint is now `server.js`. It registers Distributor Intelligence API routes before proxying legacy Fuel IQ traffic to `legacy-server.js`.

## User flow

1. Open `/distributors.html`.
2. Start typing a distributor name.
3. Select a company identity returned by `/api/distributors/search`.
4. Run the full ChatGPT public-source report.
5. Export the report to Word, JSON, or Print/PDF.

The compatibility entrypoint `server-with-distributor.js` imports the canonical `server.js`, so either historical Render start command reaches the same application.
