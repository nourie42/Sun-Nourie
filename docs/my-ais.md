# My AIs — Grok, Muse, Claude and ChatGPT on one page

Open **`/my-ais`** (or `/ai-council/hub/`). Each assistant gets its own chat column, and one
message box at the bottom sends to whichever ones are selected under **Send to** (or **All**).
Every column keeps its own conversation history, so follow-up questions work. Chats are saved in
the browser. On a phone, the tabs at the top switch between assistants.

The page sits behind the same private `/ai-council` login. If you are not signed in, it asks for
`AI_COUNCIL_ACCESS_CODE`.

## Connecting each AI

Consumer subscriptions (ChatGPT Plus, SuperGrok, Claude Pro, the Meta AI app) do **not** include
API access. Each assistant needs an API key from that company's developer console, and API usage is
billed separately from the subscription.

| Assistant | Environment variables | Where to get the key |
|---|---|---|
| Grok | `XAI_API_KEY` (model: `AI_COUNCIL_XAI_MODEL`) | console.x.ai |
| Muse | `MUSE_API_KEY` **and** `MUSE_BASE_URL` (model: `MUSE_MODEL`, default `muse-spark-1.1`) | Meta Model API dashboard; copy its OpenAI-compatible base URL (the part before `/chat/completions`) |
| Claude | `ANTHROPIC_API_KEY` (model: `AI_COUNCIL_ANTHROPIC_MODEL`) | console.anthropic.com |
| ChatGPT | `OPENAI_API_KEY` (model: `AI_COUNCIL_OPENAI_MODEL`) | platform.openai.com |

Grok, Claude and ChatGPT reuse the keys and model settings the AI Council already uses. If a key is
missing, that column shows "not connected" and the other columns keep working.

API: `GET /api/ai-council/hub/status`, `POST /api/ai-council/hub/chat` with `{ bot, messages: [{ role, content }] }`.
