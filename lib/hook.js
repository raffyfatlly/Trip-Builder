// The landing page's ask box — a real answer, no interview.
//
// raffy, 2026-09-16: "i see user always ask questions in fb groups about the
// trip they going to make. i want them to be able to use this part of the
// landing page to ask for free... the agent must answer it nicely and really
// specific like a travel agent AI not just generic ai... cause the chat agent
// acts differently, it will ask for info bla bla bla which is not suitable
// for a quick question that want that particular question to be solved."
// Then, correcting the first cut of this: "don't put the one free question
// thing etc." — so this answers as many questions as somebody wants to ask;
// see pages/api/hook.js for the quiet cost ceiling that exists instead,
// which is never surfaced as a limit.
//
// So this is deliberately NOT the chat agent, and NOT a Managed Agents session
// — no interview, no persisted state, no per-session container to spin up for
// a question from a stranger. It is a single direct call to the Messages API
// with a system prompt that forbids asking anything back, the same fact
// tools the chat agent uses for real numbers (lib/facts.js), and Anthropic's
// own web search/fetch for everything else — which between them is what makes
// an answer specific instead of generic: a real flight time, a real price
// range, a real opening hour, not "it depends on the season."
//
// What it does NOT get: check_prices (lib/prices.js) and the research desk
// (lib/research.js). Both are real money on every call — Travelpayouts/Apify
// and an OpenRouter worker — and this endpoint is unauthenticated and public
// by design. web_search answers "what does it cost" well enough for a first
// taste; the metered tools are for someone who has already committed to
// building a trip.

import { fetchWith, deadline } from './net.js';
import { apiKey } from './config.js';
import { FACT_TOOLS, FACT_NAMES, answerFactCall } from './facts.js';
import { setting } from './settings.js';

const API = 'https://api.anthropic.com';
const T_CALL = 20000;
const T_ALL = 28000;
const MAX_ROUNDS = 3;

// A setting, not a constant, for the same reason chatModel() is: this is the
// one place a stranger meets the product before deciding whether to sign up,
// so it is worth trying a stronger model here even while the signed-in chat
// runs cheaper — and worth being able to flip back without a deploy.
export const hookModel = () => setting('HOOK_MODEL', 'hookModel', 'claude-sonnet-5');

const TOOLS = () => [
  {
    type: 'web_search_20260209',
    name: 'web_search',
    user_location: { type: 'approximate', country: 'MY', timezone: 'Asia/Kuala_Lumpur' },
  },
  { type: 'web_fetch_20260209', name: 'web_fetch' },
  ...FACT_TOOLS,
];

const SYSTEM = `You are the trip-planning desk on this site's landing page — the very first thing a traveller meets, before they have signed up for anything. They typed a question the way they would into a Facebook group asking strangers for advice.

ANSWER IT. Do not ask what their budget is, who they are travelling with, or what else they want to do. A real travel agent handed one specific question by someone they will likely never speak to again does not stall for more context — they give the best answer the facts support, and say plainly where a detail would sharpen it, in one line, without making it a condition of answering.

Be specific, not generic:
- Names, prices with currency, opening hours, travel times, dates — a number or a name beats a paragraph of hedging.
- Use place_details, travel_time and trip_facts for anything checkable — hours, distances, weather, exchange rates. Use web_search and web_fetch for everything else: current prices, whether something is worth it, what people who went recently actually say. Never answer from memory what a tool can check.
- If you could not find something, say so plainly. A guess dressed as a fact is worse than "I could not confirm that."
- Two or three short paragraphs at most, or a tight list when you are comparing options. This is a first impression, not a report.

End with exactly one short line pointing them at building the actual trip — not a hard sell, just the natural next step now that they have a real answer in hand. Something like: "Want the whole trip mapped out like this? Tell me your dates and I'll start building it." Vary the wording; never repeat the same sentence twice in a row across a conversation, and never add a second call to action.`;

const clean = (s) => String(s == null ? '' : s).trim();

const headers = () => ({
  'x-api-key': apiKey(),
  'anthropic-version': '2023-06-01',
  'content-type': 'application/json',
});

async function callClaude(messages, budget) {
  const body = {
    model: hookModel(),
    max_tokens: 900,
    system: SYSTEM,
    tools: TOOLS(),
    messages,
  };
  const res = await fetchWith(API + '/v1/messages', budget.slice(T_CALL), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(res.status + ' ' + text.slice(0, 300));
  return JSON.parse(text);
}

const textOf = (msg) => (msg.content || [])
  .filter((b) => b.type === 'text')
  .map((b) => b.text)
  .join('\n')
  .trim();

/**
 * Answer one free-standing question. Never throws — a stranger's first look
 * at the product going down with a stack trace is the worst possible first
 * impression, so a failure comes back as a plain apology instead.
 */
export async function askHook(question) {
  const q = clean(question).slice(0, 600);
  if (!q) return { answer: '', error: 'empty question' };

  try {
    const budget = deadline(T_ALL);
    const messages = [{ role: 'user', content: q }];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const msg = await callClaude(messages, budget);
      messages.push({ role: 'assistant', content: msg.content });

      if (msg.stop_reason !== 'tool_use') return { answer: textOf(msg) };

      const calls = (msg.content || []).filter((b) => b.type === 'tool_use' && FACT_NAMES.includes(b.name));
      // web_search/web_fetch are executed by Anthropic itself and come back
      // resolved in the same response; only the custom fact tools land here
      // needing an answer from us. If a round has neither — nothing we
      // recognise, or the budget is spent — stop and return what there is.
      if (!calls.length || budget.spent()) {
        const said = textOf(msg);
        if (said) return { answer: said };
        break;
      }

      const results = await Promise.all(calls.map(async (c) => {
        try {
          const out = await answerFactCall(c.name, c.input);
          return { type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out ?? {}) };
        } catch (err) {
          return { type: 'tool_result', tool_use_id: c.id, content: 'lookup failed', is_error: true };
        }
      }));
      messages.push({ role: 'user', content: results });
    }

    return { answer: '', error: 'could not settle on an answer in time' };
  } catch (err) {
    return { answer: '', error: String((err && err.message) || err).slice(0, 200) };
  }
}
