import express from 'express';
import { fileURLToPath } from 'node:url';
import { registerWeatherFusionRoutes } from './src/weatherFusion.js';
import { registerWeatherSiteAccess } from './src/weatherSiteAccess.js';

if (!process.env.WEATHER_SITE_PASSWORD) {
  throw new Error('WEATHER_SITE_PASSWORD is required for the analytics deployment.');
}

const app = express();
app.disable('x-powered-by');
app.get('/healthz', (_req, res) => res.sendStatus(200));
app.get('/', (_req, res) => res.redirect('/weather-fusion/analytics.html'));
registerWeatherSiteAccess(app, { publicMain: false });
app.use(express.json({ limit: '2kb' }));
registerWeatherFusionRoutes(app);
app.use('/weather-fusion', express.static(fileURLToPath(new URL('./public/weather-fusion', import.meta.url))));
app.listen(Number(process.env.PORT || 3000), '0.0.0.0');
