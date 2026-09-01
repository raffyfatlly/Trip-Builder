// Upload a photo or document to the Files API and return its file_id, which
// the next message references as an image/document content block.

import { apiKey } from '../../lib/config.js';
import { fetchWith } from '../../lib/net.js';

export const config = { api: { bodyParser: { sizeLimit: '12mb' } } };

const MIME_OK = /^(image\/(png|jpeg|webp|gif)|application\/pdf|text\/plain)$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { name, type, data } = req.body || {};
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
    res.status(200).json({
      file_id: file.id,
      name: name || 'file',
      kind: type.startsWith('image/') ? 'image' : 'document',
    });
  } catch (err) {
    console.error('upload failed:', err);
    res.status(500).json({ error: 'Could not upload that.' });
  }
}
