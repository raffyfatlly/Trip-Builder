// The itinerary is never stored. It is REPLAYED from the session's own event
// log every time it is needed: each agent.custom_tool_use event is one edit,
// applied in order. The event log is the database.
//
// That is what lets the server keep no state at all — no rows, no blobs, no
// session table. It also means the itinerary can never drift out of sync with
// the conversation that produced it.

export const TOOL_NAMES = ['save_itinerary', 'add_photos', 'update_day', 'update_stay', 'update_trip', 'add_idea'];

// A rebuild used to lose every picture except the ones it happened to set again.
//
// raffy, 2026-09-02: "some photos are missing the built app (hotel) then when i
// say it rebuild . when it rebuild hotel photo is there , but the other photos
// goes missing."
//
// The photos MAP survives a rebuild — that was deliberate, they are expensive
// to find. What does not survive is the ATTACHMENT: `photo: <key>` lives on the
// stay, the item, the idea, and save_itinerary replaces those arrays wholesale.
// So every rebuild wiped the lot and left only whatever the new build attached
// itself, which is why one thing has its picture and the rest are blank.
//
// The pictures are still there. They just lost their labels. So relabel them:
// anything that had a photo before, matched by the name of the place, gets it
// back — but only where the new build did not attach one, so a fresh choice
// always wins over an old one.
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function photoIndex(prev) {
  const by = new Map();
  const put = (name, o) => {
    const k = norm(name);
    if (!k || !o || !o.photo || by.has(k)) return;
    const meta = { photo: o.photo };
    if (o.credit) meta.credit = o.credit;
    if (o.licence) meta.licence = o.licence;
    by.set(k, meta);
  };
  if (!prev) return by;
  for (const st of prev.stays || []) put(st.n || st.short, st);
  for (const d of prev.days || []) for (const x of d.items || []) put(x.h, x);
  for (const i of prev.ideas || []) put(i.n || i.h, i);
  return by;
}

function reattachPhotos(next, prev) {
  const by = photoIndex(prev);
  if (!by.size) return next;
  const take = (name, o) => {
    if (!o || o.photo) return o;              // the new build chose one: leave it
    const hit = by.get(norm(name));
    return hit && next.photos[hit.photo] ? { ...o, ...hit } : o;
  };
  next.stays = (next.stays || []).map((st) => take(st.n || st.short, st));
  next.days = (next.days || []).map((d) => ({
    ...d, items: (d.items || []).map((x) => take(x.h, x)),
  }));
  next.ideas = (next.ideas || []).map((i) => take(i.n || i.h, i));

  // The feature card is one object rather than a list, so it is matched on the
  // trip itself rather than by name.
  const pf = prev && prev.trip && prev.trip.feature;
  const nf = next.trip && next.trip.feature;
  if (pf && pf.photo && nf && !nf.photo && next.photos[pf.photo]) {
    next.trip = { ...next.trip, feature: { ...nf, photo: pf.photo,
      ...(pf.credit ? { credit: pf.credit } : {}), ...(pf.licence ? { licence: pf.licence } : {}) } };
  }
  return next;
}

