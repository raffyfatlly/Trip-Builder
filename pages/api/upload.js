// Upload a photo or document to the Files API and return its file_id, which
// the next message references as an image/document content block.

import { apiKey } from '../../lib/config.js';
import { fetchWith } from '../../lib/net.js';
import { putDoc, storageConfigured, docUrl } from '../../lib/storage.js';
import { billed } from '../../lib/billed.js';

export const config = { api: { bodyParser: { sizeLimit: '12mb' } } };

const MIME_OK = /^(image\/(png|jpeg|webp|gif)|application\/pdf|text\/plain)$/;

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { name, type, data, session } = req.body || {};
  if (!data || !type) return res.status(400).json({ error: 'file required' });
  if (!MIME_OK.test(type)) {
    return res.status(400).json({ error: 'Images, PDFs and text files only.' });
  }

  try {
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'That file is too big (10MB max).' });
    }

    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), name || 'upload');

    const r = await fetchWith('https://api.anthropic.com/v1/files', 60000, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey(),
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'managed-agents-2026-04-01,files-api-2025-04-14',
      },
      body: form,
    });
    const text = await r.text();
    if (!r.ok) throw new Error(r.status + ' ' + text);

    const file = JSON.parse(text);

    // The same bytes, kept somewhere we can serve them back from.
    //
    // The Files API is for the model to read, and it will not hand a
    // user-uploaded file back — `downloadable: false`. So a booking confirmed
    // from an emailed PDF had a reference on its card and no way to open the
    // PDF it came from, which is exactly the errand this app exists to save.
    // Storing it is best-effort: failing to file a copy must never cost
    // somebody the ability to send the confirmation at all.
    let doc = null;
    if (session && storageConfigured()) {
      try {
        const put = await putDoc(session, { name, type, bytes });
        doc = { id: put.id, name: put.name, url: docUrl(session, put.id) };
      } catch (err) {
        console.error('doc store failed:', err);
      }
    }

    res.status(200).json({
      file_id: file.id,
      name: name || 'file',
      kind: type.startsWith('image/') ? 'image' : 'document',
      doc,
    });
  } catch (err) {
    console.error('upload failed:', err);
    res.status(500).json({ error: 'Could not upload that.' });
  }
}

export default billed(handler);
