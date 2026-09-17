// What a shared answer says about itself when the link is pasted somewhere
// — the same idea as lib/sharecard.js's trip cards, for one Q&A instead of
// a whole itinerary.
//
// raffy, 2026-09-17: "people won't just click some random link. especially
// if I don't give value." The question comes through verbatim, so whoever
// asked it (or a friend they forwarded it to) recognises it instantly. The
// answer comes through as a real, specific snippet — not the whole thing,
// which is the reason to click, and not a generic teaser, which is the
// reason people stop clicking travel links at all.

const clean = (s) => String(s || '')
  .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
  .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1')
  .replace(/^[\s]*[-•*]\s+/gm, '')
  .replace(/\s+/g, ' ')
  .trim();

const clip = (s, max) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s);

const cardUrl = (base, q) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, String(v));
  return base + '/api/og?' + p.toString();
};

/** Everything the <head> and /api/og need for a shared answer. */
export function answerCard(question, answer, base, url) {
  const q = clip(clean(question), 140);
  const a = clip(clean(answer), 160);
  return {
    title: q,
    description: a,
    url,
    image: cardUrl(base, { s: 'answer', t: q, h: a }),
  };
}
