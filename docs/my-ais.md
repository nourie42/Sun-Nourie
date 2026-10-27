# My AIs: Grok, Muse, Claude and ChatGPT in one chat

Open **`/ai-council/`** (or the short address `/my-ais`). This is the Grok-style page:

- **Sidebar → My AIs:** pick Grok, Muse, Claude or ChatGPT to chat one on one. Each chat remembers
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
| ChatGPT | `gpt-5.6-terra`, low effort | `gpt-5.6`, high effort |

Override any of these with `MY_AIS_<XAI|MUSE|ANTHROPIC|OPENAI>_<FAST|DEEP>_MODEL`.
Claude requests opt in to Anthropic's server-side refusal fallback (`fallbacks: "default"`).

## Connecting each AI

| AI | Environment variables | Where to get the key |
|---|---|---|
| Grok | `XAI_API_KEY` | console.x.ai |
| Muse | `MUSE_API_KEY` **and** `MUSE_BASE_URL` | Meta Model API dashboard; copy its OpenAI-compatible base URL (the part before `/chat/completions`) |
| Claude | `ANTHROPIC_API_KEY` | console.anthropic.com |
| ChatGPT | `OPENAI_API_KEY` | platform.openai.com |

An AI without a key shows "Not connected"; the rest keep working. The page is behind the private
`/ai-council` login, and if you aren't signed in it asks for `AI_COUNCIL_ACCESS_CODE`.

API: `GET /api/ai-council/hub/status`, `POST /api/ai-council/hub/chat` `{ bot, messages, deep, web }`,
`POST /api/ai-council/hub/room-turn` `{ bot, members, transcript, deep }`.
