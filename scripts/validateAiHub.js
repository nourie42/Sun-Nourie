import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync("public/ai-council/hub.html", "utf8");
const server = fs.readFileSync("src/aiHub.js", "utf8");

assert.match(html, /<title>My AIs<\/title>/);
assert.match(html, /my-ais-hub-v1/);
assert.match(html, /\/api\/ai-council\/hub\/status/);
assert.match(html, /\/api\/ai-council\/hub\/chat/);
assert.match(html, /x-ai-council-code/);
for (const name of ["Grok", "Muse", "Claude", "ChatGPT"]) assert.match(server, new RegExp(`name: "${name}"`));
assert.match(server, /MUSE_API_KEY/);
assert.match(server, /MUSE_BASE_URL/);

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
assert.ok(scripts.length > 0, "My AIs page must contain client JavaScript");
for (const [index, source] of scripts.entries()) {
  new vm.Script(source, { filename: `public/ai-council/hub.html#script-${index + 1}` });
}

console.log("My AIs hub validation passed.");
