// The itinerary schema, expressed as Managed Agents custom-tool definitions.
//
// The agent's only job is to fill these in. It never writes HTML or code.
// Field names are deliberately the same terse keys the renderer already uses
// (see tools/itinerary-generator/SCHEMA.md) — the renderer needs no changes,
// and these keys are emitted hundreds of times per itinerary, so `t`/`h`/`p`
// against `time`/`heading`/`prose` is a real cost difference. Clarity lives in
// these descriptions, which the model reads, not in the key names.

const chip = {
  type: 'object',
  description: 'A small pill under a timeline item.',
  properties: {
    kind: { type: 'string', enum: ['duration', 'link'] },
    text: { type: 'string', description: 'For kind=duration, e.g. "drive 25 to 35 min".' },
    label: { type: 'string', description: 'For kind=link, the visible label, e.g. "sunworld.vn".' },
    href: { type: 'string', description: 'For kind=link, the URL.' },
  },
  required: ['kind'],
};

const item = {
  type: 'object',
  description: 'One entry on a day\'s timeline.',
  properties: {
    t: {
      type: 'string',
      description:
        'Time. Prefer a real clock time ("3:00pm"). Prefix with ~ when approximate ("~4:00pm"). "Morning", "Evening" and "All day" are allowed but weaker.',
    },
    h: { type: 'string', description: 'Short heading, e.g. "Check in to JW Marriott Emerald Bay".' },
    p: {
      type: 'string',
      description:
        'A few sentences of real substance: what it is, why it is worth doing, what to watch out for. Name the travellers here where it fits naturally.',
    },
    major: { type: 'boolean', description: 'true for the anchor moments of the day.' },
    out: {
      type: 'boolean',
      description:
        'true ONLY if this happens outdoors. This drives the per-item weather verdict. Setting it on indoor items makes the whole weather layer noise, so be strict.',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Short labels, e.g. "Check in", "Check out", "Photo spot", "Booked", "Optional", "Free ticket". Personalise where it helps, e.g. "Good for Raes".',
    },
    chips: { type: 'array', items: chip },
    photo: { type: 'string', description: 'Key into the photos map, if a photo belongs here.' },
    credit: { type: 'string', description: 'Photo caption.' },
    licence: { type: 'string', description: 'Only if the photo needs attribution, e.g. "CC BY-SA 4.0".' },
  },
  required: ['t', 'h', 'p'],
};

const day = {
  type: 'object',
  properties: {
    dow: { type: 'string', description: 'Three-letter day, uppercase: MON, TUE...' },
    dom: { type: 'integer', description: 'Day of month.' },
    stay: { type: 'integer', description: 'Index into stays[] — which hotel they sleep at this night.' },
    big: { type: 'boolean', description: 'true for the headline day of a stay.' },
    title: { type: 'string', description: 'Short day title, e.g. "Cable car and Aquatopia".' },
    sub: { type: 'string', description: 'One-line subtitle.' },
    transfer: { type: 'string', description: 'Only on hotel-change days: the plan for the move.' },
    items: { type: 'array', items: item },
  },
  required: ['dow', 'dom', 'stay', 'title', 'sub', 'items'],
};

const stay = {
  type: 'object',
  properties: {
    n: { type: 'string', description: 'Full hotel name.' },
    short: { type: 'string', description: 'Short label for chips and nav.' },
    side: { type: 'string', description: 'Geographic grouping, e.g. "South coast", "Old town".' },
    dates: { type: 'string', description: 'Display string, e.g. "15 to 17 Aug".' },
    nights: { type: 'string', description: 'e.g. "2 nights".' },
    loc: { type: 'string', description: 'Where it sits and what it is near.' },
    ci: { type: 'string', description: 'Check-in time, e.g. "3:00pm". Look this up — do not assume.' },
    co: { type: 'string', description: 'Check-out time, e.g. "12:00pm".' },
    place: { type: 'string', description: 'Short weather label for this location.' },
    lat: { type: 'number', description: 'Latitude of THIS hotel, not the destination centre.' },
    lon: { type: 'number', description: 'Longitude of THIS hotel.' },
    halal: { type: 'string', description: 'Halal dining near this specific stay, if the traveller asked for it.' },
    draft: { type: 'boolean', description: 'true if this booking is not confirmed.' },
    photo: { type: 'string' },
    credit: { type: 'string' },
    licence: { type: 'string' },
    site: { type: 'array', items: { type: 'string' }, description: '[label, url] for the hotel site.' },
    map: { type: 'array', items: { type: 'string' }, description: '[label, url] for a maps link.' },
  },
  required: ['n', 'short', 'dates', 'nights', 'loc', 'ci', 'co', 'lat', 'lon'],
};

