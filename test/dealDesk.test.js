import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { registerDealDeskRoutes } from "../src/dealDeskRoutes.js";
import { calculate, emptyDeal, exampleDeal, validateImport } from "../src/dealDeskModel.js";

async function fixture(t, options = {}) {
  const app = express();
  registerDealDeskRoutes(app, options);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    get: (route) => fetch(base + route, { redirect: "manual" }),
    post: (body, code = "test-code", headers = {}) => fetch(base + "/api/deal-desk/analyze", {
      method: "POST", headers: { "content-type": "application/json", "x-deal-desk-passcode": code, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  };
}
const env = { ANTHROPIC_API_KEY: "test-not-a-real-key", AI_COUNCIL_ACCESS_CODE: "test-code" };
const packet = () => ({ deal: exampleDeal(), files: [], notes: "Fictional test only" });
const aiResponse = (overrides = {}) => Response.json({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify({ deal: exampleDeal(), summary: "Fixture review", warnings: [] }) }],
  ...overrides,
});

test("restored operating bridge matches the original example", () => {
  const r = calculate(exampleDeal());
  assert.equal(r.ready, true);
  assert.equal(r.seller, 3000000);
  assert.equal(r.sun, 4240000);
  assert.equal(r.dealer, 950000);
  assert.equal(r.combined, 5190000);
  assert.equal(r.lift, 1240000);
  assert.equal(r.systemCostReduction, 1950000);
  assert.equal(r.investment, 23400000);
  assert.ok(r.irr > 0.1 && r.irr < 0.2);
  assert.equal(r.bridge.reduce((sum, item) => sum + item.value, 0), r.sun);
});
test("commission and rent cancel in combined economics", () => {
  const d = exampleDeal(), before = calculate(d);
  d.commission += 2; d.rent += 60000;
  const after = calculate(d);
  assert.equal(after.combined, before.combined);
  assert.equal(after.sun + after.dealer, before.combined);
});
test("missing inputs stay unknown, and capital is excluded from EBITDA", () => {
  assert.equal(calculate(emptyDeal()).sun, null);
  assert.equal(calculate(emptyDeal()).investReady, false);
  const d = exampleDeal(), before = calculate(d);
  d.oneTime += 1000000;
  assert.equal(calculate(d).sun, before.sun);
  assert.equal(calculate(d).investment, before.investment + 1000000);
  assert.throws(() => validateImport({ gallons: "15,000" }));
});
test("original app is served without creating links in other pages", async (t) => {
  const f = await fixture(t, { env });
  for (const path of ["/deal-desk", "/deal-desk/", "/deal-desk/index.html"]) {
    const res = await f.get(path);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /\/deal-desk\/assets\/index-.*\.js/);
    assert.match(res.headers.get("x-robots-tag"), /noindex/);
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
  assert.equal((await f.get("/deal-desk.html")).headers.get("location"), "/deal-desk");
  assert.equal((await f.get("/")).status, 404);
});
test("status reports config but never leaks secrets", async (t) => {
  const f = await fixture(t, { env });
  const result = await (await f.get("/api/deal-desk/status")).json();
  assert.equal(result.ready, true);
  assert.equal(result.passcodeRequired, true);
  assert.equal(result.version, "original-workspace-v1");
  assert.doesNotMatch(JSON.stringify(result), /test-code|test-not-a-real-key/);
});
test("AI fails closed without an access code", async (t) => {
  const f = await fixture(t, { env: { ANTHROPIC_API_KEY: "test" } });
  assert.equal((await f.post(packet())).status, 503);
  assert.equal((await (await f.get("/api/deal-desk/status")).json()).ready, false);
});
test("existing Council code works and Deal Desk override takes precedence", async (t) => {
  const f = await fixture(t, { env: { ...env, DEAL_DESK_PASSWORD: "override" }, fetchImpl: async () => aiResponse() });
  assert.equal((await f.post(packet())).status, 401);
  assert.equal((await f.post(packet(), "override")).status, 200);
});
test("AI contract extracts a validated review and retains CPG units", async (t) => {
  let sent;
  const f = await fixture(t, { env, fetchImpl: async (_url, options) => { sent = options; return aiResponse(); } });
  const res = await f.post(packet());
  assert.equal(res.status, 200);
  const review = await res.json();
  assert.equal(review.deal.commission, 5);
  assert.equal(review.summary, "Fixture review");
  assert.match(JSON.parse(sent.body).messages[0].content, /CPG inputs are CENTS/);
  assert.equal(sent.headers["x-api-key"], env.ANTHROPIC_API_KEY);
  assert.ok(Array.isArray(review.opportunities));
});
test("invalid input, oversized files, and cross-origin requests do not call provider", async (t) => {
  let calls = 0;
  const f = await fixture(t, { env, fetchImpl: async () => { calls++; return aiResponse(); } });
  assert.equal((await f.post({ ...packet(), deal: { gallons: "bad" } })).status, 400);
  assert.equal((await f.post({ ...packet(), files: Array(21).fill({ name: "x", text: "x" }) })).status, 400);
  assert.equal((await f.post({ ...packet(), notes: "x".repeat(390000) })).status, 400);
  assert.equal((await f.post("not-json")).status, 400);
  assert.equal((await f.post(packet(), "test-code", { origin: "https://example.invalid" })).status, 403);
  assert.equal((await f.post({ ...packet(), notes: "x".repeat(2100000) })).status, 413);
  assert.equal(calls, 0);
});
test("provider failure and malformed reviews are visible errors", async (t) => {
  for (const response of [
    Response.json({}, { status: 401 }),
    aiResponse({ stop_reason: "max_tokens" }),
    aiResponse({ content: [{ type: "text", text: "not JSON" }] }),
    aiResponse({ content: [{ type: "text", text: '{"deal":{"gallons":"bad"}}' }] }),
  ]) {
    const f = await fixture(t, { env, fetchImpl: async () => response });
    const res = await f.post(packet());
    assert.equal(res.status, 502);
    assert.equal(typeof (await res.json()).error, "string");
  }
});
