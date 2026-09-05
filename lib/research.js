// The research worker.
//
// raffy, 2026-09-05: "can we use any model for the research? if yes i maybe
// want open router, something cheaper than sonnet but still really good like
// it... I just want managed agent sonnet to be the manager if possible to
// switch the workers. maximum savings."
//
// Why this is a custom tool rather than a roster agent: a Managed Agents
// multiagent roster can only reference other Managed Agents, so its workers are
// Anthropic models. A custom tool runs on our own server and can call anything.
//
// It is also the better shape for what it costs. Measured on the Chiang Mai
// trip, the chat's own web_search pushed one request to 454,870 tokens and nine
// of twenty past 200K — because every search result stays in the conversation
// forever, and gets re-read at cache rates on every turn afterwards. Cache
// reads and writes were 79% of that trip's $1.90 chat bill; the model actually
// writing anything was 13%.
//
// So the results never enter the conversation. A cheap model with a big window
// does the searching and reading in its own context, and Sonnet gets back a few
// hundred words of answer. The chat model stays smart and stops paying to carry
// a library around.
//
//     deepseek/deepseek-v4-flash    $0.086 / $0.172 per MTok, 1M context
//     claude-sonnet-5               $2.00  / $10.00 per MTok, 1M context
//
// Verified against OpenRouter's own catalogue on 2026-09-05, not remembered.

import { fetchWith, deadline } from './net.js';
import { setting, loadConfig } from './settings.js';

const API = 'https://openrouter.ai/api/v1/chat/completions';

// Which model does the reading. A setting, because he asked to be able to
// switch workers, and because the right answer here changes monthly.
//
// It started on deepseek-v4-flash, on the reasoning that reading and extracting
// is not judgment work and the cheapest capable model should do it. Measured on
// the same question, that was wrong twice over:
//
//     deepseek-chat-v3-0324   16.4s   $0.0083   best structured, found five
//     deepseek-v4-pro         27.1s   $0.0139   honest, verbose
//     deepseek-v4-flash       37.3s   $0.0073   good, and the slowest
//
// The reason the prices barely differ is the part worth remembering: OpenRouter
// charges about $0.007 for the web search itself, and at ~3K in / 500 out the
// model's own tokens cost $0.0003 to $0.0013. **The search fee swamps the token
// price**, so a whole trip's research costs about 1.3 sen more on the better
// model. Optimising the worker for cheapness optimises the wrong number.
//
// Latency is one sample per model, so treat the ordering as indicative and the
// price finding as solid.
export const WORKER = () => setting('RESEARCH_MODEL', 'researchModel', 'deepseek/deepseek-chat-v3-0324');
const KEY = () => setting('OPENROUTER_API_KEY', 'openrouterKey');

export async function researchReady() {
  await loadConfig();
  return !!KEY() && setting('RESEARCH', 'research', 'on').toLowerCase() !== 'off';
}

// One question is one model call, and they run together. A research turn that
// takes as long as the slowest of six questions is a conversation; one that
// takes as long as all six added up is a spinner.
const T_ONE = 45000;
const T_ALL = 70000;
const MAX_Q = 6;

// Short on purpose. The whole point is that what comes back is small — a long
// answer here is the context problem moved rather than solved.
const WORKER_SYSTEM = `You are the research desk for a travel planner. Someone
planning a trip has asked a question. Search the web, read what you find, and
answer it.

Answer in under 150 words. No preamble, no "I found that" — just the answer.
Lead with the specific: names, prices with their currency, opening hours,
distances, dates. A number somebody can act on beats a paragraph of context.

Say plainly when you could not find something, or when what you found is old or
contradicts itself. An invented price is worse than no price: the person reading
this is going to put it in front of a traveller who will turn up expecting it.

End with the source hosts you actually used, on one line, like:
sources: lonelyplanet.com, tripadvisor.com`;

