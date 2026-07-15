import { registerDistributorResearchRoutes as registerBaseRoutes } from "./distributorResearchV2.js";

function createOpenAiCompatibleFetch() {
  return async function fetchWithTimeout(url, init = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let nextInit = { ...init, signal: controller.signal };
      if (String(url).includes("api.openai.com/v1/responses") && String(init.method || "GET").toUpperCase() === "POST" && typeof init.body === "string") {
        try {
          const payload = JSON.parse(init.body);
          const usesWebSearch = Array.isArray(payload.tools) && payload.tools.some((tool) => String(tool?.type || "").startsWith("web_search"));
          const usesJsonMode = payload?.text?.format?.type === "json_object" || payload?.response_format?.type === "json_object";
          if (usesWebSearch && usesJsonMode) {
            if (payload.text?.format?.type === "json_object") delete payload.text;
            if (payload.response_format?.type === "json_object") delete payload.response_format;
            payload.instructions = `${payload.instructions || ""}\nReturn exactly one valid JSON object. Do not use markdown fences or any text outside the object.`.trim();
            nextInit = { ...nextInit, body: JSON.stringify(payload) };
          }
        } catch {
          // Leave non-JSON request bodies unchanged.
        }
      }
      return await fetch(url, nextInit);
    } finally {
      clearTimeout(timer);
    }
  };
}

export function registerDistributorResearchRoutes(app, options = {}) {
  return registerBaseRoutes(app, {
    ...options,
    fetchWithTimeout: options.fetchWithTimeout || createOpenAiCompatibleFetch(),
  });
}
