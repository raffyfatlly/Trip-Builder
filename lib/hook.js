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
// with a system prompt that forbids asking anything back.
//
// raffy, 2026-09-16, after the tools were first held back to fact/web lookups
// only: "make the agent that answer the question in landing page have all
// the tools it needs like the chat agent! so the answer will have same
// quality." So it gets everything that can actually improve an ANSWER: the
// fact tools (lib/facts.js), Anthropic's own web search/fetch, the research
// desk (lib/research.js) and real prices (lib/prices.js) — the same four
// the chat agent reaches for to make a claim specific instead of generic.
//
// What it still does NOT get, on purpose: BUILD_TOOL, READ_TOOL, EDIT_TOOL,
// PRESENT_TOOL, PROPOSE_TOOL, NOTE_TOOL, REMEMBER_TOOL, FORGET_TOOL, FIND_TOOL.
// Every one of those reads or writes an itinerary, a plan, or a profile
// memory that belongs to a session — and there is no session here, on
// purpose (see pages/api/hook.js and public/welcome/index.html: the question
// itself is deliberately never carried forward into one either). Wiring
// those in would not add quality, it would hand an unauthenticated public
// endpoint the ability to mutate state that does not exist yet.
//
// The real cost consequence of the widen: research and check_prices are both
// real money per call (an OpenRouter worker; Travelpayouts/Apify), which is
// exactly why pages/api/hook.js's quiet per-visitor cap exists — see that
// file. Answer quality was worth paying for; an unbounded public meter was
// not, so the two ship together.

import { fetchWith, deadline } from './net.js';
import { apiKey } from './config.js';
import { FACT_TOOLS, FACT_NAMES, answerFactCall } from './facts.js';
import { RESEARCH_TOOL, research } from './research.js';
import { PRICE_TOOL, checkPrices } from './prices.js';
import { contextBlock } from './context.js';
import { chatModel } from './agentSync.js';
import { setting } from './settings.js';

const API = 'https://api.anthropic.com';
const T_CALL = 25000;
const T_ALL = 55000;
const MAX_ROUNDS = 4;

const TOOL_NAMES = [...FACT_NAMES, 'research', 'check_prices'];

/** Every custom tool's real implementation, in one place — web_search and
 * web_fetch need none of this, Anthropic executes those itself. */
async function answerToolCall(name, input) {
  if (FACT_NAMES.includes(name)) return answerFactCall(name, input);
  if (name === 'research') return (await research((input && input.questions) || [])).text;
  if (name === 'check_prices') return checkPrices(input);
  return null;
}

// raffy, 2026-09-16: "what model are u using for this question agent? use
// the same I think." Defaults to whatever the chat agent is actually
// running (lib/agentSync.js's chatModel(), itself a setting) rather than a
// second hardcoded value that could silently drift from it — flip
// CHAT_MODEL and this follows. HOOK_MODEL still exists to split them apart
// deliberately, on purpose, if that is ever wanted.
export const hookModel = () => setting('HOOK_MODEL', 'hookModel', chatModel());

// THE BUG THAT TOOK EVERY REQUEST DOWN, SILENTLY, FOR HOURS.
//
// The model-parity change above started defaulting to whatever the chat
// agent runs — claude-haiku-4-5 — while TOOLS() below still hardcoded
// web_search_20260209 / web_fetch_20260209. Per Anthropic's own docs those
// dated variants only run on Opus 5/4.8/4.7/4.6 and Sonnet 5/4.6 — Haiku is
// not on that list, and never has been. Every single call since that
// deploy sent a tool type the model could not use, Anthropic 400'd every
// one, and askHook's catch turned that into a clean "no answer" — which
// pages/api/hook.js correctly reported as a 502 (raffy: "why it's
// answering like this? it worked fine before?"). Nothing crashed, nothing
// timed out; it just failed the same way, every time, invisibly, because
// the two changes were never checked against each other.
//
// So the tool version now follows the model, not a hardcoded guess: the
// newer, dynamic-filtering variants where the model actually supports
// them, the older basic ones everywhere else — correct today AND if
// chatModel() ever points somewhere else later.
const SUPPORTS_NEW_WEB_TOOLS = /^claude-(opus-(5|4-[678])|sonnet-(5|4-6))$/;

