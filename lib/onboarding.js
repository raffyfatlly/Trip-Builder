// The few things worth asking before the conversation starts.
//
// Not an interview — the agent does that far better than a form can. This
// exists because typing "Da Nang, 10-14 September, me and two kids" into an
// empty box is more work than tapping it, and because the agent's first reply
// is much better when it already knows where and when.
//
// Everything here is skippable. A form that blocks you is worse than no form.

export const STEPS = [
  {
    key: 'destination',
    title: 'Where are you going?',
    sub: 'A city, an island, a country — whatever you know.',
    type: 'text',
    placeholder: 'Da Nang, Vietnam',
    chips: ['Da Nang', 'Bali', 'Tokyo', 'Bangkok', 'Ho Chi Minh City', 'Phu Quoc', 'Singapore', 'Seoul'],
  },
  {
    key: 'when',
    title: 'When?',
    sub: 'Rough is fine. We can pin it down as we talk.',
    type: 'dates',
  },
  {
    key: 'who',
    title: "Who's coming?",
    sub: 'Ages matter more than anything else here — a three year old changes a trip.',
    type: 'who',
  },
  {
    key: 'ready',
    title: "What's already sorted?",
    // Two questions on one screen rather than two screens. Both are closed,
    // both are one tap, and both change what the very first reply should say.
    //
    // raffy, 2026-09-01: "depending whether user has already some of these
    // confirmed/book before they engage in first place or totally blank just
    // start from beginning" — and "some people might prefer to have really pack
    // schedule so maybe for them it's worth it, and for some want a more relax
    // itenary".
    //
    // The first answer seeds the checklist and stops the agent asking for
    // flight times that do not exist yet. The second is the difference between
    // three things a day and seven, and nothing else in the conversation
    // reveals it reliably.
    sub: 'So I know where to start, and how full to make your days.',
    type: 'ready',
    options: ['Flights', 'Where we are staying', 'Some activities'],
    paces: [
      { key: 'packed', label: 'Packed', hint: 'See as much as possible' },
      { key: 'balanced', label: 'Balanced', hint: 'A few things, not rushed' },
      { key: 'slow', label: 'Slow', hint: 'One thing a day, properly' },
    ],
  },
  {
    key: 'about',
    title: "What's this trip for?",
    sub: 'Pick as many as fit.',
    type: 'multi',
    options: ['Rest and beach', 'Food', 'Keeping kids happy', 'Photos', 'Adventure', 'Culture and history', 'Shopping', 'First time there'],
  },
];

// "2026-09-10" -> "10 September 2026". The agent reads ISO fine, but this
// message is shown to the traveller as their own words.
const pretty = (iso) => {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(+d)) return iso;
  return d.getUTCDate() + ' ' +
    ['January','February','March','April','May','June','July','August','September','October','November','December'][d.getUTCMonth()] +
    ' ' + d.getUTCFullYear();
};

const nights = (a, b) => {
  const d = (new Date(b) - new Date(a)) / 86400000;
  return Number.isFinite(d) && d > 0 ? Math.round(d) : null;
};

const people = (w) => {
  const out = [];
  for (const p of (w && w.list) || []) {
    if (!p.name && !p.age) continue;
    out.push(p.age ? `${p.name || 'one of us'} (${p.age})` : p.name);
  }
  return out;
};

// The answers become the traveller's own first message. Writing it as their
// words, not as a form dump, matters: the agent replies to a person, and the
// transcript reads like a conversation from the very first line.
export function seedMessage(a) {
  const bits = [];
  bits.push(a.destination ? `We're going to ${a.destination}.` : "I'm planning a trip.");

  if (a.when && a.when.start) {
    const n = a.when.end ? nights(a.when.start, a.when.end) : null;
    bits.push(a.when.end
      ? `${pretty(a.when.start)} to ${pretty(a.when.end)}${n ? `, ${n} night${n > 1 ? 's' : ''}` : ''}.`
      : `Around ${pretty(a.when.start)}.`);
  } else if (a.when && a.when.rough) {
    bits.push(`Sometime around ${a.when.rough}.`);
  }

  const named = people(a.who);
  if (named.length) {
    bits.push(`It's ${named.join(', ')}.`);
  } else if (a.who && a.who.adults) {
    const k = a.who.kids || 0;
    bits.push(`${a.who.adults} adult${a.who.adults > 1 ? 's' : ''}${k ? ` and ${k} kid${k > 1 ? 's' : ''}` : ''}.`);
  }

  if (a.about && a.about.length) {
    bits.push(`Mainly about ${a.about.join(', ').toLowerCase()}.`);
  }

  // What they have already booked decides where the conversation starts, so it
  // goes in the first message rather than being discovered three turns later.
  const got = (a.ready && a.ready.have) || [];
  if (got.length) {
    bits.push(`Already sorted: ${got.join(', ').toLowerCase()}.`);
  } else if (a.ready && a.ready.asked) {
    bits.push('Nothing booked yet — starting from scratch.');
  }

  const pace = a.ready && a.ready.pace;
  if (pace) {
    bits.push(pace === 'packed'
      ? 'We like a full day — fit plenty in.'
      : pace === 'slow'
        ? 'We like it slow, one thing a day done properly.'
        : 'A few things a day, not rushed.');
  }

  return bits.join(' ');
}
