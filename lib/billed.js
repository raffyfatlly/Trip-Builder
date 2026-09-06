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
import { settle } from './credits.js';

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
          // Awaited, unlike the fire-and-forget it used to be: the credit
          // settle below reads the totals these two write, and billing a
          // session for what it spent two requests ago is how a ledger drifts
          // far enough behind that somebody gets a free trip out of it.
          const written = addMetered(session, drain(), who);
          addHouse(drainHouse());
          if (written) {
            await written;
            // Charges whatever this session has spent since it was last
            // charged. Serialised through the same queue as every other write
            // to the session, so two requests finishing at once cannot both
            // bill the same dollar. Never throws — see credits.js.
            //
            // ONLY when something was actually metered.
            //
            // It used to run on every request, and settle() reads the whole
            // journal and writes it back before it can discover there is
            // nothing to charge. So each poll — every 2.5 seconds, per open
            // tab — cost a Firestore read plus a write for nothing, as did
            // every /api/photo and /api/map. They queue per session, so they
            // stacked up behind each other until they blew the 15-second
            // timeout, which is the "journal: timed out after 15000ms" on
            // nearly every line of raffy's production log (2026-09-06).
            //
            // A request that spent nothing has nothing to charge for, by
            // definition. addMetered already returns null in exactly that case.
            await settle(session);
          }
        } catch (e) { /* never a reason to fail */ }
      }
    });
  };
}
