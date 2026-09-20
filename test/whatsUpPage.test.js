import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (name) => readFileSync(path.join(root, name), "utf8");

const page = path.join(root, "public", "whats-up", "index.html");
assert.equal(existsSync(page), true, "public/whats-up/index.html exists");

const html = read("public/whats-up/index.html");
assert.match(html, /what's up/i);
assert.match(html, /name="viewport"/);
assert.match(html, /<h1>\s*what's up\s*<\/h1>/i);

const home = read("public/index.html");
assert.match(home, /Sunoco, LP Fuel IQ/);
assert.doesNotMatch(home, /whats-up/);

for (const file of ["server.js", "legacy-server.js"]) {
  const source = read(file);
  assert.match(source, /\["\/whats-up", "\/whats-up\/"\]/);
  assert.match(source, /app\.get\("\/whatsup"/);
  assert.match(source, /public", "whats-up", "index\.html"/);
}
