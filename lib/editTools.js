// Edit tools for the CHAT agent.
//
// These produce exactly the same operations the manual editor produces, and
// they run entirely in the chat session: no builder, no web search, no
// research pass. "Move dinner to 8pm" costs a chat turn, not a rebuild.
//
// The agent addresses items by the same stable ids the manual editor uses, so
// the two edit paths are interchangeable and interleave safely.

export const READ_TOOL = {
  type: 'custom',
  name: 'read_itinerary',
  description:
    'List the current itinerary with the id of every item. Call this before editing so you know what is there and which id to change. Cheap — it does not rebuild anything.',
  input_schema: { type: 'object', properties: {}, required: [] },
};

const item = {
  type: 'object',
  properties: {
    t: { type: 'string', description: 'Time, e.g. "3:00pm" or "~4:00pm".' },
    h: { type: 'string', description: 'Short heading.' },
    p: { type: 'string', description: 'A few sentences. Use the travellers\' names.' },
    out: { type: 'boolean', description: 'true only if genuinely outdoors.' },
    major: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' } },
  },
};

export const EDIT_TOOL = {
  type: 'custom',
  name: 'edit_itinerary',
  description:
    'Make small changes to the existing itinerary without rebuilding it. Use this for anything you can do from what you already know: changing a time, rewording something, dropping an item, adding a stop you have already researched, confirming a stay, filing a booking they have made, adding something they still need to arrange. Call read_itinerary first to get the ids. This is instant and nearly free, so prefer it — only fall back to build_itinerary when the shape of the trip itself changes (different dates, a different city, a hotel swap that moves everything).',
  input_schema: {
    type: 'object',
    properties: {
      ops: {
        type: 'array',
        description: 'The changes to make, applied in order.',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['update', 'delete', 'add', 'confirm_stay', 'save_booking', 'add_task', 'tick_task', 'drop_task'] },
            day: { type: 'integer', description: '0-based day index. Required for update, delete and add.' },
            patch: { ...item, description: 'For update: only the fields you are changing.' },
            item: { ...item, description: 'For add: the whole new item.' },
            stay: { type: 'integer', description: 'For confirm_stay: 0-based stay index.' },
            booking: {
              type: 'object',
              description:
                'For save_booking: a confirmation they have actually made, filed into their Wallet. Use it the moment they send a booking email, a PDF, a screenshot or just the details in a message — that is the whole point of the tab. Fill in what the confirmation says and leave out what it does not; never invent a reference number.',
              properties: {
                kind: { type: 'string', enum: ['flight', 'stay', 'transfer', 'activity', 'other'] },
                title: { type: 'string', description: 'What it is, as they would say it: "AirAsia AK1494, KUL to FCO", "Hotel Mediterraneo".' },
                ref: { type: 'string', description: 'The booking reference or confirmation number, exactly as written.' },
                when: { type: 'string', description: 'The date and time that matters: "14 Oct, 23:40", "19-22 Sep".' },
                where: { type: 'string', description: 'Where they turn up: terminal, address, pier.' },
                who: { type: 'string', description: 'Who it is booked for, if the confirmation says.' },
                note: { type: 'string', description: 'The one thing worth remembering: baggage allowance, free cancellation until a date, check-in opens 48h before.' },
                stay: { type: 'integer', description: 'If this confirms a stay in the itinerary, its 0-based index — the stay stops showing as a draft.' },
              },
              required: ['kind', 'title'],
            },
            task: {
              type: 'object',
              description:
                'For add_task: something they still have to arrange that the plan does not already imply. Flights, each stay, and anything in the days tagged as needing booking are ALREADY on their list automatically — do not add those. Add what only you would know: a visa and how long it really takes, an eSIM, travel insurance, a restaurant that books out a month ahead, a permit for a hike, an international driving permit.',
              properties: {
                what: { type: 'string', description: 'The action, starting with a verb: "Apply for the Vietnam e-visa".' },
                why: { type: 'string', description: 'One line on why it matters and what happens if it slips: "Takes 15 working days and they will not board you without it."' },
                kind: { type: 'string', enum: ['flight', 'stay', 'ticket', 'transfer', 'visa', 'admin', 'other'] },
                by: { type: 'string', description: 'YYYY-MM-DD, the date it actually has to be done by. Work backwards from their departure and be honest about lead times.' },
                link: { type: 'string', description: 'Where it gets done — the official portal, the booking page. Never invent one.' },
                route: {
                  type: 'object',
                  description: 'Only for the flights task. Give the airport codes and the app builds a real dated fare search with them, which is much better than the fallback. Send it with id "d:flights" so it lands on the flight row already on their list rather than adding a second one.',
                  properties: {
                    from: { type: 'string', description: 'Departure airport IATA code, e.g. KUL.' },
                    to: { type: 'string', description: 'Arrival airport IATA code, e.g. FCO.' },
                  },
                },
              },
              required: ['what'],
            },
            id: { type: 'string', description: 'Item id from read_itinerary (for update/delete), or the task id (for tick_task and drop_task). For add_task it is optional — pass "d:flights" to fill in the flight row already on their list instead of adding another.' },
          },
          required: ['op'],
        },
      },
      summary: {
        type: 'string',
        description: 'One short line telling the traveller what you changed.',
      },
    },
    required: ['ops'],
  },
};

