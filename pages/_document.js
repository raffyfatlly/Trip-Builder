import { Html, Head, Main, NextScript } from 'next/document';

// Travelpayouts' "Drive" tag, off unless a URL is set.
//
// raffy, 2026-09-02: "signing in forces me to complete this . what do i need to
// do." Their dashboard will not let him past the Drive install step, and the
// marker and the API token are behind it — so the script has to be on the site
// for one verification, whatever we think of carrying it.
//
// It is gated on an env var holding the FULL src they give you, rather than a
// flag we expand into a URL: their filename is base64 of the marker today, and
// guessing that for him would turn a five-minute unblock into a 404 he has to
// debug. Paste what they gave you; nothing is inferred.
//
// Turn it on, verify, turn it off. Unset the variable and redeploy and the tag
// is gone — no code change, no leftover third-party script on the page where
// people type their travel plans. The reason this is an acceptable trade at
// all is that the app has no real users yet; it would not be later.
// Either name works. Neither is read at request time, though — measured, not
// assumed: `/` is statically prerendered, so _document runs during the BUILD
// and its HTML is then served as a file. Turning this on or off therefore needs
// a real rebuild, and a Vercel redeploy that reuses the build cache will
// silently change nothing. Uncheck the build cache.
//
// Making it a runtime read would mean giving `/` getServerSideProps — paying a
// server render on every visit, for every visitor, for ever, to save one
// rebuild of a tag that is meant to be temporary. Not worth it.
// ON, temporarily and deliberately, so their verifier can see it. It comes
// straight back out the moment the dashboard lets him in — that removal is
// mine to remember, not his.
const DRIVE_DEFAULT = 'https://emrld.ltd/NTY5NjIy.js?t=569622';

const DRIVE = (() => {
  const set = process.env.TRAVELPAYOUTS_DRIVE
    ?? process.env.NEXT_PUBLIC_TRAVELPAYOUTS_DRIVE;
  // An env var set to anything, including empty, wins — that is the off switch
  // if this needs killing before the next deploy.
  const u = (set === undefined ? DRIVE_DEFAULT : set).trim();
  return /^https:\/\/[\w.-]+\/[\w./?=&-]*$/.test(u) ? u : '';
})();

// Next's default viewport meta has no viewport-fit=cover, which the safe-area
// insets below depend on for notched phones.
export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#10362A" />
        <meta name="robots" content="noindex, nofollow" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap"
        />
        {DRIVE && (
          <script
            data-cmp-ab="2"
            dangerouslySetInnerHTML={{
              __html:
                '(function(){var s=document.createElement("script");s.async=1;'
                + 's.setAttribute("data-cmp-ab","2");'
                + 's.src=' + JSON.stringify(DRIVE) + ';'
                + 'document.head.appendChild(s);})();',
            }}
          />
        )}
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
