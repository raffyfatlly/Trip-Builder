import { lookupPlace, placesKey } from '../../lib/photos.js';
import { billed } from '../../lib/billed.js';

// What a chat card needs to stop being a name in a list: the photograph, the
// rating, and the venue's own site.
//
// raffy, 2026-09-01: "i need the direct link to the think so i don't have to go
// out the app and type. u know what I mean? we want them to be in our app as
// much as possible."
//
// The card asks for this itself rather than the agent supplying it, for the
// same reason the itinerary does: the key must stay on the server, and a photo
// URL from anywhere else usually blocks hotlinking on a phone even when it
// works from here.

async function handler(req, res) {
  const q = String((req.query && req.query.q) || '').trim();
  if (!q || q.length > 200) return res.status(400).json({ error: 'bad query' });
  if (!placesKey()) return res.status(501).json({ error: 'places are not configured' });

  const found = await lookupPlace(q);
  // Cached at the edge too: the same card is re-rendered on every poll.
  res.setHeader('cache-control', 'public, max-age=86400');
  // A place Google does not know is a normal answer, not an error — the card
  // simply stays as it was.
  res.status(200).json(found || {});
}

export default billed(handler);
