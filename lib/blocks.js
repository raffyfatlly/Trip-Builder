// Rich content in the chat.
//
// A travel agent does not answer a hotel question with a paragraph. It shows
// you options with what they cost and why each one fits, and lets you pick.
// The agent emits those as a tool call; the chat renders them as cards.
//
// Same discipline as everything else here: the agent produces structured data,
// never markup. It cannot invent a new layout, only fill in these shapes.

export const PRESENT_TOOL = {
  type: 'custom',
  name: 'present',
  description:
    'Show the traveller something structured instead of describing it in prose: options to choose between, or the numbers you found. Use this whenever you have researched hotels, restaurants, activities, or costs. Send your short message in the same turn — the cards carry the detail, your message carries the recommendation.',
  input_schema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: ['options', 'facts'],
        description:
          '"options" for things they can pick between (hotels, restaurants, activities). "facts" for researched numbers with no choice attached (typical costs, opening hours, what a week there runs to).',
      },
      title: { type: 'string', description: 'Short heading, e.g. "Three hotels in An Thuong".' },
      intro: { type: 'string', description: 'One line of context. Optional.' },
      items: {
        type: 'array',
        description: 'For kind=options.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            price: {
              type: 'string',
              description:
                'What it costs, in local currency, with the unit. "RM480/night", "about 200,000 VND each". Say "price not found" rather than guessing.',
            },
            meta: { type: 'string', description: 'Area, distance, star rating — the one line that places it.' },
            why: { type: 'string', description: 'Why this one suits THEM specifically. The most important field.' },
            watch: { type: 'string', description: 'The catch, if there is one. Be honest.' },
            tags: { type: 'array', items: { type: 'string' } },
            link: { type: 'string', description: 'A URL, if you have a real one.' },
          },
          required: ['name', 'why'],
        },
      },
      facts: {
        type: 'array',
        description: 'For kind=facts.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            value: { type: 'string' },
            note: { type: 'string' },
          },
          required: ['label', 'value'],
        },
      },
      choose: {
        type: 'boolean',
        description:
          'For kind=options: true if picking one should move things forward. The traveller can still type instead.',
      },
    },
    required: ['kind', 'title'],
  },
};

// A present call and the reply that follows it belong together in the
// transcript, so blocks are pulled out of the event log in order alongside
// messages rather than collected separately.
export function blockFrom(event) {
  const b = event.input || {};
  if (!b.kind) return null;
  return {
    role: 'block',
    id: event.id,
    kind: b.kind,
    title: b.title || '',
    intro: b.intro || '',
    items: b.items || [],
    facts: b.facts || [],
    choose: !!b.choose,
  };
}
