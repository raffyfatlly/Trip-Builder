// The journal, from a browser.
//
// The CLI (setup/journal.js) is the real tool and reads Firestore directly.
// This exists so raffy can check the beta from his phone without a laptop.
//
// Guarded by a key kept in the runtime config, not in the code — same place
// every other credential lives, for the same reason. Set it once:
//
//   node --env-file=.env -e "import('./lib/firestore.js').then(m=>m.writeConfig({adminKey:'...'}))"
//
// With no key set the endpoint stays shut rather than open, because a journal
// carries what people typed.

import { journalList, journalRead, readConfig, firestoreConfigured } from '../../../lib/firestore.js';
import { totalUsd } from '../../../lib/journal.js';

export default async function handler(req, res) {
  if (!firestoreConfigured()) return res.status(501).json({ error: 'no store configured' });

  const cfg = await readConfig();
  const want = process.env.ADMIN_KEY || cfg.adminKey || '';
  if (!want) return res.status(503).json({ error: 'no admin key set' });
  const got = (req.query && req.query.key) || '';
  // Constant-ish: this is a beta tool behind an unguessable string, not a
  // login, but there is no reason to leak the length.
  if (got.length !== want.length || got !== want) return res.status(404).end();

  const one = (req.query && req.query.session) || '';
  if (one) {
    const j = await journalRead(String(one));
    if (!j) return res.status(404).json({ error: 'not found' });
    return res.status(200).json({ ...j, usd: +totalUsd(j).toFixed(4) });
  }

  const all = await journalList(300);
  const built = (j) => (j.lines || []).some((l) => l.ev === 'build.done');
  const rows = all.map((j) => ({
    session: j.session,
    started: j.started,
    last: j.last,
    dest: j.dest || '',
    turns: (j.lines || []).filter((l) => l.ev === 'msg').length,
    built: built(j),
    errors: j.errors || 0,
    usd: +totalUsd(j).toFixed(4),
  }));
  const total = rows.reduce((a, r) => a + r.usd, 0);
  const trips = rows.filter((r) => r.built);
  res.setHeader('cache-control', 'no-store');
  res.status(200).json({
    sessions: rows.length,
    trips: trips.length,
    usd: +total.toFixed(4),
    perSession: rows.length ? +(total / rows.length).toFixed(4) : 0,
    perTrip: trips.length ? +(trips.reduce((a, r) => a + r.usd, 0) / trips.length).toFixed(4) : 0,
    rows,
  });
}
