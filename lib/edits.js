// Manual edits to the itinerary.
//
// The itinerary itself is replayed from the builder session's event log and is
// therefore read-only — there is nowhere to write it back to. Manual edits are
// kept as a separate list of operations and applied on top after the replay.
// Costs nothing, needs no round trip, and survives a rebuild.
//
// Ops address items by a STABLE ID, not an array index. Indices shift the
// moment an edit re-sorts a day by time, so an index captured from what the
// user is looking at no longer points at the same thing by the time it is
// applied — that bug deleted the wrong item in testing.
//
// Ids are derived from the base itinerary (`b<day>-<item>`), so they survive
// sorting, insertion and deletion. Items added by hand get their own (`a<n>`).
//
// Each op also remembers the heading it was pointing at (`was`). If a REBUILD
// replaces the base, an op whose anchor no longer matches is dropped rather
// than applied to whatever now holds that id — a stale edit silently rewriting
// the wrong dinner is worse than the edit being lost.

export const OPS = [
  'item.update', 'item.delete', 'item.add', 'day.update', 'stay.update',
  'photo.set', 'photo.clear',
  // A real booking: a reference number, a time, an address — the things you
  // need at a counter at 6am. raffy, 2026-09-01: "im not happy with the
  // booking tab. feels superficial especially like its an app."
  //
  // It was superficial because it held nothing of its own: the same stays as
  // the Trip tab, with a badge. A booking is the first thing in this app that
  // is the traveller's own record rather than a view of the plan, and it rides
  // the same edit list as photos and confirmations — kept beside the itinerary,
  // applied on top, surviving a rebuild.
  'booking.set', 'booking.clear',
  // A thing that still has to be arranged. Most of the list is derived from
  // the plan (see checklist.js) — these are the ones a plan cannot imply: a
  // visa, an eSIM, a restaurant that books out a month ahead. Same edit list,
  // so they survive a rebuild like everything else.
  'task.set', 'task.clear',
];

// A photo the traveller supplied. The itinerary's `photo` fields are keys into
// its photos map, so a manual photo needs a key of its own that cannot collide
// with anything the builder chose.
const photoKey = (op) =>
  'm-' + (op.target === 'feature' ? 'feature'
    : op.target === 'stay' ? 'stay' + op.index
    : op.day + '-' + op.id);

const clone = (o) => JSON.parse(JSON.stringify(o));

// Sort key for an item's time. Mirrors the renderer's own parsing so a time
// edited here lands where the built app would put it.
function timeKey(t) {
  const s = String(t || '').trim().toLowerCase().replace(/^~/, '');
  if (s.startsWith('morning')) return 9 * 60;
  if (s.startsWith('afternoon')) return 14 * 60;
  if (s.startsWith('evening')) return 19 * 60;
  if (s.startsWith('all day')) return 0;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2] || '0', 10);
  const ap = m[3];
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h * 60 + min;
}

// Items with an unparseable time inherit the previous item's position, so the
// authored order holds rather than collapsing to the top.
export function sortItems(items) {
  let last = 0;
  const keyed = items.map((it, i) => {
    const k = timeKey(it.t);
    if (k != null) last = k;
    return { it, i, k: k == null ? last : k };
  });
  keyed.sort((a, b) => (a.k - b.k) || (a.i - b.i));
  return keyed.map((x) => x.it);
}

function anchorOk(op, target) {
  if (!op.was) return true;
  if (!target) return false;
  return (target.h || '') === op.was;
}

// Stamp every item with an id derived from its position in the BASE, before
// any edit has moved it.
function withIds(base) {
  const out = clone(base);
  (out.days || []).forEach((d, di) => {
    (d.items || []).forEach((it, ii) => { it._id = 'b' + di + '-' + ii; });
  });
  return out;
}

const findItem = (day, id) => (day.items || []).findIndex((it) => it._id === id);

// A day item that is really a to-do.
//
// raffy, 2026-09-02, for the third time: "if the agent can pass it in my days
// section, he can put it in the to do page." He is right, and the evidence was
// in his own session log — the agent had written:
//
//   {"op":"add","day":0,"item":{"h":"Renew passport","t":"Before you fly",
//    "tags":["To-do","Reminder"], ...}}
//
// It KNEW. It tagged the thing "To-do" and put "Before you fly" in the time
// field, which is not a time — it was trying to say "this does not happen on
// this day" through the only field it had. Two rounds of sharpening the prompt
// did not change that, and a third would have been the same bet again.
//
// So it is decided here instead, in code, where it cannot be talked out of.
// The signal is what the agent itself wrote down, not a guess about intent.
const TODO_TAG = /^(to-?dos?|reminder|admin|errand|before you (fly|go|leave))$/i;
// Deliberately narrow. "Morning", "All day" and "~4:00pm" are real day items
// with a fuzzy time; these are phrases that explicitly place the thing OUTSIDE
// the day it was filed on.
const NOT_A_TIME = /^(before you (fly|go|leave)|day of (the )?(flight|departure)|before (the )?(trip|departure)|beforehand|anytime before)$/i;

