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
