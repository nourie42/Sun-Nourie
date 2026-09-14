import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync("public/ai-council/chat.html", "utf8");
const nav = fs.readFileSync("public/home-navigation.js", "utf8");

assert.match(html, /<title>AI Bots · Chat<\/title>/);
assert.match(html, /id="botList"/);
assert.match(html, /id="messages"/);
assert.match(html, /id="prompt"/);
assert.match(html, /id="accessCode"/);
assert.match(html, /ai-council-single-chat-v1/);
assert.match(html, /ai-council-bots-v1/);
assert.match(html, /ai-council-bot-activity-v1/);
assert.match(html, /\/api\/ai-council\/ask/);
assert.match(html, /providers:\[currentBot\.provider\]/);
assert.match(html, /location\.href='\/ai-council\/bots\/'/);
assert.match(nav, /aiBotChatTop/);
assert.match(nav, /\/ai-council\/chat\.html/);

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
assert.ok(scripts.length > 0, "Bot Chat must contain client JavaScript");
for (const [index, source] of scripts.entries()) {
  new vm.Script(source, { filename: `public/ai-council/chat.html#script-${index + 1}` });
}

console.log("AI Council one-on-one Bot Chat validation passed.");