export function looksLikeTask(x) {
  if (!x) return false;
  if ((x.tags || []).some((t) => TODO_TAG.test(String(t).trim()))) return true;
  return NOT_A_TIME.test(String(x.t || '').trim());
}

// Which list it belongs on, from what it says about itself.
export function taskKindOf(x) {
  const s = ((x.h || '') + ' ' + (x.p || '')).toLowerCase();
  if (/visa|e-?visa|passport/.test(s)) return 'visa';
  if (/insurance|esim|e-sim|roaming|sim card|licence|license|permit|vaccin/.test(s)) return 'admin';
  if (/flight|airline/.test(s)) return 'flight';
  if (/hotel|room|stay/.test(s)) return 'stay';
  if (/transfer|taxi|grab|pickup|car/.test(s)) return 'transfer';
  if (/ticket|book/.test(s)) return 'ticket';
  return 'other';
}

// The same conversion, used by both paths: a day item becomes a task.
export function taskFromItem(x, id) {
  return {
    id,
    what: x.h || 'Something to sort',
    why: x.p || '',
    kind: taskKindOf(x),
    // "Before you fly" is not a deadline either. Leave it unset and let the
    // checklist give it one from the trip's own dates.
    by: /^\d{4}-\d{2}-\d{2}$/.test(String(x.t || '')) ? x.t : undefined,
  };
}

