import { advanceState, resumeChat } from '../../lib/managedAgents.js';
import { billed } from '../../lib/billed.js';

// The slow half of the loop: answer the agent's pending tool calls, start a
// builder when it asks for one, take the build forward by a step.
//
// Split out from /api/state on 2026-09-01. Doing this work inside the poll
// that renders the page meant one poll could make two model calls, exceed
// Vercel's 300-second ceiling, and return nothing — so the conversation looked
// lost when it was only unread. Now the page always renders from /api/state
// and this can take as long as it takes.
//
// Safe to call repeatedly: every step is idempotent against the event log.

export const config = { maxDuration: 300 };

// One more invocation, fire and forget.
//
// Bounded by `hop` as well as by the build's own MAX_STEPS: a runaway that
// somehow never reports done still stops, and stops cheaply. Nothing awaits
// this — the point is to return the response and let the next one carry on.
const MAX_HOPS = 30;

function chain(req, session, hop) {
  if (hop >= MAX_HOPS) return;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return;                       // nothing to call back into
  const proto = /^localhost|^127\./.test(host) ? 'http' : 'https';
  const url = proto + '://' + host + '/api/advance?hop=' + (hop + 1)
    + '&session=' + encodeURIComponent(session);
  // A build step can take two minutes; this request is not waited on and its
  // response is never read, so the timeout only has to outlive the handshake.
  fetch(url, { method: 'POST', headers: { 'x-build-chain': '1' } }).catch(() => {});
}

async function handler(req, res) {
  const session = (req.query && req.query.session) || (req.body && req.body.session);
  if (!session || typeof session !== 'string') {
    return res.status(400).json({ error: 'session required' });
  }
  try {
    // A turn that died leaves the session idle with nothing pending, so
    // advancing alone will not restart it. `resume` is the retry button.
    if (req.query && req.query.resume) {
      try { await resumeChat(session); } catch (err) { console.error('resume failed:', err); }
    }
    const state = await advanceState(session);
    res.status(200).json(state);

    // Keep going without the page.
    //
    // raffy's Tokyo trip, 2026-09-05: "i ask it to build, then I felt asleep,
    // when i wake up I check its still building... Do i need to stay on the
    // page while it loads? That's not good."
    //
    // He did, and he was right that it is not good. This endpoint was only ever
    // called by the browser, so a build advanced one step per poll and froze
    // the moment the tab slept. A seven-minute build needs somebody watching it
    // for seven minutes, which is the opposite of what a build is for.
    //
    // So when a build is still running, this hands off to another invocation of
    // itself and returns. The chain carries the build to the end whether anyone
    // is looking or not. The lease in lib/orBuilder.js stops the chain and a
    // live page both paying for the same step.
    if (state && state.building) chain(req, session, Number(req.query.hop) || 0);
  } catch (err) {
    console.error('advance failed:', err);
    res.status(500).json({ error: 'Could not advance the conversation.' });
  }
}

export default billed(handler);