// Compact listing the agent reads. Deliberately terse — this is sent on every
// edit turn, so it should carry ids and enough text to identify an item, and
// nothing more.
export function describeItinerary(it) {
  if (!it || !it.days || !it.days.length) {
    return 'No itinerary has been built yet. Use build_itinerary first.';
  }
  const lines = [];
  lines.push(it.trip ? `${it.trip.title || 'Trip'} — ${it.trip.start} to ${it.trip.end}` : 'Trip');

  (it.stays || []).forEach((s, i) => {
    lines.push(`stay ${i}: ${s.n}${s.draft ? '  [NOT CONFIRMED]' : ''}`);
  });

  (it.days || []).forEach((d, di) => {
    lines.push(`\nday ${di} (${d.dow} ${d.dom}) ${d.title}`);
    (d.items || []).forEach((x) => {
      const tags = (x.tags || []).length ? '  [' + x.tags.join(', ') + ']' : '';
      lines.push(`  ${x._id}  ${x.t || '(no time)'}  ${x.h}${x.out ? '  (outdoors)' : ''}${tags}`);
    });
  });
  return lines.join('\n');
}

// Translate the agent's ops into the internal edit-op shape, so agent edits and
// hand edits are literally the same objects.
export function toEdits(ops, seq) {
  const out = [];
  (ops || []).forEach((o, i) => {
    const ts = seq + i;
    if (o.op === 'save_booking') {
      const b = o.booking;
      if (b && b.title) {
        out.push({ type: 'booking.set', id: 'bk' + ts, booking: b, ts, by: 'agent' });
        // A confirmation that names a stay also un-drafts it, so the traveller
        // never has to say the same thing twice.
        if (Number.isInteger(b.stay)) {
          out.push({ type: 'stay.update', index: b.stay, patch: { draft: false }, ts, by: 'agent' });
        }
      }
      return;
    }
    if (o.op === 'add_task') {
      const t = o.task;
      // An id lets the agent fill in a task the plan already derived — the
      // flight row, given real airport codes — rather than adding a second one
      // beside it. checklist.js merges by id.
      if (t && (t.what || o.id)) out.push({ type: 'task.set', id: o.id || ('tk' + ts), task: t, ts, by: 'agent' });
      return;
    }
    if (o.op === 'drop_task') {
      // Off the list entirely, derived rows included — how "we are driving,
      // there are no flights" gets fixed on a trip that is already built.
      if (o.id) out.push({ type: 'task.set', id: o.id, task: { hidden: true }, ts, by: 'agent' });
      return;
    }
    if (o.op === 'tick_task') {
      if (o.id) out.push({ type: 'task.set', id: o.id, task: { done: true }, ts, by: 'agent' });
      return;
    }
    if (o.op === 'confirm_stay') {
      if (Number.isInteger(o.stay)) {
        out.push({ type: 'stay.update', index: o.stay, patch: { draft: false }, ts, by: 'agent' });
      }
      return;
    }
    if (!Number.isInteger(o.day)) return;
    if (o.op === 'add' && o.item) {
      out.push({ type: 'item.add', day: o.day, id: 'g' + ts, item: o.item, ts, by: 'agent' });
    } else if (o.op === 'update' && o.id && o.patch) {
      out.push({ type: 'item.update', day: o.day, id: o.id, patch: o.patch, ts, by: 'agent' });
    } else if (o.op === 'delete' && o.id) {
      out.push({ type: 'item.delete', day: o.day, id: o.id, ts, by: 'agent' });
    }
  });
  return out;
}
