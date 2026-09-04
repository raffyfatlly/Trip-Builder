import { count } from './meter.js';
// Every outbound fetch, with a deadline on it.
//
// raffy, 2026-09-01, on the Italy trip: "ai is lodding too long, after refresh
// the italy page all gone."
//
// The cause: not one fetch in this app had a timeout. `/api/state` answers the
// agent's pending tool calls inline, so a single slow host — an Italian hotel's
// website that accepts the connection and then never replies — held the whole
// request open until Vercel killed it at 300 seconds. The tool result was never
// written back, so the next poll tried the same fetch and hung the same way.
// Permanently stuck, and a refresh could not get past it either.
//
// A hung request is worse than a failed one: a failure is handled, a hang takes
// the page down with it. So nothing here waits forever.

export class Timeout extends Error {
  constructor(url, ms) {
    super('timed out after ' + ms + 'ms: ' + String(url).slice(0, 120));
    this.name = 'Timeout';
    this.timeout = true;
  }
}

// fetch, but it always comes back.
//
// Also the one place every outbound request in this app passes through, which
// is why the billing meter lives here rather than at twenty call sites. See
// lib/meter.js — count() is a Map update against an AsyncLocalStorage store and
// does nothing at all outside a request, so this stays a fetch wrapper.
export async function fetchWith(url, ms, init) {
  const ctl = new AbortController();
  const bell = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { ...(init || {}), signal: ctl.signal });
    try { count(url, res.ok); } catch (e) { /* metering never fails a request */ }
    return res;
  } catch (err) {
    try { count(url, false); } catch (e) { /* nor when the request itself did */ }
    // AbortError is not informative on its own — say what timed out.
    if (err && (err.name === 'AbortError' || ctl.signal.aborted)) throw new Timeout(url, ms);
    throw err;
  } finally {
    clearTimeout(bell);
  }
}

// A budget shared across several fetches, so ten slow lookups cannot add up to
// something longer than any one of them was allowed to take.
export function deadline(ms) {
  const end = Date.now() + ms;
  return {
    left: () => Math.max(0, end - Date.now()),
    spent: () => Date.now() >= end,
    // What one call may have: its own limit, or whatever is left, whichever is
    // smaller. Never negative — 1ms fails immediately, which is the point.
    slice: (want) => Math.max(1, Math.min(want, end - Date.now())),
  };
}
