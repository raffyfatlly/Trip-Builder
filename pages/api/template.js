// Serve the app template to the browser, which renders the preview and the
// download entirely client-side.
//
// It ships gzipped (117KB -> 32KB) because the deploy payload travels inline,
// and is decompressed here rather than in the browser so there is no reliance
// on DecompressionStream support.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

let cached = null;

export default function handler(req, res) {
  try {
    if (!cached) {
      const gz = fs.readFileSync(path.join(process.cwd(), 'public', 'app-template.html.gz'));
      cached = zlib.gunzipSync(gz).toString('utf8');
    }
    // The template only changes on deploy, so it is safe to freeze.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.status(200).send(cached);
  } catch (err) {
    console.error('template failed:', err);
    res.status(500).send('');
  }
}
