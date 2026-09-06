// What ONE USER TURN costs, in credits, on a real session.
//
// The journal counts API requests, not turns — a single "shall I look at
// activities?" can be three requests once the agent uses a tool. What a
// traveller experiences is turns: they say something, they get an answer, and
// their balance drops. This prices that.
//
//   node --env-file=.env setup/perturn.mjs <sessionId> [more...]

import { listEvents } from '../lib/managedAgents.js';
import { creditsFor } from '../lib/credits.js';

const ids = process.argv.slice(2);
if (!ids.length) throw new Error('give me one or more chat session ids');

const usdOf = (e) => {
  const u = e.usage || e;
  return u && u.list_cost && u.list_cost.amount != null ? +u.list_cost.amount / 100 : null;
};

for (const id of ids) {
  let events;
  try { events = await listEvents(id); }
  catch (err) { console.log(id, '  unreadable:', err.message); continue; }

  // session.usage events are CUMULATIVE snapshots — the delta between two is
  // what happened in between. Adding them up multiplies the bill.
  const rows = [];
  let prev = 0;
  let prevWrite = 0;
  let turn = 0;
  for (const e of events) {
    if (e.type === 'user.message') {
      const t = (e.content || []).map((c) => c.text || '').join(' ').trim();
      if (t) {
        turn++;
        rows.push({ turn, said: t, usd: 0, write: 0 });
      }
    }
    if (e.type === 'session.usage') {
      const u = usdOf(e);
      const cc = (e.usage && e.usage.cache_creation) || {};
      const w = (cc.ephemeral_5m_input_tokens || 0) + (cc.ephemeral_1h_input_tokens || 0);
      // Both are CUMULATIVE snapshots of the whole session, so the delta
      // between consecutive ones is what this turn actually did. Summing the
      // snapshots multiplies the session by the number of requests in it.
      if (u != null) { const d = u - prev; prev = u; if (rows.length) rows[rows.length - 1].usd += d; }
      if (w) { const d = w - prevWrite; prevWrite = w; if (rows.length) rows[rows.length - 1].write += Math.max(0, d); }
    }
  }

  console.log('\n' + id);
  console.log('  #   credits   re-cached   what they said');
  let total = 0;
  for (const r of rows) {
    total += r.usd;
    const cr = r.usd * 4.4 / 0.31;
    console.log(
      '  ' + String(r.turn).padStart(2) + '   ' + cr.toFixed(2).padStart(6) + '   '
      + (r.write > 999 ? Math.round(r.write / 1000) + 'k' : String(r.write)).padStart(9) + '   '
      + (r.said.length > 40 ? r.said.slice(0, 37) + '...' : r.said));
  }
  const cr = rows.map((r) => r.usd * 4.4 / 0.31);
  const sorted = [...cr].sort((a, b) => a - b);
  console.log('  ---');
  console.log('  turns ' + rows.length + '   total ' + creditsFor(total) + ' credits ($'
    + total.toFixed(3) + ')');
  if (cr.length) {
    console.log('  per turn: median ' + sorted[Math.floor(sorted.length / 2)].toFixed(2)
      + '   cheapest ' + sorted[0].toFixed(2)
      + '   dearest ' + sorted[sorted.length - 1].toFixed(2));
  }
}
