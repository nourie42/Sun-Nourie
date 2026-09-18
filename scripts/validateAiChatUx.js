import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";

process.env.AI_COUNCIL_ACCESS_CODE = "ux-smoke-test-code";
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_AI_API_KEY;
delete process.env.XAI_API_KEY;

const { registerAiAgentRoutes } = await import("../src/aiAgent.js");
const { registerAiCouncilRoutes } = await import("../src/aiCouncil.js");

const index = fs.readFileSync("public/ai-council/index.html", "utf8");
const main = fs.readFileSync("public/ai-council/main-chat-v2.js", "utf8");
const botsHtml = fs.readFileSync("public/ai-council/bots-v2.html", "utf8");
const botsJs = fs.readFileSync("public/ai-council/bots-v2.js", "utf8");
const agent = fs.readFileSync("src/aiAgent.js", "utf8");

assert.match(index, /id="bestModeBtn"/);
assert.match(index, /id="chooseModelBtn"/);
assert.match(index, /id="newChatBtn"/);
assert.match(index, /id="settingsBtn"/);
assert.match(index, /id="checkModelsBtn"/);
assert.match(main, /provider-health/);
assert.match(main, /bestModeBtn.*addEventListener/s);
assert.match(main, /newChatBtn.*addEventListener/s);
assert.match(main, /settingsBtn.*addEventListener/s);
assert.match(main, /checkModelsBtn.*addEventListener/s);
assert.match(botsHtml, /href="\/ai-council\/\?view=council"/);
assert.doesNotMatch(botsHtml, /id="councilPanel"/);
assert.match(botsJs, /addBotBtn\.classList\.toggle\('hidden', view !== 'bots'\)/);
assert.match(agent, /\/api\/ai-agent\/provider-health/);
assert.match(agent, /status: "no_credits"/);
assert.match(agent, /probeProvider/);
assert.match(agent, /ANTHROPIC_WORKSPACE_ID/);
assert.match(agent, /anthropic-workspace-id/);

const app = express();
registerAiAgentRoutes(app);
registerAiCouncilRoutes(app);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;
const nativeFetch = globalThis.fetch;

try {
  const statusRes = await fetch(`${base}/api/ai-agent/status`);
  assert.equal(statusRes.status, 200);
  const status = await statusRes.json();
  assert.equal(status.ok, true);
  assert.equal(status.providers.length, 4);
  assert.ok(status.providers.every((p) => p.healthStatus === "not_connected"));

  const badHealth = await fetch(`${base}/api/ai-agent/provider-health`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ai-council-code": "wrong" },
    body: JSON.stringify({}),
  });
  assert.equal(badHealth.status, 401);

  const healthRes = await fetch(`${base}/api/ai-agent/provider-health`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ai-council-code": "ux-smoke-test-code" },
    body: JSON.stringify({}),
  });
  assert.equal(healthRes.status, 200);
  const health = await healthRes.json();
  assert.equal(health.ok, true);
  assert.equal(health.checked.length, 4);
  assert.ok(health.checked.every((p) => p.status === "not_connected"));

  const homeRes = await fetch(`${base}/ai-council/`);
  const home = await homeRes.text();
  assert.equal(homeRes.status, 200);
  assert.match(home, /Pick the best AI for me/);
  assert.match(home, /Pick the AI model myself/);

  const botsRes = await fetch(`${base}/ai-council/bots/`);
  const bots = await botsRes.text();
  assert.equal(botsRes.status, 200);
  assert.match(bots, /AI Bots/);
  assert.match(bots, /href="\/ai-council\/\?view=council"/);

  // Simulate a provider account with no credits. The health preflight must catch
  // this before a real chat request is allowed to run.
  process.env.OPENAI_API_KEY = "fake-openai-key";
  let providerCalls = 0;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.startsWith("https://api.openai.com/v1/responses")) {
      providerCalls += 1;
      return new Response(JSON.stringify({
        error: { message: "You exceeded your current quota. Please check your plan and billing details." },
      }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }
    return nativeFetch(url, init);
  };

  const autoCheckedStatusRes = await nativeFetch(`${base}/api/ai-agent/status`);
  assert.equal(autoCheckedStatusRes.status, 200);
  const autoCheckedStatus = await autoCheckedStatusRes.json();
  const openAiStatus = autoCheckedStatus.providers.find((p) => p.id === "openai");
  assert.equal(autoCheckedStatus.autoChecked, true);
  assert.equal(openAiStatus.healthStatus, "no_credits");
  assert.match(openAiStatus.healthLabel, /No credits/i);
  assert.ok(autoCheckedStatus.providers.filter((p) => p.configured).every((p) => p.healthStatus !== "unchecked"));
  assert.equal(providerCalls, 1, "status load should automatically probe the configured provider once");

  const blockedChatRes = await nativeFetch(`${base}/api/ai-agent/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ai-council-code": "ux-smoke-test-code" },
    body: JSON.stringify({ question: "Hello", provider: "openai" }),
  });
  assert.equal(blockedChatRes.status, 402);
  const blockedChat = await blockedChatRes.json();
  assert.match(blockedChat.error, /No credits|billing/i);
  assert.equal(providerCalls, 1, "blocked chat must not make a second full provider request");

  delete process.env.OPENAI_API_KEY;
  process.env.ANTHROPIC_API_KEY = "fake-anthropic-key";
  delete process.env.ANTHROPIC_WORKSPACE_ID;
  let anthropicCalls = 0;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.startsWith("https://api.anthropic.com/v1/messages")) {
      anthropicCalls += 1;
      const headers = new Headers(init?.headers || {});
      const workspaceId = headers.get("anthropic-workspace-id");
      if (!workspaceId) {
        return new Response(JSON.stringify({
          error: {
            message: "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use.",
          },
        }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      assert.equal(workspaceId, "wrkspc_test_workspace");
      return new Response(JSON.stringify({
        content: [{ type: "text", text: "OK" }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return nativeFetch(url, init);
  };

  const missingWorkspaceRes = await nativeFetch(`${base}/api/ai-agent/provider-health`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ai-council-code": "ux-smoke-test-code" },
    body: JSON.stringify({ providers: ["anthropic"], force: true }),
  });
  assert.equal(missingWorkspaceRes.status, 200);
  const missingWorkspace = await missingWorkspaceRes.json();
  assert.equal(missingWorkspace.checked[0].status, "workspace_required");
  assert.match(missingWorkspace.checked[0].label, /Workspace ID required/i);

  process.env.ANTHROPIC_WORKSPACE_ID = "wrkspc_test_workspace";
  const anthropicReadyRes = await nativeFetch(`${base}/api/ai-agent/provider-health`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ai-council-code": "ux-smoke-test-code" },
    body: JSON.stringify({ providers: ["anthropic"], force: true }),
  });
  assert.equal(anthropicReadyRes.status, 200);
  const anthropicReady = await anthropicReadyRes.json();
  assert.equal(anthropicReady.checked[0].status, "ready");
  assert.equal(anthropicReady.providers.find((p) => p.id === "anthropic")?.workspaceConfigured, true);
  assert.equal(anthropicCalls, 2);
} finally {
  globalThis.fetch = nativeFetch;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_WORKSPACE_ID;
  await new Promise((resolve) => server.close(resolve));
}

console.log("AI Chat UX smoke checks passed");
