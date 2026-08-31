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
    'Make small changes to the existing itinerary without rebuilding it. Use this for anything you can do from what you already know: changing a time, rewording something, dropping an item, adding a stop you have already researched, confirming a stay. Call read_itinerary first to get the ids. This is instant and nearly free, so prefer it — only fall back to build_itinerary when the shape of the trip itself changes (different dates, a different city, a hotel swap that moves everything).',
  input_schema: {
    type: 'object',
    properties: {
      ops: {
        type: 'array',
        description: 'The changes to make, applied in order.',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['update', 'delete', 'add', 'confirm_stay'] },
            day: { type: 'integer', description: '0-based day index. Required for update, delete and add.' },
            id: { type: 'string', description: 'Item id from read_itinerary. Required for update and delete.' },
            patch: { ...item, description: 'For update: only the fields you are changing.' },
            item: { ...item, description: 'For add: the whole new item.' },
            stay: { type: 'integer', description: 'For confirm_stay: 0-based stay index.' },
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
