# My AIs: Grok, Muse, Claude and ChatGPT in one chat

Open **`/ai-council/`** (or the short address `/my-ais`). This is the Grok-style page:

- **Sidebar → My AIs:** pick Grok bot, Muse bot, Claude bot or ChatGPT bot to chat one on one. Each chat remembers
  the whole conversation.
- **Sidebar → Group chat:** pick two or more AIs and 1–3 rounds, then send a topic. They take
  turns, each reading what the others said, and the replies appear as they arrive. Send another
  message at any time to jump in, or press ■ to stop. The page shows how many AI replies a message
  will use before you send it (12 at most).
- **🧠 Deep:** switches to each AI's smartest model and lets it think longer. It's off by default.
- **🌐 Web:** lets the AI search the web for that message. It's off by default (and not used in group chat).

## Why it's cheaper than the old bots

| Old behaviour | Now |
|---|---|
| Sent hidden "Reply only with OK" test messages to every AI before answering | No test messages |
| Web search on every message | Only when 🌐 Web is on |
| Top-tier models for everything | Fast models by default; top models only with 🧠 Deep |
| Group rooms: every bot × every round with web search and long replies | Short replies, no web search, capped at 12 replies |

| AI | Fast (default) | 🧠 Deep |
|---|---|---|
| Grok | `grok-4.3` | `grok-4.7` |
| Muse | `muse-spark-1.1` | `muse-spark-1.1` (more room to answer) |
| Claude | `claude-sonnet-5-5`, low effort | `claude-opus-5-5`, high effort |
| ChatGPT | `gpt-5.6-terra`, low effort | `gpt-5.6-sol`, high effort |

Override any of these with `MY_AIS_<XAI|MUSE|ANTHROPIC|OPENAI>_<FAST|DEEP>_MODEL`.
Claude requests opt in to Anthropic's server-side refusal fallback (`fallbacks: "default"`).

## Money left on each bot

Each bot shows its balance in the sidebar and header, and each reply shows what it cost.
Tap **💰 Balances** to set them.

- **Grok bot: real balance.** Add `XAI_MANAGEMENT_KEY` (a management key from the xAI console, not
  the normal API key) and `XAI_TEAM_ID`. The page reads the prepaid balance from
  `management-api.x.ai/v1/billing/teams/{team}/prepaid/balance`, rechecking at most once a minute.
  Each Grok reply also reports its exact cost (`usage.cost_in_usd_ticks`).
- **ChatGPT, Claude and Muse bots: estimate.** OpenAI, Anthropic and Meta don't let an API key read
  the remaining credit. Type the balance from each billing page once. The page then subtracts every
  reply's cost, using the token counts in the reply × published prices plus $0.01 per web search.
  It ignores cached-input discounts, so the estimate runs slightly high. Spending from other apps
  isn't counted, so re-enter the balance now and then.
- Balances are saved on the server in `$MY_AIS_DATA_DIR` or `$DATA_DIR` (`my-ais/balances.json`),
  so every device shows the same numbers. Without either variable, they're kept in a temp folder
  and reset when the server restarts. The Balances panel says which applies.

My AIs has its own limit of 100 AI replies per hour (`MY_AIS_RATE_LIMIT`), separate from the AI Council's.

## Connecting each AI

| AI | Environment variables | Where to get the key |
|---|---|---|
| Grok | `XAI_API_KEY` | console.x.ai |
| Muse | `MUSE_API_KEY` **and** `MUSE_BASE_URL` | Meta Model API dashboard; copy its OpenAI-compatible base URL (the part before `/chat/completions`) |
| Claude | `ANTHROPIC_API_KEY` | console.anthropic.com |
| ChatGPT | `OPENAI_API_KEY` | platform.openai.com |

An AI without a key shows "Not connected"; the rest keep working. The page is behind the private
`/ai-council` login, and if you aren't signed in it asks for `AI_COUNCIL_ACCESS_CODE`.

API: `GET /api/ai-council/hub/status`, `POST /api/ai-council/hub/balance` `{ bot, usd }`, `POST /api/ai-council/hub/chat` `{ bot, messages, deep, web }`,
`POST /api/ai-council/hub/room-turn` `{ bot, members, transcript, deep }`.
