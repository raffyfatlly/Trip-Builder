// What the app remembers about someone between trips.
//
// raffy, 2026-08-31: "if they say they have family with age and name, it can be
// safe for future trips and so the agent have context on personal info."
//
// This is the difference between a tool and an assistant. The second trip
// should not start by asking who is coming — it should start by asking whether
// it is the same four of you.
//
// Three rules shape everything here.
//
// **Ages move.** "Adam is 6" is not a fact, it is a fact with a date on it. A
// trip planned two years later must know he is eight, or the memory is worse
// than none — it produces confident, wrong advice about naps and pushchairs.
// So an age is stored with when it was said, and read back as an estimate.
//
// **It is small on purpose.** Not a transcript, not embeddings: a handful of
// durable facts. Everything about one particular trip stays in that trip. What
// belongs here is what would still be true next year.
//
// **They can see all of it and delete any of it.** A memory the person cannot
// inspect is not a feature, it is surveillance. It is listed in the drawer in
// plain words, and every line has a remove button.

export const MEMORY_VERSION = 1;

export const REMEMBER_TOOL = {
  type: 'custom',
  name: 'remember',
  description:
    'Save something about this traveller that will still be true on their NEXT trip — who they travel with, ages, dietary needs, where they fly from, how they like to travel. Not trip details: dates, this hotel, this itinerary do not belong here. Call it the moment you learn something durable, and pass only what changed. They can see and delete everything you save.',
  input_schema: {
    type: 'object',
    properties: {
      people: {
        type: 'array',
        description: 'Who they travel with, including themselves. Pass the whole list when it changes — it replaces what is stored.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'integer', description: 'Age NOW, in years. Only for children — leave out for adults, where it stops mattering and starts being intrusive.' },
            note: { type: 'string', description: 'Something durable and useful: "gets carsick", "wants the photos", "uses a wheelchair". Not a mood.' },
          },
          required: ['name'],
        },
      },
      home: { type: 'string', description: 'Where they travel from, e.g. "Kuala Lumpur". Decides likely airports and flight times.' },
      dietary: { type: 'string', description: 'Halal, vegetarian, allergies — anything that constrains every meal on every trip.' },
      pace: { type: 'string', description: 'How they like to travel: "slow, one thing a day", "packed, out from dawn".' },
      interests: { type: 'string', description: 'What they go travelling for. Durable, not this-trip.' },
      budget: { type: 'string', description: 'The band they usually travel in, in their currency.' },
      notes: {
        type: 'array',
        description: 'Anything else worth knowing next time. One short sentence each. Add sparingly — this is not a diary.',
        items: { type: 'string' },
      },
    },
  },
};

export const FORGET_TOOL = {
  type: 'custom',
  name: 'forget',
  description:
    'Remove something you have saved about this traveller, when they ask you to or when you learn it was wrong. Pass the field names to clear: people, home, dietary, pace, interests, budget, notes.',
  input_schema: {
    type: 'object',
    properties: {
      fields: { type: 'array', items: { type: 'string' } },
    },
    required: ['fields'],
  },
};

// Also the labels shown to the traveller, so the list they can delete from and
// the list the agent can write to cannot drift apart.
export const SLOT_LABELS = {
  people: 'Travels with',
  home: 'Travels from',
  dietary: 'Food',
  pace: 'Pace',
  interests: 'Goes travelling for',
  budget: 'Usual budget',
  notes: 'Also',
};

const FIELDS = Object.keys(SLOT_LABELS);

const cleanPerson = (p, now) => {
  if (!p || !p.name) return null;
  const out = { name: String(p.name).slice(0, 40) };
  if (Number.isInteger(p.age) && p.age >= 0 && p.age < 120) {
    out.age = p.age;
    // The year they were born, near enough. Storing this rather than the age
    // is what lets the memory stay true instead of quietly going stale.
    out.bornAbout = new Date(now).getUTCFullYear() - p.age;
  }
  if (p.note) out.note = String(p.note).slice(0, 120);
  return out;
};

// Fold one remember/forget call into the stored profile.
export function applyMemory(memory, name, input, now = Date.now()) {
  const m = { ...(memory || {}), v: MEMORY_VERSION };

  if (name === 'forget') {
    for (const f of (input && input.fields) || []) {
      if (FIELDS.includes(f)) delete m[f];
    }
    m.at = now;
    return m;
  }

  if (name !== 'remember' || !input) return memory;

  if (Array.isArray(input.people)) {
    const people = input.people.map((p) => cleanPerson(p, now)).filter(Boolean).slice(0, 12);
    if (people.length) m.people = people;
  }
  for (const f of ['home', 'dietary', 'pace', 'interests', 'budget']) {
    if (typeof input[f] === 'string' && input[f].trim()) m[f] = input[f].trim().slice(0, 200);
  }
  if (Array.isArray(input.notes)) {
    const add = input.notes.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim().slice(0, 160));
    // Newest first, deduped, and capped — a memory that only grows becomes a
    // transcript, which is the thing this is not.
    m.notes = [...new Set([...add, ...(m.notes || [])])].slice(0, 12);
  }
  m.at = now;
  return m;
}

// Replay this session's remember/forget calls onto what was already known.
export function memoryFrom(events, base) {
  let m = base || null;
  for (const e of events) {
    if (e.type !== 'agent.custom_tool_use') continue;
    if (e.name !== 'remember' && e.name !== 'forget') continue;
    m = applyMemory(m, e.name, e.input);
  }
  return m;
}

// How old someone is now, given when we were told. Returns null when we were
// never told, rather than guessing.
export function ageNow(person, now = Date.now()) {
  if (!person || !Number.isInteger(person.bornAbout)) {
    return Number.isInteger(person.age) ? person.age : null;
  }
  return new Date(now).getUTCFullYear() - person.bornAbout;
}

export const isEmpty = (m) => !m || !FIELDS.some((f) => m[f] && (!Array.isArray(m[f]) || m[f].length));

// The block the agent sees. Written as things known, with their vintage, so it
// treats them as a starting point to confirm rather than as gospel.
export function memoryBlock(memory, now = Date.now()) {
  if (isEmpty(memory)) return '';

  const lines = ['What you already know about this traveller, from previous trips:'];

  if ((memory.people || []).length) {
    lines.push('- Travels with: ' + memory.people.map((p) => {
      const a = ageNow(p, now);
      const aged = Number.isInteger(a) && Number.isInteger(p.bornAbout) && a !== p.age;
      return p.name
        + (a != null ? ` (${aged ? 'about ' : ''}${a})` : '')
        + (p.note ? ` — ${p.note}` : '');
    }).join('; '));
  }
  if (memory.home) lines.push('- Travels from: ' + memory.home);
  if (memory.dietary) lines.push('- Food: ' + memory.dietary);
  if (memory.pace) lines.push('- Pace: ' + memory.pace);
  if (memory.interests) lines.push('- Goes travelling for: ' + memory.interests);
  if (memory.budget) lines.push('- Usual budget: ' + memory.budget);
  for (const n of memory.notes || []) lines.push('- ' + n);

  lines.push(
    'Use it so they do not have to repeat themselves — but it is from a past trip, not this one. '
    + 'Confirm rather than assume: who is coming can change, and ages given here are estimated forward from when they were told to you. '
    + 'Never read this list back at them as a list.');

  return lines.join('\n');
}