// Anything already sitting on a day that is really a to-do moves across.
//
// A migration, not just a guard on new edits: three of these were already in
// his trip by the time he reported it, and telling him to add them again would
// be making him pay for our bug. It runs on every replay and is idempotent —
// the item leaves the day, so there is nothing left to convert next time.
function rehome(out) {
  (out.days || []).forEach((day, i) => {
    if (!day.items) return;
    const keep = [];
    for (const x of day.items) {
      if (!looksLikeTask(x)) { keep.push(x); continue; }
      // Keyed by what it says, not where it sits. withIds() numbers items by
      // position, so a position-based key would change the moment anything is
      // added above it — and a to-do they had already ticked off would come
      // back unticked. The heading is what identifies the thing to them.
      const id = 'mv:' + String(x.h || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      // Anything the traveller already did to this one — ticked it off, took
      // it off the list — was recorded against this id and wins.
      const was = (out.tasks || []).find((t) => t.id === id) || {};
      out.tasks = [...(out.tasks || []).filter((t) => t.id !== id),
        { ...taskFromItem(x, id), ...was, id }];
    }
    day.items = keep;
  });
  return out;
}

export function applyEdits(base, edits) {
  if (!base) return base;
  const out = withIds(base);
  // Before the early return as well: a trip with no edits at all still has to
  // come back with its to-dos in the right place.
  if (!edits || !edits.length) return rehome(out);

  const touched = new Set();
  let added = 0;

  for (const op of edits) {
    // Photos first: they address the same things as the other ops but do not
    // touch item ordering, so they never need the sort pass below.
    if (op.type === 'photo.set' || op.type === 'photo.clear') {
      const set = op.type === 'photo.set';
      const key = photoKey(op);
      out.photos = { ...(out.photos || {}) };
      if (set) out.photos[key] = op.url; else delete out.photos[key];

      const stamp = (obj) => {
        if (!obj) return;
        if (set) {
          obj.photo = key;
          if (op.credit) obj.credit = op.credit;
        } else if (obj.photo === key) {
          delete obj.photo;
          delete obj.credit;
        }
      };

      if (op.target === 'feature') {
        out.trip = { ...out.trip, feature: { ...((out.trip || {}).feature || {}) } };
        stamp(out.trip.feature);
      } else if (op.target === 'stay') {
        stamp(out.stays && out.stays[op.index]);
      } else {
        const day = out.days && out.days[op.day];
        if (day) {
          const at = findItem(day, op.id);
          if (at >= 0) stamp(day.items[at]);
        }
      }
      continue;
    }

    if (op.type === 'booking.set' || op.type === 'booking.clear') {
      const list = (out.bookings || []).filter((b) => b.id !== op.id);
      if (op.type === 'booking.set') {
        list.push({ ...(op.booking || {}), id: op.id, at: op.ts || 0 });
      }
      // Newest last, so the list reads in the order they arranged the trip.
      out.bookings = list;
      continue;
    }

    if (op.type === 'task.set' || op.type === 'task.clear') {
      const list = (out.tasks || []).filter((t) => t.id !== op.id);
      if (op.type === 'task.set') {
        // A patch, not a replacement: ticking one off must not need the whole
        // task sent back, and the agent adding a deadline must not wipe a note.
        const was = (out.tasks || []).find((t) => t.id === op.id) || {};
        list.push({ ...was, ...(op.task || {}), id: op.id });
      }
      out.tasks = list;
      continue;
    }

    if (op.type === 'stay.update') {
      const st = out.stays && out.stays[op.index];
      if (st) Object.assign(st, op.patch);
      continue;
    }

    const d = out.days && out.days[op.day];
    if (!d) continue;

    if (op.type === 'day.update') {
      Object.assign(d, op.patch);
      continue;
    }

    if (op.type === 'item.add') {
      d.items = d.items || [];
      d.items.push({ ...clone(op.item), _id: op.id || ('a' + (added++)) });
      touched.add(op.day);
      continue;
    }

    const at = findItem(d, op.id);
    if (at < 0) continue;
    const it = d.items[at];
    if (!anchorOk(op, it)) continue;

    if (op.type === 'item.update') {
      d.items[at] = { ...it, ...op.patch, _id: it._id };
      touched.add(op.day);
    } else if (op.type === 'item.delete') {
      d.items[at] = null;
    }
  }

  (out.days || []).forEach((day, i) => {
    if (!day.items) return;
    day.items = day.items.filter(Boolean);
    if (touched.has(i)) day.items = sortItems(day.items);
  });

  return rehome(out);
}

// How many edits no longer land — used to tell the user when a rebuild has
// orphaned their changes rather than letting them vanish quietly.
export function countStale(base, edits) {
  if (!base || !edits || !edits.length) return 0;
  const ids = withIds(base);
  let stale = 0;
  for (const op of edits) {
    // A photo op has no bearing on whether an item still exists in the way an
    // edit to its text does — but it does point at one, so an orphaned target
    // counts the same as any other stale edit.
    if (op.type === 'photo.set' || op.type === 'photo.clear') {
      if (op.target === 'feature') continue;
      if (op.target === 'stay') {
        if (!(ids.stays && ids.stays[op.index])) stale++;
        continue;
      }
      const day = ids.days && ids.days[op.day];
      if (!day || findItem(day, op.id) < 0) stale++;
      continue;
    }

    if (op.type === 'task.set' || op.type === 'task.clear') {
      const list = (out.tasks || []).filter((t) => t.id !== op.id);
      if (op.type === 'task.set') {
        // A patch, not a replacement: ticking one off must not need the whole
        // task sent back, and the agent adding a deadline must not wipe a note.
        const was = (out.tasks || []).find((t) => t.id === op.id) || {};
        list.push({ ...was, ...(op.task || {}), id: op.id });
      }
      out.tasks = list;
      continue;
    }

    if (op.type === 'stay.update') {
      if (!(ids.stays && ids.stays[op.index])) stale++;
      continue;
    }
    const d = ids.days && ids.days[op.day];
    if (!d) { stale++; continue; }
    if (op.type === 'item.add' || op.type === 'day.update') continue;
    const at = findItem(d, op.id);
    if (at < 0 || !anchorOk(op, d.items[at])) stale++;
  }
  return stale;
}

// `_id` is internal bookkeeping. Strip it before rendering or downloading so
// it never reaches the finished file.
export function forRender(it) {
  if (!it) return it;
  const out = clone(it);
  (out.days || []).forEach((d) => (d.items || []).forEach((x) => { delete x._id; }));
  return out;
}

const KEY = (session) => 'itin.edits.' + session;

export function loadEdits(session) {
  try {
    return JSON.parse(localStorage.getItem(KEY(session)) || '[]');
  } catch (e) {
    return [];
  }
}

export function saveEdits(session, edits) {
  try {
    localStorage.setItem(KEY(session), JSON.stringify(edits));
  } catch (e) { /* private mode, or full: edits stay in memory for this visit */ }
}

export function blankItem() {
  return { t: '', h: '', p: '', tags: [] };
}
