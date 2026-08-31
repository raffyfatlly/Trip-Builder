// Does the agent use the current date and the traveller's location?
//
// Asks with a deliberately vague date and no departure airport. A working
// agent resolves the date against today and infers where they fly from.
//
//   node --env-file=.env setup/test-context.js

import { createSession, sendUserMessage, listEvents, getState } from '../lib/managedAgents.js';
import { CHAT_AGENT_ID, ENV_ID } from '../lib/config.js';
import { contextBlock } from '../lib/context.js';

// Pretend the request came from Kuala Lumpur, as Vercel's headers would say.
const geo = { country: 'MY', countryName: 'Malaysia', city: 'Kuala Lumpur',
  currency: 'MYR (RM)', tz: 'Asia/Kuala_Lumpur' };
const ctx = contextBlock(geo, { tz: 'Asia/Kuala_Lumpur' });
console.log('context sent with each message:\n  ' + ctx.replace(/\. /g, '.\n  ') + '\n');

const s = await createSession(CHAT_AGENT_ID, ENV_ID);
await sendUserMessage(s.id, [
  { type: 'text', text: "thinking about taking the family to Da Nang in September. how far ahead should i book?" },
  { type: 'text', text: ctx },
]);

for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const st = await getState(s.id);
  if (!st.thinking && !st.building) break;
}

const events = await listEvents(s.id);
const reply = (events.filter((e) => e.type === 'agent.message').pop()?.content || [])
  .map((c) => c.text || '').join('').trim();

console.log('reply:\n' + reply.split('\n').map((l) => '  ' + l).join('\n'));

const lower = reply.toLowerCase();
console.log('\nchecks:');
// Printing the year is not the signal — naming a correct weekday for a future
// date is, since that can only be computed from a real current date.
console.log('  dates are concrete  : ' + /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+\d{1,2}\s+\w+|\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(reply));
console.log('  judges how soon     : ' + /(book|ahead|rush|last.minute|soon|scarce|peak)/i.test(reply));
console.log('  infers KL departure : ' + /(kuala lumpur|\bkl\b|klia)/i.test(reply));
console.log('  quotes RM           : ' + /rm\s?\d/i.test(reply));
console.log('  leaked raw context  : ' + reply.includes('§CTX§'));
