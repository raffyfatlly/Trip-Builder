import { clearCookieHeader } from '../../../lib/auth.js';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  res.setHeader('set-cookie', clearCookieHeader());
  res.status(200).json({ ok: true });
}
