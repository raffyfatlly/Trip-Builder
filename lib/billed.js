// Wrap an API route so everything it does is billed to the right session, and
// to the right person.
//
// One import and one line per route, rather than a session argument threaded
// through every function that makes a request. See lib/meter.js for why.
//
// The flush happens after the handler returns, so a route that spends money and
// then throws still records what it spent — which is exactly the session
// somebody will ask about.

import { withSession, drain, drainHouse } from './meter.js';
import { addMetered, addHouse } from './journal.js';
import { userFrom } from './auth.js';

// `session` is what the chat posts. `s` is what a baked itinerary carries in a
// photo URL, where a long query name in every <img src> is not free.
const sessionOf = (req) =>
  (req.query && (req.query.session || req.query.s)) ||
  (req.body && req.body.session) || '';

export function billed(handler) {
  return async function wrapped(req, res) {
    const session = sessionOf(req);

    // No session — /api/photo serving a shared itinerary, most often. Run it
    // plainly and let the meter put what it spends on the house, flushed in
    // batches so a hot image endpoint is not one Firestore write per picture.
    if (!session || typeof session !== 'string') {
      try {
        return await handler(req, res);
      } finally {
        try { addHouse(drainHouse()); } catch (e) { /* never a reason to fail */ }
      }
    }

    // The signed-in email, from the cookie every request already carries. Doing
    // it here rather than at a call site is the whole point: per-person costs
    // that depend on somebody remembering to stamp them are per-person costs
    // that will be missing for whoever matters most.
    let who = '';
    try { who = userFrom(req) || ''; } catch (e) { /* anonymous is fine */ }

    return withSession(session, async () => {
      try {
        return await handler(req, res);
      } finally {
        try {
          addMetered(session, drain(), who);
          addHouse(drainHouse());
        } catch (e) { /* never a reason to fail */ }
      }
    });
  };
}
