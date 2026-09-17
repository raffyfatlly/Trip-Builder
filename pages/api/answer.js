// Reading back a shared answer — what public/welcome/index.html calls when
// it loads with ?a=<token>, so the SAME landing page can show a shared
// answer instead of a brand new visitor needing to ask it again.
//
// Read-only, on purpose: the only way an answer ever gets INTO this
// collection is lib/answershare.js's makeAnswerShare, called server-side by
// pages/api/hook.js from a real answer it just generated. There is no
// public write here, so this deployment's brand can never be made to show
// something it did not actually produce.

import { getAnswerShare } from '../../lib/answershare.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const token = String((req.query && req.query.token) || '').trim();
  if (!token) return res.status(400).json({ error: 'token required' });

  const row = await getAnswerShare(token).catch(() => null);
  if (!row || !row.question || !row.answer) return res.status(404).json({ error: 'not found' });

  res.setHeader('cache-control', 'public, max-age=60, s-maxage=3600');
  return res.status(200).json({ question: row.question, answer: row.answer });
}
