# Trip builder

Chat with an assistant about a trip, get a personal itinerary app for it.

Two agents:

- **Chat** interviews, thinks, and writes a brief. No web search, so it stays quick.
- **Builder** never talks to anyone. It takes one brief, researches the
  destination properly, and produces the itinerary through custom tools.

The renderer in `renderer/render.js` is shared with
`tools/itinerary-generator` in the vault repo, and turns one itinerary JSON
into the same app shape as the Phu Quoc trip it was extracted from.

## No storage anywhere

The itinerary is never written to a database. It is replayed from the builder
session's own event log, and the builder session id is recovered from the chat
session's log. The event log is the database.

People are separated by an anonymous session id in their own `localStorage`.
No accounts, no links.

## Why polling

A build takes minutes, longer than a serverless function lives. `/api/send`
returns immediately and the client polls `/api/state`; each poll resolves
whatever tool calls are pending right now and returns. The chat keeps talking
while the builder is still researching.

## Setup

Agents are persisted objects, created once:

    node --env-file=.env setup/create-agent.js     # first time only
    node --env-file=.env setup/update-agent.js     # to change a prompt

Ids live in `lib/config.js`. `ANTHROPIC_API_KEY` is read from the environment
if set, with a fallback in `lib/config.js`.

**The agent's prompt and tool schemas live on Anthropic's servers, not in the
deploy.** Editing `lib/prompt.js`, `lib/editTools.js` or any other tool schema
changes nothing anybody can see until `update-agent.js` runs. No build step
does it and a Vercel deploy will not. This has twice produced a change that
looks shipped, reads shipped in the diff, and is inert — so
`GET /api/health?sources=1` reports `chatAgent`, which is either `ok (vN)` or
tells you exactly what has drifted and to run the script.

## Tests

    node --env-file=.env setup/test-builder.js   # builder alone
    node setup/test-ui.js                        # full flow through the real UI
