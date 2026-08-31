// What we know about the trip so far.
//
// The agent used to build the moment it had four facts — destination, dates,
// who, one hotel — on the theory that a traveller staring at nothing is the
// worst outcome. That was wrong in practice: it produced a thin itinerary from
// a thin conversation, and then every improvement meant another rebuild at
// ~RM6.50 a go. (raffy, 2026-08-31: "not build it immediately. like chat
// session first. only when it have most of it ready then it builds.")
//
// So the conversation now runs until the trip is actually understood, and this
// is how both sides agree on what "understood" means. The agent reports what it
// has settled through note_plan; the traveller sees the same list filling up,
// so waiting never feels like being stuck.

export const SLOTS = [
  { key: 'destination', label: 'Where',     hint: 'City or area' },
  { key: 'dates',       label: 'When',      hint: 'Arriving and leaving' },
  { key: 'who',         label: 'Who',       hint: 'Names, and ages of any kids' },
  { key: 'stays',       label: 'Stays',     hint: 'Where they sleep each night' },
  { key: 'budget',      label: 'Budget',    hint: 'Roughly what they want to spend' },
  { key: 'flights',     label: 'Flights',   hint: 'Or how else they arrive' },
  { key: 'shape',       label: 'The trip',  hint: 'Pace, interests, food, what it is for' },
];

const KEYS = SLOTS.map((s) => s.key);

export const NOTE_TOOL = {
  type: 'custom',
  name: 'note_plan',
  description:
    'Record what you have settled about the trip. Call this whenever you learn something that fills one of the slots, and pass only the slots that changed — a short phrase each, in plain words. The traveller sees this list filling up, so it is how they know the planning is going somewhere. Set ready:true only when you genuinely have enough to build a good itinerary.',
  input_schema: {
    type: 'object',
    properties: {
      destination: { type: 'string', description: 'e.g. "Da Nang, Vietnam".' },
      dates: { type: 'string', description: 'e.g. "10-14 Sep 2026, 4 nights".' },
      who: { type: 'string', description: 'e.g. "Aisyah, Adam (6), Nur (3)".' },
      stays: { type: 'string', description: 'e.g. "Furama Resort, all 4 nights — booked". Say if it is still being decided.' },
      budget: { type: 'string', description: 'e.g. "around RM400 a night, RM6k all in".' },
      flights: { type: 'string', description: 'e.g. "AK1498 KUL-DAD, 10 Sep 06:55". Or "driving", or "not booked, flexible".' },
      shape: { type: 'string', description: 'Pace, interests, food needs, what the trip is really for.' },
      ready: { type: 'boolean', description: 'true when you have enough for a genuinely good itinerary.' },
    },
  },
};

// Replay the agent's notes into one plan. Later notes win, and a slot is never
// cleared by a later call that simply does not mention it.
export function planFrom(events) {
  const plan = { ready: false };
  for (const e of events) {
    if (e.type !== 'agent.custom_tool_use' || e.name !== 'note_plan') continue;
    const input = e.input || {};
    for (const k of KEYS) {
      if (typeof input[k] === 'string' && input[k].trim()) plan[k] = input[k].trim();
    }
    if (typeof input.ready === 'boolean') plan.ready = input.ready;
  }
  return plan;
}

export const filled = (plan) => KEYS.filter((k) => plan && plan[k]);
export const missing = (plan) => KEYS.filter((k) => !(plan && plan[k]));

// What the agent hears back. It carries the remaining slots so the agent does
// not have to re-derive its own checklist every turn.
export function noteResult(plan) {
  const left = missing(plan);
  if (!left.length) {
    return 'Noted. That is everything. If the traveller is happy, build it.';
  }
  return 'Noted. Still open: ' + left.join(', ') +
    '. Keep going — do not build yet unless they ask you to.';
}
