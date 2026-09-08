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
        enum: ['options', 'facts', 'spots'],
        description:
          '"options" for things they can pick between (hotels, restaurants, activities). "facts" for researched numbers with no choice attached (typical costs, opening hours, what a week there runs to). "spots" for the places people are actually photographing there right now — the ones going round TikTok and Instagram, and for a set of things to do that they should triage. Set pick:"many" on these so each one gets yes / maybe / no.',
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
                'What it costs, in RINGGIT, with the unit: "RM480/night", "about RM35 each". Convert anything you found in another currency — every price in the app is RM so they can be compared without arithmetic. Say "price not found" rather than guessing.',
            },
            meta: { type: 'string', description: 'Area, distance, what kind of place it is — the one line that places it.' },
            rating: {
              type: 'string',
              description:
                'What people actually score it, with the source and the count: "4.6 on Google, 2,300 reviews", "8.9 on Booking". The first thing a traveller looks for, so look it up. Yours wins when you have one — a Booking or Agoda score often says more than a Google one — and the app fills in Google\'s if you leave it empty. Never invent one.',
            },
            why: { type: 'string', description: 'Why this one suits THEM specifically. The most important field.' },
            watch: { type: 'string', description: 'The catch, if there is one. Be honest.' },
            tags: {
              type: 'array',
              maxItems: 4,
              description:
                'Two to four HARD facts, three or four words each, shown as pills: "8 min walk to the beach", "Free cancellation", "Kids club", "Cash only", "Closed Tuesdays". These are what someone scans to choose, so make them the deciding differences between these options rather than adjectives that could describe any of them. Not "lovely" or "great location".',
              items: { type: 'string' },
            },
            link: { type: 'string', description: "The place's own website or booking page. Prefer `links` — this is the single-link version and still works." },
            links: {
              type: 'array',
              description:
                'Everything worth opening about this place, in the order you would open them: the booking page, their own site, the menu, the ticket page, the review or the post you found it in. Give every one your research turned up — the traveller should never have to leave for a search engine and type the name back in. A map link is added automatically, so do not add one. Never invent a URL.',
              maxItems: 5,
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Two or three words: "Book on Agoda", "Their menu", "The TikTok", "Reddit thread".' },
                  url: { type: 'string' },
                },
                required: ['label', 'url'],
              },
            },
            source: {
              type: 'string',
              description:
                'Where this recommendation actually came from, when it is not the obvious list: "top of r/VietnamTravel this year", "a TikTok with 400k views", "the food blogger every local links to". Say it — a place found somewhere real is worth more than a place found in a top-ten, and the traveller can judge it.',
            },
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
      spots: {
        type: 'array',
        description: 'For kind=spots. Places that are genuinely getting attention right now, not a generic top-ten list.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            buzz: {
              type: 'string',
              description: 'What people are actually posting, and the shot itself. "The glass walkway over the gorge — the shot everyone does is from the far end looking back." Say where you saw it doing the rounds.',
            },
            meta: { type: 'string', description: 'Where it is and how far from them.' },
            best: { type: 'string', description: 'When to go for the photo: golden hour, before 8am, weekends only.' },
            rating: { type: 'string', description: 'What it scores and where, if it is a place with reviews. Never guess one.' },
            watch: { type: 'string', description: 'The queue, the fee, the two-hour drive. Be honest — a viral spot is often a bad morning.' },
            tags: {
              type: 'array',
              maxItems: 4,
              description: 'Two to four hard facts, three or four words each: "40 min drive", "Free", "Before 8am", "Cable car RM120".',
              items: { type: 'string' },
            },
            link: { type: 'string', description: "The place's own page. Prefer `links`." },
            links: {
              type: 'array',
              description:
                'Everything worth opening about this place, in the order you would open them: the booking page, their own site, the menu, the ticket page, the review or the post you found it in. Give every one your research turned up — the traveller should never have to leave for a search engine and type the name back in. A map link is added automatically, so do not add one. Never invent a URL.',
              maxItems: 5,
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Two or three words: "Book on Agoda", "Their menu", "The TikTok", "Reddit thread".' },
                  url: { type: 'string' },
                },
                required: ['label', 'url'],
              },
            },
            source: {
              type: 'string',
              description:
                'Where this recommendation actually came from, when it is not the obvious list: "top of r/VietnamTravel this year", "a TikTok with 400k views", "the food blogger every local links to". Say it — a place found somewhere real is worth more than a place found in a top-ten, and the traveller can judge it.',
            },
          },
          required: ['name', 'buzz'],
        },
      },
      choose: {
        type: 'boolean',
        description:
          'For kind=options: true if picking should move things forward. The traveller can still type instead.',
      },
      pick: {
        type: 'string',
        enum: ['one', 'many'],
        description:
          'How many of these they are meant to answer. Default "one" — they pick a hotel and you reply. Use "many" whenever this one card set needs more than one answer: a hotel in each of two cities, three restaurants for three nights, and ALWAYS for a set of things to do. With "many" every card gets yes / maybe / no and they answer the whole set in one message, so you learn what they ruled out as well as what they want — instead of reacting to the first tick and asking about the rest again.',
      },
    },
    required: ['kind', 'title'],
  },
};

