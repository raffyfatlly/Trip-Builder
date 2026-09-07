// The list of trips this browser has made.
//
// "New trip" used to delete the one session id the browser held, which made
// every earlier trip unreachable forever — the work still existed on the
// server, but nothing pointed at it any more. Now the id goes into a list
// instead, so starting something new never costs you the last one.
//
// This is per-browser, not per-person. Accounts are still on the roadmap; this
// is the honest version of history until then.

const KEY = 'itin.trips.v1';
const MAX = 12;

const read = () => {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((t) => t && t.id) : [];
  } catch (e) {
    return [];   // private mode, or something wrote junk here
  }
};

const write = (list) => {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch (e) { /* ignore */ }
};

export const loadTrips = () => read();

// Upsert. A trip keeps the time it was first seen so the list stays in the
// order they were made, not the order they were last opened.
export function rememberTrip(id, label) {
  if (!id) return;
  const list = read();
  const at = list.find((t) => t.id === id);
  const next = [
    { id, label: label || (at && at.label) || 'Untitled trip', at: (at && at.at) || Date.now() },
    ...list.filter((t) => t.id !== id),
  ];
  next.sort((a, b) => b.at - a.at);
  write(next);
}

export function forgetTrip(id) {
  write(read().filter((t) => t.id !== id));
}

export const shortDate = (ms) => {
  try {
    return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  } catch (e) {
    return '';
  }
};

// What the app remembers about this person, kept beside the trip list for the
// same reason: it belongs to the browser first, and to the account as well
// once they sign in.
const MEM_KEY = 'itin.memory.v1';

export function loadMemory() {
  try {
    const m = JSON.parse(localStorage.getItem(MEM_KEY) || 'null');
    return m && typeof m === 'object' ? m : null;
  } catch (e) {
    return null;
  }
}

export function saveMemory(m) {
  try {
    if (m) localStorage.setItem(MEM_KEY, JSON.stringify(m));
    else localStorage.removeItem(MEM_KEY);
  } catch (e) { /* private mode */ }
}

// WHOSE LIST THIS IS.
//
// raffy, 2026-09-07: "make sure if switching account on same device only bring
// session from account don't mix it or overwrite."
//
// The list above is per-BROWSER, and mergeTrips unions it with whatever the
// account brings back. On one person's phone that is exactly right — trips made
// before signing in should follow them into the account. On a SHARED phone it
// is the bug: sign in as somebody else and you inherit the previous person's
// trips, because the browser never recorded who the list belonged to.
//
// So it records. Signing in as the same person keeps the list; signing in as
// somebody else drops it and takes theirs. Nothing is lost either way — the
// list is only pointers, and the trips themselves live on their owner's
// account, which is exactly where they come back from.
const OWNER_KEY = 'itin.trips.owner.v1';

export const tripsOwner = () => {
  try { return localStorage.getItem(OWNER_KEY) || ''; } catch (e) { return ''; }
};

const setTripsOwner = (email) => {
  try {
    if (email) localStorage.setItem(OWNER_KEY, email);
    else localStorage.removeItem(OWNER_KEY);
  } catch (e) { /* private mode */ }
};

/**
 * Hand this browser's trip list to whoever just signed in.
 *
 * Returns what the caller should do with the local list:
 *   'keep'  — same person, or trips made anonymously on this device that are
 *             theirs to carry. Union with the account's own.
 *   'drop'  — a different account. The local list is cleared and the account's
 *             becomes the whole truth.
 *
 * The anonymous case is the one worth being careful about: an empty owner means
 * either "trips this person just made before signing in" (carry them) or "the
 * previous person's, left behind by a sign-out". Sign-out clears the list, so an
 * empty owner with trips still in it can only be the first.
 */
export function adoptAccount(email) {
  const was = tripsOwner();
  if (!email) return 'keep';
  if (was && was !== email) {
    write([]);
    setTripsOwner(email);
    return 'drop';
  }
  setTripsOwner(email);
  return 'keep';
}

/** Signing out. The list and its owner go together or the next signer inherits. */
export function releaseAccount() {
  write([]);
  setTripsOwner('');
}
