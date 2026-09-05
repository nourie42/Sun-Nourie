/** Optional launcher. Existing server.js, package.json and website files stay unchanged. */
import express from 'express';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { registerWeatherFusionRoutes } from './src/weatherFusion.js';
import { createWeatherGateway, gatewayPorts } from './src/weatherFusionGateway.js';

const root = fileURLToPath(new URL('./', import.meta.url));
const { publicPort, sitePort, legacyPort } = gatewayPorts();
const weather = express();
weather.disable('x-powered-by');
registerWeatherFusionRoutes(weather);
weather.get('/weather-fusion/index.html', (_req, res) => res.redirect(302, '/weather-fusion/'));
weather.use((_req, res) => res.status(404).json({ error: 'Weather Fusion route not found.' }));
const gateway = createWeatherGateway({ sitePort, weatherHandler: weather });

// Start exactly the original application, with its original environment and code.
// Only its listening ports are moved behind the weather front door.
const site = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
  cwd: root,
  env: { ...process.env, PORT: String(sitePort), LEGACY_PORT: String(legacyPort) },
  stdio: ['ignore', 'inherit', 'inherit'],
});
let stopping = false;
let serverClosed = false;
let siteClosed = false;
let exitCode = 0;
function finish() { if (serverClosed && siteClosed) process.exit(exitCode); }
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true; exitCode = code;
  gateway.server.close(() => { serverClosed = true; finish(); });
  if (site.exitCode !== null || site.signalCode !== null) siteClosed = true;
  else site.kill('SIGTERM');
  // The original launcher gets its own eight-second graceful shutdown window.
  setTimeout(() => {
    gateway.destroyConnections();
    if (!siteClosed) site.kill('SIGKILL');
    process.exit(exitCode);
  }, 12000).unref();
  finish();
}
site.once('error', (error) => {
  console.error('Weather Fusion could not start the existing website:', error.message);
  siteClosed = true; shutdown(1);
});
site.once('exit', (code, signal) => {
  siteClosed = true;
  if (!stopping) {
    console.error(`Existing website exited (code=${code}, signal=${signal}); stopping the weather launcher.`);
    shutdown(code || 1);
  }
  finish();
});
gateway.server.once('error', (error) => {
  console.error('Weather Fusion could not listen:', error.message);
  shutdown(1);
});
gateway.server.listen(publicPort, '0.0.0.0', () => {
  console.log(`Weather Fusion added at /weather-fusion/ on port ${publicPort}; existing website remains unchanged.`);
});
process.once('SIGTERM', () => shutdown());
process.once('SIGINT', () => shutdown());