export const RESEARCH_TOOL = {
  type: 'custom',
  name: 'research',
  description:
    'Ask the research desk to go and find something out on the web. Use it for anything you would otherwise search for: what a place is like right now, what things cost, whether somewhere is worth the trip, what the crowds or the weather are doing, what has changed recently, what locals say. Batched — ask up to six questions at once and they are researched in parallel. Ask real questions in full sentences, not search keywords: "is the Trang An boat ride better than Tam Coc for a couple who want quiet" gets a better answer than "trang an vs tam coc". Each answer comes back short, with its sources.',
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        maxItems: MAX_Q,
        description: 'The questions, each a full sentence. Include the place and the dates where they matter.',
        items: { type: 'string' },
      },
    },
    required: ['questions'],
  },
};

/**
 * One question, answered by the worker.
 *
 * OpenRouter turns web search on two ways and which one a deployment has is not
 * something the catalogue will tell you, so this tries the documented plugin
 * form first and falls back to the `:online` model suffix. Whichever answers is
 * reported back, so the probe can say which one this account actually has.
 */
async function askOne(q, budget, model) {
  const body = {
    messages: [
      { role: 'system', content: WORKER_SYSTEM },
      { role: 'user', content: q },
    ],
    max_tokens: 1200,
    usage: { include: true },
  };

  const call = async (shape) => {
    const res = await fetchWith(API, budget.slice(T_ONE), {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + KEY(),
        'content-type': 'application/json',
        'http-referer': 'https://trip-builder-two.vercel.app',
        'x-title': 'Trip Builder research',
      },
      body: JSON.stringify(shape === 'plugin'
        ? { ...body, model, plugins: [{ id: 'web' }] }
        : { ...body, model: model + ':online' }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(res.status + ' ' + text.slice(0, 180));
    const data = JSON.parse(text);
    if (data.error) throw new Error((data.error.message || 'error').slice(0, 180));
    const msg = (data.choices || [])[0];
    if (!msg) throw new Error('no choices');
    return {
      text: String((msg.message || {}).content || '').trim(),
      usage: data.usage || null,
      model: data.model || model,
      shape,
    };
  };

  try { return await call('plugin'); }
  catch (err) {
    // Only worth a second attempt when the first was refused for its shape.
    // A timeout or a credit problem will fail the same way twice.
    if (!/400|404|plugin|not supported/i.test(String(err.message))) throw err;
    return call('online');
  }
}

/**
 * Answer up to six questions and return one block of text for the chat model.
 *
 * Never throws: a research desk that takes the conversation down with it is
 * worse than one that says it could not find something.
 */
export async function research(questions, { model } = {}) {
  const list = (questions || []).map((q) => String(q || '').trim()).filter(Boolean).slice(0, MAX_Q);
  if (!list.length) return { text: 'No questions given.', usage: null };
  if (!KEY()) {
    return { text: 'The research desk is not configured. Say you could not check rather than guessing.', usage: null };
  }

  const use = model || WORKER();
  const budget = deadline(T_ALL);
  const answers = await Promise.all(list.map(async (q) => {
    try { return { q, ...(await askOne(q, budget, use)) }; }
    catch (err) { return { q, text: '', error: String(err.message || err).slice(0, 160) }; }
  }));

  // One usage total for the whole call, so the ledger gets one row rather than
  // six. OpenRouter reports what it actually charged; that figure is the one
  // that goes in the journal, never an estimate from a rate table.
  const usage = answers.reduce((a, r) => {
    const u = r.usage || {};
    return {
      in: a.in + (u.prompt_tokens || 0),
      out: a.out + (u.completion_tokens || 0),
      calls: a.calls + (r.usage ? 1 : 0),
      usd: a.usd + (Number(u.cost) || 0),
    };
  }, { in: 0, out: 0, calls: 0, usd: 0 });

  const lines = [];
  for (const r of answers) {
    lines.push('\n### ' + r.q);
    lines.push(r.error
      ? 'Could not research this (' + r.error + '). Say so rather than guessing.'
      : (r.text || 'Nothing usable found. Say so rather than guessing.'));
  }
  if (answers.every((r) => r.error)) {
    lines.push('\nThe research desk is down. Tell them you could not check, and carry on with what you already know.');
  }
  return {
    text: lines.join('\n').trim(),
    usage: usage.calls ? usage : null,
    model: (answers.find((r) => r.model) || {}).model || use,
    shape: (answers.find((r) => r.shape) || {}).shape || '',
  };
}
