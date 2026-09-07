// Reading ONE page we chose, rather than whatever a search engine surfaced.
//
// raffy, 2026-09-06, after reading Firecrawl's onboarding: "idk if this is
// going to improve our app performance. if yes please do."
//
// The honest case for it is in his own Kuching screenshot: a hotel card that
// said "blogs quote RM100-220/night". That is what happens when the desk can
// only search — it reads whatever came back, and what came back was a blog. It
// could not open the hotel's own page, because it had no way to open a page.
// This is that way.
//
// Deliberately NOT a general web-content firehose. The whole reason the
// research desk exists is that web results in the conversation pushed one
// request to 454,870 tokens and made cache traffic 79% of a trip's chat bill.
// So a scraped page never reaches the chat model either: Firecrawl fetches it,
// the research worker reads it, and Sonnet gets a few hundred words. Same
// discipline, one more source.
//
// It also costs LESS than a search when the URL is known: OpenRouter charges
// about $0.007 for the web-search plugin, and this skips it.
//
// Degrades to nothing without a key: research falls back to searching, exactly
// as it does today. Same shape as the Travelpayouts token.

import { fetchWith } from './net.js';
import { setting } from './settings.js';

const API = 'https://api.firecrawl.dev/v2';
const T_SCRAPE = 20000;

// How much of a page the worker is given. A hotel page is mostly navigation and
// footer; the part that carries a rate is near the top. Cutting here rather
// than in the worker's prompt means we never pay to send the rest anywhere.
const MAX_CHARS = 12000;

export const key = () => setting('FIRECRAWL_API_KEY', 'firecrawlKey');
export const firecrawlReady = () => !!key();

const clean = (s) => String(s == null ? '' : s).trim();

/** Is this something we can and should fetch? */
export function fetchable(url) {
  const u = clean(url);
  if (!/^https:\/\/[^\s]+$/i.test(u)) return false;
  try {
    const h = new URL(u).hostname;
    // Our own endpoints and private hosts are never a research source, and
    // asking Firecrawl for them would leak an internal address to a third
    // party for nothing.
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false;
    if (/(^|\.)vercel\.app$/i.test(h)) return false;
    return true;
  } catch (e) { return false; }
}

/**
 * One page, as markdown.
 *
 * Never throws: a page that will not load is a page the worker researches the
 * ordinary way instead. Returns '' when there is nothing usable.
 */
export async function scrape(url, ms = T_SCRAPE, max = MAX_CHARS) {
  if (!firecrawlReady() || !fetchable(url)) return '';
  try {
    const r = await fetchWith(API + '/scrape', ms, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key(), 'content-type': 'application/json' },
      body: JSON.stringify({
        url: clean(url),
        formats: ['markdown'],
        onlyMainContent: true,
        // A rate or an opening time changes; a day-old copy of the page is
        // still worth far more than no page, and cached reads are cheaper.
        maxAge: 3600000,
      }),
    });
    if (!r.ok) return '';
    const j = await r.json();
    const md = (j && j.data && j.data.markdown) || (j && j.markdown) || '';
    const text = clean(md);
    if (text.length < 80) return '';       // a cookie banner is not a page
    // `max` exists for the health probe only. The app always takes the default:
    // reading a whole page into a worker is the token bill this file was
    // written to avoid. A diagnostic asking "is the price even in here" needs
    // the rest of the page, and asking that was how the Booking.com bot
    // interstitial was finally caught.
    const cap = Math.max(1000, Math.min(60000, Number(max) || MAX_CHARS));
    return text.length > cap ? text.slice(0, cap) + '\n\n[…page truncated]' : text;
  } catch (err) {
    return '';
  }
}
