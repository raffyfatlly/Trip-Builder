import { storeConfigured } from '../../lib/db.js';
import { orBuilderReady, MODEL } from '../../lib/orBuilder.js';
import { placesKey } from '../../lib/photos.js';

// What is actually switched on in this deployment.
//
// Booleans only — never a key, never a value. It exists because "did the env
// var land?" was otherwise only answerable by running a real build, and a
// build is the single most expensive thing this app does. Now it is one GET.

export default function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  res.status(200).json({
    accounts: storeConfigured(),
    builder: orBuilderReady() ? MODEL() : 'anthropic (managed agents)',
    openrouterKey: !!process.env.OPENROUTER_API_KEY,
    anthropicKey: !!process.env.ANTHROPIC_API_KEY,
    googlePhotos: !!placesKey(),
    // False means the signing key is the deployment id, so every deploy signs
    // everyone out. That was the "why do I keep typing my email" bug.
    sessionsSurviveDeploys: !!(process.env.AUTH_SECRET || process.env.FIREBASE_SERVICE_ACCOUNT),
  });
}
