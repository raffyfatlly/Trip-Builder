// The itinerary is never stored. It is REPLAYED from the session's own event
// log every time it is needed: each agent.custom_tool_use event is one edit,
// applied in order. The event log is the database.
//
// That is what lets the server keep no state at all — no rows, no blobs, no
// session table. It also means the itinerary can never drift out of sync with
// the conversation that produced it.

export const TOOL_NAMES = ['save_itinerary', 'update_day', 'update_stay', 'update_trip', 'add_idea'];

// Apply one tool call to the itinerary. Returns the new itinerary.
export function applyEdit(state, name, input) {
  if (!input) return state;

  if (name === 'save_itinerary') {
    return {
      trip: input.trip || {},
      stays: input.stays || [],
      days: input.days || [],
      ideas: input.ideas || [],
      areas: input.areas || [],
      photos: (state && state.photos) || {},
    };
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
export function resultFor(name, state) {
  if (!state) return 'Not applied: call save_itinerary first.';
  const d = state.days ? state.days.length : 0;
  const s = state.stays ? state.stays.length : 0;
  if (name === 'save_itinerary') {
    return `Itinerary created and now showing to the traveller: ${d} days, ${s} stays. Use update_day / update_stay / add_idea for further changes.`;
  }
  return `Applied. Now ${d} days, ${s} stays, ${(state.ideas || []).length} ideas.`;
}