// A present call and the reply that follows it belong together in the
// transcript, so blocks are pulled out of the event log in order alongside
// messages rather than collected separately.
/**
 * A literal \uXXXX that a model wrote instead of the character it meant.
 *
 * Found by reading a real proposal card: "RM320\u2014360" was on screen, in
 * front of a traveller, in a cost line. The model had double-escaped the em
 * dash in its tool input, so what decoded was the six characters rather than
 * the punctuation.
 *
 * It is a model quirk and it will happen again, so the app absorbs it rather
 * than the reader. Only \uXXXX is touched — a lone backslash before anything
 * else is left exactly as it was written.
 */
export function unlit(v) {
  if (typeof v !== 'string') return v;
  if (v.indexOf('\\u') === -1) return v;
  return v.replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => {
    const n = parseInt(h, 16);
    // Control characters are not what anybody meant to write.
    return n >= 32 ? String.fromCharCode(n) : m;
  });
}

// Every string in a card, however deeply it is nested.
export function unlitDeep(v) {
  if (typeof v === 'string') return unlit(v);
  if (Array.isArray(v)) return v.map(unlitDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = unlitDeep(v[k]);
    return out;
  }
  return v;
}

export function blockFrom(event) {
  const b = unlitDeep(event.input || {});
  const proposal = event.name === 'propose_trip';
  if (!b.kind && !proposal) return null;

  // WHICH LIST THIS CARD SET ACTUALLY HAS ROWS IN.
  //
  // `kind` decides which array components/Blocks.js draws: options reads
  // `items`, spots reads `spots`, facts reads `facts`. Say one and fill
  // another — which the agent does, because they are three fields on one tool
  // and the distinction between "options" and "spots" is a judgement call — and
  // the renderer looks in an empty array and draws a heading with nothing under
  // it. The row shape is what really decides how it should be drawn, so the
  // filled list wins over the named kind.
  const ROWS = { options: 'items', spots: 'spots', facts: 'facts' };
  const rowsIn = (k) => ((b[ROWS[k]] || []).length);
  const kind = proposal ? 'proposal'
    : (rowsIn(b.kind) ? b.kind : (['options', 'spots', 'facts'].find(rowsIn) || b.kind));

  // A CARD SET WITH NO CARDS IS NOT A CARD SET.
  //
  // raffy, 2026-09-08, with a screenshot of a heading, a sentence and a "Yes,
  // maybe or no on each" box with nothing above it: "sometimes it gives this.
  // yes maybe and no but no list."
  //
  // The agent called `present` with a title and an intro and an empty list —
  // it happens when a search comes back with nothing it trusts, or when it
  // reaches for the tool before it has anything to put in it. The app drew the
  // frame anyway: a question about items that were never shown, which cannot be
  // answered and cannot be dismissed.
  //
  // Nothing here can invent the missing cards, so the honest thing is to draw
  // nothing and let the agent's own message carry the turn. Returning null puts
  // the block back exactly where an unrecognised tool call goes.
  if (!proposal && !rowsIn(kind)) return null;

  return {
    role: 'block',
    id: event.id,
    kind,
    title: b.title || '',
    intro: b.intro || '',
    items: b.items || [],
    facts: b.facts || [],
    spots: b.spots || [],
    choose: !!b.choose,
    // "many" lets them tick several and send once. Anything else is one pick.
    pick: b.pick === 'many' ? 'many' : 'one',
    // A proposal is a block too, but the one the traveller answers yes to.
    proposal: event.name === 'propose_trip' ? b : null,
  };
}

// The gate before the build.
//
// Research, then show it, then build — in that order, and the traveller decides
// when the last step happens. (raffy, 2026-08-31: "research, present in chat or
// nice format in chat, then when user happy build the app".)
//
// Before this the agent decided for itself when it had enough, which meant a
// four-minute build could start from a picture of the trip the traveller had
// never actually seen.
export const PROPOSE_TOOL = {
  type: 'custom',
  name: 'propose_trip',
  description:
    'Show the traveller the whole trip you are proposing, before building anything. This is the last step of planning: they read it, and either accept it or tell you what to change. Do NOT call build_itinerary until they have accepted. Keep it to what you would tell a friend over a table — the shape of each day, where they sleep, what it costs, and what you are unsure about.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'e.g. "Five days in Da Nang".' },
      summary: { type: 'string', description: 'Two or three sentences on the shape of the trip and why it is built this way.' },
      days: {
        type: 'array',
        description: 'One line per day. The outline, not the itinerary — that is what the build produces.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'e.g. "Thu 10 Sep — arrive".' },
            plan: { type: 'string', description: 'One sentence. "Land at 9am, bags at the resort, beach and an early night."' },
          },
          required: ['label', 'plan'],
        },
      },
      stays: { type: 'array', description: 'Where they sleep, in order.', items: { type: 'string' } },
      cost: { type: 'string', description: 'What you expect the trip to run to, with what it does and does not include.' },
      unsure: {
        type: 'array',
        description: 'What you could not confirm, or where you had to guess. Do not hide these — this is their last chance to correct you cheaply.',
        items: { type: 'string' },
      },
    },
    required: ['title', 'summary', 'days'],
  },
};