const TOOLS = () => {
  const loc = { type: 'approximate', country: 'MY', timezone: 'Asia/Kuala_Lumpur' };
  const web = SUPPORTS_NEW_WEB_TOOLS.test(hookModel())
    ? [
        { type: 'web_search_20260209', name: 'web_search', user_location: loc },
        { type: 'web_fetch_20260209', name: 'web_fetch' },
      ]
    : [
        { type: 'web_search_20250305', name: 'web_search', user_location: loc },
        { type: 'web_fetch_20250910', name: 'web_fetch' },
      ];
  return [...web, ...FACT_TOOLS, RESEARCH_TOOL, PRICE_TOOL];
};

const SYSTEM = `You are the trip-planning desk on this site's landing page — the very first thing a traveller meets, before they have signed up for anything. They typed a question the way they would into a Facebook group asking strangers for advice.

ANSWER IT. Do not ask what their budget is, who they are travelling with, or what else they want to do. A real travel agent handed one specific question by someone they will likely never speak to again does not stall for more context — they give the best answer the facts support, and say plainly where a detail would sharpen it, in one line, without making it a condition of answering.

Be specific, not generic:
- Names, prices with currency, opening hours, travel times, dates — a number or a name beats a paragraph of hedging.
- Use place_details, travel_time and trip_facts for anything checkable — hours, distances, weather, exchange rates.
- Use check_prices for a real flight or hotel price the moment you have enough to ask it — an IATA route and a date, or a city and dates. Ask it before quoting any number.
- Use research for anything worth actually reading rather than searching yourself — recent reviews, whether somewhere is worth the detour, what has changed lately. Use web_search and web_fetch for quick, general lookups.
- Never answer from memory what a tool can check.
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
 *
 * `geo`/`client` are the exact pair pages/api/send.js builds for the chat
 * agent (geoFrom(req), and {tz} off the browser) — raffy, 2026-09-16: "make
 * it has same context like chat agent like currency, current date and time
 * etc." A castle's scaffolding schedule read as current-year news when the
 * model had no idea what year it actually was; contextBlock is the fix
 * already proven in the chat agent, reused rather than re-invented.
 */
export async function askHook(question, { geo, client } = {}) {
  const q = clean(question).slice(0, 600);
  if (!q) return { answer: '', error: 'empty question' };

  try {
    const budget = deadline(T_ALL);
    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: contextBlock(geo || {}, client, null) },
        { type: 'text', text: q },
      ],
    }];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const msg = await callClaude(messages, budget);
      messages.push({ role: 'assistant', content: msg.content });

      if (msg.stop_reason !== 'tool_use') return { answer: textOf(msg) };

      const calls = (msg.content || []).filter((b) => b.type === 'tool_use' && TOOL_NAMES.includes(b.name));
      // web_search/web_fetch are executed by Anthropic itself and come back
      // resolved in the same response; only the custom tools land here
      // needing an answer from us. If a round has neither — nothing we
      // recognise, or the budget is spent — stop and return what there is.
      if (!calls.length || budget.spent()) {
        const said = textOf(msg);
        if (said) return { answer: said };
        break;
      }

      // research()'s own internal ceiling is 70s (lib/research.js's T_ALL) —
      // longer than this whole function is allowed to run. Nothing here used
      // to cap it, so one research call could carry the request straight
      // through Vercel's own hard timeout: the fetch on the browser side then
      // fails with no response at all, which pages/api/hook.js never got a
      // chance to turn into a real answer OR an honest error. Capped to
      // whatever is actually left of the budget, so a slow tool loses
      // gracefully instead of taking the whole request down with it.
      const results = await Promise.all(calls.map(async (c) => {
        const ms = Math.max(4000, Math.min(30000, budget.left()));
        try {
          const out = await Promise.race([
            answerToolCall(c.name, c.input),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), ms)),
          ]);
          return { type: 'tool_result', tool_use_id: c.id, content: typeof out === 'string' ? out : JSON.stringify(out ?? {}) };
        } catch (err) {
          return { type: 'tool_result', tool_use_id: c.id, content: 'lookup timed out or failed — answer with what you already have rather than waiting on it', is_error: true };
        }
      }));
      messages.push({ role: 'user', content: results });
    }

    return { answer: '', error: 'could not settle on an answer in time' };
  } catch (err) {
    return { answer: '', error: String((err && err.message) || err).slice(0, 200) };
  }
}
