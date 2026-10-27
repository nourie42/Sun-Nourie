import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync("public/ai-council/grok.html", "utf8");
const client = fs.readFileSync("public/ai-council/grok.js", "utf8");
const server = fs.readFileSync("src/aiHub.js", "utf8");

assert.match(html, /<title>My AIs<\/title>/);
for (const id of ["botList", "groupItem", "messages", "prompt", "sendBtn", "stopBtn", "webBtn", "thinkBtn", "accessCode", "memberChips", "roundChips"]) {
  assert.match(html, new RegExp(`id="${id}"`), `grok.html is missing #${id}`);
}
assert.match(client, /\/api\/ai-council\/hub\/status/);
assert.match(client, /\/api\/ai-council\/hub\/chat/);
assert.match(client, /\/api\/ai-council\/hub\/room-turn/);
assert.match(client, /let webOn = false;/, "web search must be off by default");
assert.match(client, /let deepOn = false;/, "deep thinking must be off by default");
for (const name of ["Grok", "Muse", "Claude", "ChatGPT"]) assert.match(server, new RegExp(`name: "${name}"`));
assert.doesNotMatch(server, /probeProvider|Reply only with OK/, "My AIs must not send availability probes");
assert.match(server, /MUSE_BASE_URL/);

console.log("My AIs page validation passed.");