const idea = {
  type: 'object',
  description: 'A suggestion that is NOT booked.',
  properties: {
    n: { type: 'string' },
    icon: { type: 'string', description: 'One of: market, sun, beach, tower, ticket, arch, castle, glass, moon.' },
    area: { type: 'string', description: 'Key into areas[].' },
    verdict: { type: 'string', enum: ['yes', 'maybe'] },
    one: { type: 'string', description: 'One-line summary.' },
    why: { type: 'string', description: 'The case for going.' },
    warn: {
      type: 'string',
      description:
        'The catch: cost, timing, season, a queue, why it might not suit them. This is where real research shows. Do not leave it generic.',
    },
    time: { type: 'string', description: 'e.g. "An evening", "Half a day".' },
    near: { type: 'array', items: { type: 'integer' }, description: 'Stay indices this is close to.' },
    days: { type: 'array', items: { type: 'integer' }, description: 'Day indices it would fit.' },
    map: { type: 'string', description: 'Maps URL.' },
  },
  required: ['n', 'verdict', 'one', 'why'],
};


// Photos are what make the finished app look like something. Without them
// every card falls back to a flat gradient.
//
// Restricted to Wikimedia Commons on purpose: the URLs are stable, hotlinking
// is permitted, and the licence is clear. Hotel and booking sites block
// hotlinking or rotate their URLs, so an image from one is a broken picture in
// a week.
const photos = {
  type: 'object',
  description:
    'Map of photo key to a direct image URL. The keys are what stays, items and the feature card refer to in their `photo` field. Use ONLY direct upload.wikimedia.org image URLs (ending .jpg, .jpeg, .png or .webp) that you have actually found - never a page URL, never a guessed filename, never another site.',
  additionalProperties: { type: 'string' },
};

const trip = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Short slug, e.g. "phuquoc26". Used as a storage key.' },
    who: { type: 'string', description: 'First name of the person being greeted.' },
    sub: { type: 'string', description: 'One-line subtitle under the greeting.' },
    flag: { type: 'string', description: 'Flag emoji plus country, e.g. "🇻🇳 Vietnam".' },
    title: { type: 'string', description: 'Destination name, large on the hero.' },
    titleSub: { type: 'string', description: 'e.g. "nine nights".' },
    statePill: { type: 'string', description: 'e.g. "9 nights".' },
    start: { type: 'string', description: 'ISO date, YYYY-MM-DD.' },
    end: { type: 'string', description: 'ISO date, YYYY-MM-DD.' },
    tzOffsetMin: {
      type: 'integer',
      description:
        'Destination UTC offset in MINUTES (Vietnam = 420). The app runs on destination wall-clock; get this wrong and the day flips at the wrong hour.',
    },
    theme: { type: 'string', enum: ['sage', 'sand', 'navy'] },
    heroChips: {
      type: 'array',
      description: 'Three summary pills.',
      items: {
        type: 'object',
        properties: {
          icon: { type: 'string', enum: ['cal', 'pin', 'route', 'clock', 'arrow', 'hotel'] },
          text: { type: 'string' },
        },
        required: ['icon', 'text'],
      },
    },
    travellers: {
      type: 'array',
      description: 'Everyone on the trip. Their names get written into the day-by-day prose.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          initial: { type: 'string', description: 'Single letter.' },
          color: { type: 'string', description: 'Hex colour for the avatar.' },
        },
        required: ['name', 'initial', 'color'],
      },
    },
    feature: {
      type: 'object',
      description: 'The big card under the hero: the shape of the trip in one sentence.',
      properties: {
        photo: { type: 'string' },
        alt: { type: 'string' },
        h: { type: 'string', description: 'e.g. "South, north, and back".' },
        p: { type: 'string' },
        stats: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              icon: { type: 'string', enum: ['cal', 'pin', 'route', 'clock', 'arrow', 'hotel'] },
              text: { type: 'string' },
            },
            required: ['icon', 'text'],
          },
        },
      },
    },
    seasonNote: {
      type: 'string',
      description:
        'One genuinely important thing about the weather or season for these exact dates, if there is one. Shown above the ideas list. Leave out rather than padding.',
    },
    notes: {
      type: 'array',
      description:
        'The "Before you lock this in" cards: what they should check or be aware of before committing. Unverified prices, unbooked stays, anything time-sensitive.',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['warn', 'info'] },
          h: { type: 'string', description: 'Short bold lead, e.g. "Stay 2 is not booked."' },
          p: { type: 'string', description: 'The detail.' },
        },
        required: ['kind', 'h', 'p'],
      },
    },
    declined: {
      type: 'array',
      description:
        'Places you seriously considered and ruled out, with the reason. Only include this when you actually rejected something worth mentioning — omit it entirely rather than padding, and the box disappears.',
      items: {
        type: 'object',
        properties: {
          h: { type: 'string', description: 'The place, e.g. "Coconut Tree Prison."' },
          p: { type: 'string', description: 'Why it did not make the cut.' },
        },
        required: ['h', 'p'],
      },
    },
    credits: { type: 'string', description: 'Photo or data attribution, if any is needed.' },
    flights: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          dir: { type: 'string', enum: ['out', 'back'] },
          from: { type: 'string', description: 'Airport code.' },
          dep: { type: 'string', description: 'e.g. "12:50".' },
          to: { type: 'string' },
          arr: { type: 'string' },
          day: { type: 'string', description: 'e.g. "SAT 15".' },
        },
        required: ['dir', 'from', 'to'],
      },
    },
  },
  required: ['id', 'who', 'title', 'start', 'end', 'tzOffsetMin', 'travellers'],
};

