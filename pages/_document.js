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
// Off. It was on for exactly one thing — getting past Travelpayouts' Drive
// install gate — and he is through, so it comes out. The slot stays because
// the gate may reappear; set TRAVELPAYOUTS_DRIVE to the full script URL and it
// is back, no code change.
const DRIVE = (() => {
  const u = (process.env.TRAVELPAYOUTS_DRIVE
    || process.env.NEXT_PUBLIC_TRAVELPAYOUTS_DRIVE || '').trim();
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
        {/* The same two faces the generated trip carries, served from here.
            raffy, 2026-09-02, of his Desaru app: "its not using the font I ask
            you to fix for all app. its still using the old font."

            The trip app embeds its fonts and always had them. THIS page — the
            chrome around it, the title, the tabs — was pulling them from Google
            Fonts over the network. On a slow phone that renders the whole shell
            in the system font until the CSS arrives, and next to an iframe that
            already has its own, the app looks like it is using the wrong one.
            A face the app depends on should not be a request that can lose.

            36KB for both, and they were already in the repo for the generated
            app — so this costs nothing new and removes a third-party hop. */}
        <link rel="preload" as="font" type="font/woff2" href="/outfit.woff2" crossOrigin="anonymous" />
        <link rel="preload" as="font" type="font/woff2" href="/jakarta.woff2" crossOrigin="anonymous" />
        <style dangerouslySetInnerHTML={{ __html:
          "@font-face{font-family:'Outfit';font-weight:100 900;font-style:normal;"
          + "font-display:swap;src:url(/outfit.woff2) format('woff2')}"
          + "@font-face{font-family:'Plus Jakarta Sans';font-weight:200 800;font-style:normal;"
          + "font-display:swap;src:url(/jakarta.woff2) format('woff2')}" }} />
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