// Apply one tool call to the itinerary. Returns the new itinerary.
export function applyEdit(state, name, input) {
  if (!input) return state;

  if (name === 'save_itinerary') {
    // A second save that is smaller than the trip already on screen is refused.
    //
    // save REPLACES the itinerary, and a builder that has already written seven
    // days and then calls save again with one has just deleted six of them.
    // raffy, 2026-09-05: "days wrong. 7 days can become 1." One real build
    // called save_itinerary three times and he got the last one.
    //
    // Growing is fine — that is a builder that has thought of more. Shrinking is
    // never what anybody meant, and update_day is there for a correction.
    if (state && (state.days || []).length > 1) {
      const had = (state.days || []).length;
      const now = (input.days || []).length;
      if (now < had) return state;
    }
    return reattachPhotos({
      trip: input.trip || {},
      stays: input.stays || [],
      days: input.days || [],
      ideas: input.ideas || [],
      areas: input.areas || [],
      // Photos survive a rebuild: they were expensive to find and are not
      // what changed.
      photos: { ...((state && state.photos) || {}), ...(input.photos || {}) },
    }, state);
  }

  // Every other edit is a no-op until the itinerary exists.
  if (!state) return state;
  const next = { ...state };

  if (name === 'update_trip') {
    next.trip = { ...next.trip, ...(input.trip || {}) };
    return next;
  }
  if (name === 'update_day') {
    const i = input.index;
    if (!Number.isInteger(i) || !input.day) return state;
    next.days = [...next.days];
    // Allow appending at the end, but never leave a hole in the array.
    if (i < 0 || i > next.days.length) return state;
    next.days[i] = input.day;
    return next;
  }
  if (name === 'update_stay') {
    const i = input.index;
    if (!Number.isInteger(i) || !input.stay) return state;
    next.stays = [...next.stays];
    if (i < 0 || i > next.stays.length) return state;
    next.stays[i] = input.stay;
    return next;
  }
  if (name === 'add_photos') {
    next.photos = { ...(next.photos || {}), ...(input.photos || {}) };
    for (const a of input.attach || []) {
      if (!a || !a.key || !next.photos[a.key]) continue;
      const meta = {};
      if (a.credit) meta.credit = a.credit;
      if (a.licence) meta.licence = a.licence;

      if (a.target === 'feature') {
        next.trip = { ...next.trip, feature: { ...(next.trip.feature || {}), photo: a.key, ...meta } };
      } else if (a.target === 'stay' && Number.isInteger(a.stay) && next.stays[a.stay]) {
        next.stays = [...next.stays];
        next.stays[a.stay] = { ...next.stays[a.stay], photo: a.key, ...meta };
      } else if (a.target === 'idea' && Number.isInteger(a.idea) && (next.ideas || [])[a.idea]) {
        next.ideas = [...next.ideas];
        next.ideas[a.idea] = { ...next.ideas[a.idea], photo: a.key, ...meta };
      } else if (a.target === 'item' && Number.isInteger(a.day) && next.days[a.day]) {
        const d = { ...next.days[a.day] };
        const items = [...(d.items || [])];
        // Items carry no id in the base itinerary, so match on the same
        // b<day>-<index> scheme the edit layer uses.
        const idx = a.id ? Number(String(a.id).split('-')[1]) : -1;
        if (items[idx]) {
          items[idx] = { ...items[idx], photo: a.key, ...meta };
          d.items = items;
          next.days = [...next.days];
          next.days[a.day] = d;
        }
      }
    }
    return next;
  }

  if (name === 'add_idea') {
    if (!input.idea) return state;
    next.ideas = [...next.ideas, input.idea];
    return next;
  }
  return state;
}

// Replay the whole event log into the current itinerary.
export function buildItinerary(events) {
  let state = null;
  for (const e of events) {
    if (e.type !== 'agent.custom_tool_use') continue;
    if (!TOOL_NAMES.includes(e.name)) continue;
    state = applyEdit(state, e.name, e.input);
  }
  return state;
}

// What the agent hears back after each edit. Kept short and factual — this
// text costs tokens on every single turn.
/**
 * A compact index of the itinerary as it now stands.
 *
 * The builder writes the whole trip in one save_itinerary call, and those
 * arguments — thirty to fifty kilobytes of JSON — then sit in the conversation
 * and get re-sent on every one of the ten to thirteen calls that follow. Real
 * builds reached 87kB by the end and two of eight hit the step ceiling.
 *
 * It does not need to re-read what it wrote. update_day and update_stay
 * replace the object outright, update_trip merges into it, and add_photos
 * targets by index — so what a follow-up actually needs is the index, and this
 * is the index, at about a fortieth of the size.
 */
export function digest(state) {
  if (!state) return '';
  const line = (arr, name) => {
    const list = (arr || []).map((x, i) => i + ' ' + String(name(x) || '').slice(0, 42).trim());
    return list.length ? list.join('  |  ') : 'none';
  };
  return [
    'Where it stands now:',
    'days:  ' + line(state.days, (d) => [d.dow, d.dom, d.title].filter(Boolean).join(' ')),
    'stays: ' + line(state.stays, (x) => x.short || x.n),
    'ideas: ' + line(state.ideas, (x) => x.n),
    Object.keys(state.photos || {}).length + ' photos attached.',
    'Those numbers are the indexes to edit by.',
  ].join('\n');
}

export function resultFor(name, state) {
  if (!state) return 'Not applied: call save_itinerary first.';
  const d = state.days ? state.days.length : 0;
  const s = state.stays ? state.stays.length : 0;
  const head = name === 'add_photos'
    ? `Photos added. ${Object.keys(state.photos || {}).length} now attached.`
    : name === 'save_itinerary'
      ? `Itinerary saved and showing to the traveller: ${d} days, ${s} stays.`
      : `Applied. Now ${d} days, ${s} stays, ${(state.ideas || []).length} ideas.`;
  // The index goes back with every edit, so the model is never working from
  // memory of a document it can no longer see.
  return head + '\n\n' + digest(state);
}
