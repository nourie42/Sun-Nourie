import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const backend = fs.readFileSync("src/aiCouncil.js", "utf8");
const html = fs.readFileSync("public/ai-council/bots.html", "utf8");
const homeNavigation = fs.readFileSync("public/home-navigation.js", "utf8");

assert.match(backend, /app\.post\("\/api\/ai-council\/bots\/run"/);
assert.match(backend, /app\.get\(\["\/ai-council\/bots", "\/ai-council\/bots\/"\]/);
assert.match(backend, /AI_COUNCIL_BOT_MAX_TURNS/);
assert.doesNotMatch(backend, /res\.redirect\(302, "\/ai-council\/"\)/);

assert.match(html, /<title>AI Council · Bot Studio<\/title>/);
assert.match(html, /id="botGrid"/);
assert.match(html, /id="runRoomBtn"/);
assert.match(html, /\/api\/ai-council\/bots\/run/);
assert.match(html, /localStorage\.setItem\(STORAGE_KEY/);
assert.match(html, /Create Starter Team/);

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
assert.ok(scripts.length > 0, "Bot Studio must contain client JavaScript");
for (const [index, source] of scripts.entries()) {
  new vm.Script(source, { filename: `public/ai-council/bots.html#script-${index + 1}` });
}

assert.match(homeNavigation, /aiBotStudioTop/);
assert.match(homeNavigation, /\/ai-council\/bots\//);

console.log("AI Council Bot Studio validation passed.");
