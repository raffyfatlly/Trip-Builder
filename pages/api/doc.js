// Serving somebody their own confirmation back.
//
// The bucket is private and nothing is ever public-read. A document is
// addressed by session, and this route only ever looks inside the session in
// the URL — so the check is not "is this id valid" but "is this id filed under
// this session", which is the same question and much harder to get wrong.
//
// It is deliberately not a signed Cloud Storage URL. Those leak: they outlive
// the page they were made for, they get copied into chat logs, and they cannot
// be revoked. A confirmation carries somebody's full name and their booking
// reference — worth one proxied read.

import { getDoc, storageConfigured } from '../../lib/storage.js';
import { billed } from '../../lib/billed.js';

async function handler(req, res) {
  const session = String(req.query.s || '');
  const id = String(req.query.d || '');
  if (!session || !id) return res.status(400).send('Missing document.');
  if (!storageConfigured()) return res.status(404).send('Not available.');

  try {
    const doc = await getDoc(session, id);
    if (!doc) return res.status(404).send('No such document.');
    res.setHeader('content-type', doc.type);
    // Inline: a PDF or a photo of a booking should open, not land in Downloads.
    res.setHeader('content-disposition', 'inline');
    // Private, because it is: a shared cache must never hold one of these.
    res.setHeader('cache-control', 'private, max-age=300');
    res.status(200).send(doc.body);
  } catch (err) {
    console.error('doc read failed:', err);
    res.status(500).send('Could not open that.');
  }
}

export default billed(handler);
