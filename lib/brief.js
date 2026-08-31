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
    'Hand the trip over to the itinerary builder. Call this once you know the destination, the dates, who is going, and where they are staying — you do not need every detail. The builder does all the research and writing; your job is to give it a brief so good it never has to guess. Call it again later with an updated brief if the traveller changes something significant.',
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
          },
          required: ['name'],
        },
      },
      flights: {
        type: 'string',
        description:
          'Everything known about flights in plain text: airports, times, dates, booking refs. Say "not known yet" if they have not said.',
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
    },
    required: ['destination', 'start', 'end', 'travellers', 'stays', 'considerations'],
  },
};
