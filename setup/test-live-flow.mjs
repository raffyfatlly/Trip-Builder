// A real conversation against the live chat agent, to see whether the
// 2026-09-06 changes actually land: phases in order, pick:"many" on a set they
// should triage, and lists instead of walls of text.
//
//   node --env-file=.env setup/test-live-flow.mjs

import { createSession, sendUserMessage, advanceState, listEvents } from '../lib/managedAgents.js';
import { CHAT_AGENT_ID, ENV_ID } from '../lib/config.js';

// Continue an existing session when given one, so a long conversation can be
// driven a few turns at a time without paying for it from the top each run.
const RESUME = process.argv[2] && process.argv[2].startsWith('sesn_') ? process.argv[2] : null;
const s = RESUME ? { id: RESUME } : await createSession(CHAT_AGENT_ID, ENV_ID);
console.log('session ' + s.id + (RESUME ? ' (resumed)' : '') + '\n');

let seen = RESUME ? (await listEvents(s.id)).length : 0;
const say = async (text) => {
  console.log('\x1b[36m> ' + text + '\x1b[0m');
  await sendUserMessage(s.id, [{ type: 'text', text }]);
  const t0 = Date.now();
  // The agent runs on Anthropic's side; advanceState only answers pending tool
  // calls. So: pump, wait, pump again, until it settles.
  let ev = [];
  for (let i = 0; i < 90; i++) {
    await advanceState(s.id, 240000);
    ev = await listEvents(s.id);
    const pending = (() => {
      const done = new Set(ev.filter((e) => e.type === 'user.custom_tool_result')
        .map((e) => e.custom_tool_use_id));
      return ev.filter((e) => e.type === 'agent.custom_tool_use' && !done.has(e.id)).length;
    })();
    const last = [...ev].reverse().find((e) =>
      e.type === 'session.status_idle' || e.type === 'session.status_running');
    if (!pending && last && last.type === 'session.status_idle') break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const fresh = ev.slice(seen); seen = ev.length;
  for (const e of fresh) {
    if (e.type === 'agent.custom_tool_use') {
      const i = e.input || {};
      const bits = [e.name];
      if (i.kind) bits.push(i.kind);
      if (i.pick) bits.push('pick=' + i.pick);
      if (i.questions) bits.push(i.questions.length + 'q');
      const n = (i.items || i.spots || []).length;
      if (n) bits.push(n + ' cards');
      console.log('  \x1b[33m[' + bits.join(' ') + ']\x1b[0m');
    }
    if (e.type === 'agent.message') {
      const t = (e.content || []).map((c) => c.text || '').join('').trim();
      if (t) console.log(t.split('\n').map((l) => '  ' + l).join('\n'));
    }
  }
  console.log('  \x1b[90m(' + ((Date.now() - t0) / 1000).toFixed(0) + 's)\x1b[0m\n');
};

const SCRIPT = RESUME
  ? process.argv.slice(3)
  : ["Chiang Mai, 4 nights, 12-16 November. Just me and my wife. First time.",
     "We like boutique places, mid range, maybe RM400 a night. Halal food please."];
for (const line of SCRIPT) await say(line);
console.log('SESSION ' + s.id);
