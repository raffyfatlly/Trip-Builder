// The handoff between the two agents.
//
// The chat agent does not build anything. Its job is to interview well, think
// about what it heard, and hand the builder a brief good enough that the
// builder never has to guess. This tool IS that brief.
//
// The most valuable field here is `considerations` — the chat agent's own
// judgement, which is the thing a raw transcript would not carry.

export const BUILD_TOOL = {
  type: 'custom',
  name: 'build_itinerary',
  description:
    'Hand the trip over to the itinerary builder. Call this once the traveller has ACCEPTED your proposal — or straight away if they ask you to build. The builder does NOT research: it writes the trip from what you put in this brief, so everything you found has to be in `research`, and the days you proposed have to be in `shape`. Anything you leave out is lost. Call it again later only if the trip changes structurally.',
  input_schema: {
    type: 'object',
    properties: {
      destination: { type: 'string', description: 'City or area, and country.' },
      start: { type: 'string', description: 'ISO date YYYY-MM-DD.' },
      end: { type: 'string', description: 'ISO date YYYY-MM-DD.' },
      travellers: {
        type: 'array',
        description: 'Everyone going, with real names. Ages for children — pace depends on them.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'string', description: 'e.g. "6", "3", "adult". Only if known.' },
            note: { type: 'string', description: 'Anything relevant: mobility, interests, "wants photos".' },
          },
          required: ['name'],
        },
      },
      stays: {
        type: 'array',
        description: 'Where they sleep, in order.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            dates: { type: 'string', description: 'e.g. "10 to 14 Sep", or "whole trip".' },
            confirmed: { type: 'boolean', description: 'false if they are still deciding.' },
            site: { type: 'string', description: "The hotel's own website, if you found it while researching. The builder pulls its photo from there — it is the only reliable way to picture a specific hotel." },
            latlon: { type: 'string', description: 'If you know it: "16.0544,108.2022". Saves the builder a lookup and drives the weather and the map.' },
          },
          required: ['name'],
        },
      },
      flights: {
        type: 'string',
        description:
          'Everything known about flights in plain text: airports, times, dates, booking refs. Say "not known yet" if they have not said.',
      },
      budget: {
        type: 'string',
        description:
          'What they are willing to spend, in their own terms and currency: per night, per person, or for the whole trip. Include what you learned about real local prices while researching. "not discussed" if it never came up.',
      },
      dietary: { type: 'string', description: 'Halal, vegetarian, allergies. "none stated" if not raised.' },
      pace: {
        type: 'string',
        description: 'Relaxed, balanced, or packed — and why you concluded that.',
      },
      interests: {
        type: 'string',
        description: 'What they actually want out of this trip, in their own words where possible.',
      },
      known: {
        type: 'string',
        description:
          'What is already booked, decided, or ruled out. Anything the builder must treat as fixed.',
      },
      considerations: {
        type: 'string',
        description:
          'THE MOST IMPORTANT FIELD. Your own read of this trip, written for the builder. What will make or break it, what to be careful of, what you would check, what the traveller has not thought about, what you noticed they care about that they did not say outright. Several sentences. Do not repeat the facts above — this is judgement, not data.',
      },
      attachments: {
        type: 'string',
        description: 'What they sent you (photos, booking screenshots) and what was in them.',
      },
      arriveBy: {
        type: 'string',
        enum: ['fly', 'drive', 'train', 'ferry', 'other'],
        description:
          'How they are actually getting there. Say it every time — it decides whether their To do list tells them to book flights at all, and whether the map shows an airport. If they told you they are driving, this is where that goes.',
      },
      research: {
        type: 'array',
        description:
          'EVERYTHING YOU LOOKED UP. The builder does not search — it writes the trip from this. Anything you found and leave out here is simply lost, and the trip is worse for it. Include prices, opening hours, closing days, timed events, seasonality for these dates, distances and travel times, hotel check-in/check-out times, what is near each hotel, the viral spots and their catches. Be generous: this is the cheap half of the work and it is already done.',
        items: {
          type: 'object',
          properties: {
            about: { type: 'string', description: 'What this is about, e.g. "Ba Na Hills tickets" or "September weather".' },
            found: { type: 'string', description: 'What you actually found, with the numbers. Not a summary — the detail.' },
            source: { type: 'string', description: 'Where it came from, and how confident you are.' },
          },
          required: ['about', 'found'],
        },
      },
      shape: {
        type: 'array',
        description:
          'The day-by-day outline the traveller accepted, exactly as you proposed it. The builder fills these days in — it does not redesign the trip.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'e.g. "Thu 10 Sep — arrive".' },
            plan: { type: 'string', description: 'What you told them that day would be.' },
          },
          required: ['label', 'plan'],
        },
      },
      gaps: {
        type: 'array',
        description:
          'The few things you could NOT find out and that genuinely matter. These are the only things the builder is allowed to spend a search on, so keep the list short and specific.',
        items: { type: 'string' },
      },
    },
    required: ['destination', 'start', 'end', 'travellers', 'stays', 'considerations', 'research'],
  },
};