const area = {
  type: 'object',
  properties: {
    k: { type: 'string', description: 'Key referenced by idea.area.' },
    t: { type: 'string', description: 'Area title.' },
    sub: { type: 'string', description: 'One line of context.' },
  },
  required: ['k', 't'],
};

export const TOOLS = [
  {
    type: 'custom',
    name: 'save_itinerary',
    description:
      'Create the itinerary. Call this ONCE, as soon as you know the destination, the dates, who is travelling, and at least one place they are staying. Do not wait until every detail is settled — the traveller wants to see something early and refine it. After this, use update_day / update_stay / add_idea for every change.',
    input_schema: {
      type: 'object',
      properties: { trip, stays: { type: 'array', items: stay }, days: { type: 'array', items: day },
        ideas: { type: 'array', items: idea }, areas: { type: 'array', items: area }, photos },
      required: ['trip', 'stays', 'days'],
    },
  },
  {
    type: 'custom',
    name: 'add_photos',
    description:
      'Add photos to the itinerary after it exists. Pass the map of key to Wikimedia image URL, and optionally attach keys to specific places. Cheap — never rebuild just to add pictures.',
    input_schema: {
      type: 'object',
      properties: {
        photos,
        attach: {
          type: 'array',
          description: 'Where each photo goes.',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'A key from the photos map.' },
              target: { type: 'string', enum: ['feature', 'stay', 'item'] },
              stay: { type: 'integer', description: 'For target=stay.' },
              day: { type: 'integer', description: 'For target=item.' },
              id: { type: 'string', description: 'For target=item: the item id.' },
              credit: { type: 'string', description: 'Caption naming what and where it is.' },
              licence: { type: 'string', description: 'e.g. "CC BY-SA 4.0". Required for Commons images.' },
            },
            required: ['key', 'target'],
          },
        },
      },
      required: ['photos'],
    },
  },
  {
    type: 'custom',
    name: 'update_day',
    description:
      'Replace one day of the itinerary. Use this for every change after save_itinerary rather than re-sending the whole trip.',
    input_schema: {
      type: 'object',
      properties: { index: { type: 'integer', description: '0-based index into days[].' }, day },
      required: ['index', 'day'],
    },
  },
  {
    type: 'custom',
    name: 'update_stay',
    description: 'Replace one stay, e.g. when a hotel is confirmed or changed.',
    input_schema: {
      type: 'object',
      properties: { index: { type: 'integer', description: '0-based index into stays[].' }, stay },
      required: ['index', 'stay'],
    },
  },
  {
    type: 'custom',
    name: 'update_trip',
    description: 'Update the trip header — title, travellers, theme, flights, feature card.',
    input_schema: { type: 'object', properties: { trip }, required: ['trip'] },
  },
  {
    type: 'custom',
    name: 'add_idea',
    description: 'Add one suggestion to the ideas list. These are explicitly NOT booked.',
    input_schema: { type: 'object', properties: { idea }, required: ['idea'] },
  },
];
