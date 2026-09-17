// The link a shared answer actually is: a page that exists ONLY to hand a
// crawler the right preview card, then send a real visitor straight to the
// real landing page with that answer already showing.
//
// raffy, 2026-09-17: "i want to copy people question from Facebook. and
// paste it in the landing page. then i want to share the real answer it
// give in the form of visual link... so they might be intrigue to explore
// the app." Then, catching an early draft that gave this its own separate
// little page: "I want the link bring to the answer on the landing page
// btw." He is right that a stranger clicking a link from a Facebook
// comment should land on the actual site, not a stripped-down card that
// looks like nothing else they will see there.
//
// The one thing forcing a server page to exist at all: WhatsApp, Facebook
// and every other link-preview crawler read a plain HTTP response's <head>
// — they do not run JavaScript and mostly do not follow a redirect either,
// so a per-link og:image/og:title needs a real server-rendered response at
// THIS url. public/welcome/index.html is a static file with one fixed
// <head>, so it can never show a different question per link on its own.
// Splitting the job this way — a thin page for the crawler, an instant
// client-side redirect for everyone else — is the standard shape for
// exactly this mismatch, and nobody sees a different answer than the one
// the link actually promised: crawler and person read about the same Q&A,
// just through the surface each of them can actually use.
import Head from 'next/head';
import SocialMeta from '../../components/SocialMeta.js';
import { getAnswerShare } from '../../lib/answershare.js';
import { answerCard } from '../../lib/answercard.js';

export default function SharedAnswerRedirect({ dest, og }) {
  return (
    <>
      <Head>
        <title>{og ? '"' + og.title + '" — Trip Builder' : 'Trip Builder'}</title>
        <meta name="robots" content="noindex, nofollow" />
        {og && <SocialMeta og={og} />}
        {/* A crawler reads this; a real browser has already left by the
            time it would matter — see the script below, which runs first. */}
        <meta httpEquiv="refresh" content={'0;url=' + dest} />
      </Head>
      <script dangerouslySetInnerHTML={{ __html: 'location.replace(' + JSON.stringify(dest) + ')' }} />
      <p style={{ font: '14px system-ui', color: '#4A6058', padding: 24 }}>
        Taking you to Trip Builder…
      </p>
    </>
  );
}

export async function getServerSideProps(ctx) {
  const token = String(ctx.params.token || '');
  const row = await getAnswerShare(token).catch(() => null);

  // A gone or unknown token still lands somewhere real, not an error page —
  // whoever followed the link asked to see an answer, and the plain
  // landing page is the closest honest thing to show them.
  if (!row || !row.question || !row.answer) {
    return { props: { dest: '/welcome', og: null } };
  }

  const host = ctx.req.headers['x-forwarded-host'] || ctx.req.headers.host || '';
  const proto = /^localhost|^127\./.test(host) ? 'http' : 'https';
  const base = proto + '://' + host;
  const og = answerCard(row.question, row.answer, base, base + '/a/' + encodeURIComponent(token));

  // Warmed before a crawler ever fetches it — same reasoning as
  // pages/t/[s].js: a slow first render loses the whole preview, not just
  // the photo, so the cache should already be warm by the time this link
  // is actually pasted anywhere.
  try {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 2500);
    await fetch(og.image, { signal: stop.signal }).catch(() => {});
    clearTimeout(timer);
  } catch (err) { /* the card render can fail; the redirect cannot */ }

  return { props: { dest: '/welcome?a=' + encodeURIComponent(token), og } };
}
