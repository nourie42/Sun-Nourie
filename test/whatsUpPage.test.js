import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (name) => readFileSync(path.join(root, name), "utf8");

const page = path.join(root, "public", "whats-up", "index.html");
assert.equal(existsSync(page), true, "public/whats-up/index.html exists");
assert.equal(existsSync(path.join(root, "public", "whats-up", "tracker.js")), true);
assert.equal(existsSync(path.join(root, "public", "whats-up", "tracker.css")), true);

const html = read("public/whats-up/index.html");
assert.match(html, /what's up/i);
assert.match(html, /name="viewport"/);
assert.match(html, /id="zip"/);
assert.match(html, /id="storm"/);
assert.match(html, /Perfect weather/);
assert.match(html, /weather-fusion\/style\.css/);
assert.doesNotMatch(html, /Just checking in/);
assert.doesNotMatch(html, /href="\/"/);
assert.doesNotMatch(html, /href="\/weather-fusion\/"/);

const client = read("public/whats-up/tracker.js");
assert.match(client, /localStorage/);
assert.match(client, /\/api\/whats-up\/tracker/);
assert.match(client, /whats-up-zip/);
assert.match(client, /Perfect weather alert/);
assert.match(client, /High rain chance alert/);
assert.doesNotMatch(client, /AT A GLANCE/);
assert.doesNotMatch(client, /NEXT PLEASANT STRETCH/);
assert.doesNotMatch(client, /Pleasant stretch/);
assert.match(client, /Dewpoint/);
assert.match(client, /<svg/);
assert.doesNotMatch(client, /EXECUTIVE SUMMARY/);
assert.doesNotMatch(client, /Rule A|Rule B/);
assert.doesNotMatch(client, /How hours are classified/);
assert.doesNotMatch(client, /dewpoint must all qualify/);

const home = read("public/index.html");
assert.match(home, /Sunoco, LP Fuel IQ/);
assert.doesNotMatch(home, /whats-up/);
assert.doesNotMatch(home, /perfect-weather-alert/);
assert.doesNotMatch(home, /weather-alert-banner/);
assert.doesNotMatch(home, /Click for Details/);
assert.doesNotMatch(home, /risk-outlooks|outlook-dialog/);

const weather = read("public/weather-fusion/index.html");
assert.doesNotMatch(weather, /weather-alert-banner/);
assert.doesNotMatch(weather, /id="perfect-weather-banner"/);
assert.doesNotMatch(weather, /id="storm-weather-banner"/);
assert.match(weather, /id="experimental-whats-up-link" href="\/whats-up"/);
assert.match(weather, /Perfect weather tracker/);
assert.doesNotMatch(home, /href="\/whats-up"/);

const routes = read("src/whatsUpRoutes.js");
assert.match(routes, /\['\/whats-up', '\/whats-up\/'\]/);
assert.match(routes, /app\.get\('\/whatsup'/);
assert.match(routes, /public', 'whats-up'/);
assert.match(routes, /index\.html/);

for (const file of ["server.js", "legacy-server.js"]) {
  const source = read(file);
  if (file === "legacy-server.js") {
    assert.match(source, /\["\/whats-up", "\/whats-up\/"\]/);
    assert.match(source, /app\.get\("\/whatsup"/);
    assert.match(source, /public", "whats-up", "index\.html"/);
  } else {
    assert.match(source, /registerWhatsUpRoutes/);
    assert.match(source, /registerWeatherFusionRoutes/);
    assert.doesNotMatch(source, /href: ['"]\/whats-up/);
  }
}
