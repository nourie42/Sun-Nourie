import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// None of OpenAI, Anthropic or Meta lets an API key read the account's remaining credit, so
// My AIs keeps its own ledger: the owner types each balance once (from the billing page) and
// every reply's cost is subtracted. Grok replies report their exact cost, and with a
// management key the real xAI prepaid balance is read directly.

// USD per 1M tokens: [input, output]. Cached-input discounts are ignored, so estimates run slightly high.
const PRICES = {
  "grok-4.3": [1.25, 2.5],
  "grok-4.7": [2, 6],
  "muse-spark-1.1": [1.25, 4.25],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
  "gpt-5.6-terra": [2, 12],
  "gpt-5.6-sol": [4, 20],
};
// Unknown (overridden) models are priced at the provider's most expensive known model.
const FALLBACK_PRICES = { xai: PRICES["grok-4.7"], muse: PRICES["muse-spark-1.1"], anthropic: PRICES["claude-opus-5-5"], openai: PRICES["gpt-5.6-sol"] };
const WEB_SEARCH_USD = 0.01; // $10 per 1,000 searches

export const BILLING_PAGES = {
  xai: "https://console.x.ai",
  muse: "",
  anthropic: "https://console.anthropic.com/settings/billing",
  openai: "https://platform.openai.com/settings/organization/billing/overview",
};

const XAI_BALANCE_TTL_MS = 60 * 1000;

function tokenCost(model, botId, inputTokens, outputTokens) {
  const [input, output] = PRICES[model] || FALLBACK_PRICES[botId] || [0, 0];
  return (inputTokens * input + outputTokens * output) / 1e6;
}

/** Cost of one provider response in USD, and whether it is exact or estimated. */
export function responseCost(botId, model, data) {
  const usage = data?.usage || {};
  if (botId === "xai" && Number.isFinite(Number(usage.cost_in_usd_ticks))) {
    return { usd: Number(usage.cost_in_usd_ticks) / 1e10, exact: true };
  }
  if (botId === "openai" || botId === "xai") {
    const searches = (Array.isArray(data?.output) ? data.output : []).filter((item) => item?.type === "web_search_call").length;
    return { usd: tokenCost(model, botId, Number(usage.input_tokens) || 0, Number(usage.output_tokens) || 0) + searches * WEB_SEARCH_USD, exact: false };
  }
  if (botId === "anthropic") {
    const input = (Number(usage.input_tokens) || 0) + (Number(usage.cache_creation_input_tokens) || 0) + (Number(usage.cache_read_input_tokens) || 0);
    const searches = Number(usage.server_tool_use?.web_search_requests) || 0;
    return { usd: tokenCost(model, botId, input, Number(usage.output_tokens) || 0) + searches * WEB_SEARCH_USD, exact: false };
  }
  return { usd: tokenCost(model, botId, Number(usage.prompt_tokens) || 0, Number(usage.completion_tokens) || 0), exact: false };
}

export function createBalanceStore(env = process.env) {
  const configured = env.MY_AIS_DATA_DIR || env.DATA_DIR;
  const directory = configured ? join(resolve(configured), "my-ais") : join(tmpdir(), "my-ais");
  const filename = join(directory, "balances.json");
  const durable = Boolean(configured);
  let writes = Promise.resolve();
  let xaiCache = null;

  async function read() {
    try {
      const data = JSON.parse(await readFile(filename, "utf8"));
      return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch {
      return {};
    }
  }

  function update(change) {
    const operation = writes.catch(() => {}).then(async () => {
      const data = await read();
      change(data);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${filename}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
      await rename(temporary, filename);
      return data;
    });
    writes = operation;
    return operation;
  }

  async function liveXaiBalance() {
    const key = env.XAI_MANAGEMENT_KEY;
    const team = String(env.XAI_TEAM_ID || "").trim();
    if (!key || !team) return null;
    if (xaiCache && Date.now() - xaiCache.at < XAI_BALANCE_TTL_MS) return xaiCache.value;
    let value = null;
    try {
      const response = await fetch(`https://management-api.x.ai/v1/billing/teams/${encodeURIComponent(team)}/prepaid/balance`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json().catch(() => ({}));
      // The ledger is in USD cents; purchases are negative, so a negative total is credit available.
      const cents = Number(data?.total?.val);
      if (response.ok && Number.isFinite(cents)) value = -cents / 100;
      else console.error("My AIs xAI balance lookup failed:", response.status, data?.error || data?.message || "");
    } catch (error) {
      console.error("My AIs xAI balance lookup failed:", error?.message || error);
    }
    xaiCache = { at: Date.now(), value };
    return value;
  }

  function summarize(botId, entry, live) {
    const spentUsd = Number(entry?.spentUsd) || 0;
    const base = { spentUsd, billingUrl: BILLING_PAGES[botId] || "" };
    if (live !== null && live !== undefined) return { ...base, source: "live", remainingUsd: live };
    if (!Number.isFinite(entry?.startUsd)) return { ...base, source: "unset", remainingUsd: null };
    return { ...base, source: "estimate", remainingUsd: entry.startUsd - spentUsd, startUsd: entry.startUsd, setAt: entry.setAt };
  }

  return {
    durable,
    liveXaiConfigured: Boolean(env.XAI_MANAGEMENT_KEY && env.XAI_TEAM_ID),

    async all(botIds) {
      const data = await read();
      const live = botIds.includes("xai") ? await liveXaiBalance() : null;
      return Object.fromEntries(botIds.map((id) => [id, summarize(id, data[id], id === "xai" ? live : null)]));
    },

    async setStart(botId, usd) {
      const data = await update((all) => { all[botId] = { startUsd: usd, spentUsd: 0, setAt: new Date().toISOString() }; });
      return summarize(botId, data[botId], botId === "xai" ? await liveXaiBalance() : null);
    },

    async recordSpend(botId, usd) {
      if (botId === "xai") xaiCache = null;
      const data = await update((all) => {
        const entry = all[botId] || { startUsd: null, spentUsd: 0, setAt: null };
        entry.spentUsd = (Number(entry.spentUsd) || 0) + Math.max(0, usd);
        all[botId] = entry;
      });
      return summarize(botId, data[botId], botId === "xai" ? await liveXaiBalance() : null);
    },
  };
}
