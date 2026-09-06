import { useEffect, useState } from 'react';

// Installing the trip on a phone.
//
// raffy, 2026-09-06: "when i click install app, it opens the app on my next tab
// in browser. how to install as app? for both android and iphone. need to guide
// user to do it or do it automatically for them"
//
// Both, because the two platforms genuinely differ and pretending otherwise
// would mean lying to one of them:
//
//   ANDROID / CHROME — there is a real API. The browser fires
//   `beforeinstallprompt` when the page qualifies (https, a manifest with an
//   acceptable icon, a service worker with a fetch handler). Catch it, and one
//   tap opens the system install dialog. Genuinely automatic.
//
//   IPHONE / SAFARI — there is no API and there is not going to be one. Apple
//   requires the person to tap Share and then Add to Home Screen themselves.
//   Nothing can trigger it, so the only honest thing is to show them exactly
//   where to tap.
//
// And when it is already installed, neither: the app is running from the home
// screen and a bar telling them to install it is noise.

const isIOS = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iPadOS 13+ reports itself as a Mac, and the touch points are what give it
  // away. Without this, an iPad gets the Android path and no instructions.
  return /iPad|iPhone|iPod/.test(ua)
    || (/Macintosh/.test(ua) && typeof document !== 'undefined' && navigator.maxTouchPoints > 1);
};

const installed = () => {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  } catch (e) { return false; }
};

export default function Install({ title, shared }) {
  const [prompt, setPrompt] = useState(null);   // the Android event, once it fires
  const [how, setHow] = useState(false);        // the iPhone instructions
  const [gone, setGone] = useState(false);
  const [ios, setIos] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (installed()) { setGone(true); return undefined; }
    setIos(isIOS());
    setReady(true);

    const onPrompt = (e) => {
      // Chrome shows its own mini-infobar unless this is called, and that bar
      // cannot be styled or placed. Taking the event lets the button sit where
      // it belongs and fire the same dialog.
      e.preventDefault();
      setPrompt(e);
    };
    const onDone = () => { setGone(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onDone);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onDone);
    };
  }, []);

  if (gone || !ready) return null;
  // On Android before the event arrives there is nothing to offer, and a button
  // that might not work is worse than no button.
  if (!ios && !prompt) return null;

  const go = async () => {
    if (ios) { setHow(true); return; }
    try {
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') setGone(true);
      // A dismissal consumes the event — the browser will not fire it again for
      // this page load, so the button goes rather than sitting there dead.
      setPrompt(null);
    } catch (e) {
      setPrompt(null);
    }
  };

  return (
    <div className="ins">
      <div className="row">
        <span className="ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="2" width="12" height="20" rx="3" /><path d="M11 18h2" />
          </svg>
        </span>
        <span className="txt">
          <b>Keep {title || 'this trip'} on your phone</b>
          <i>{shared
            ? 'Someone shared this with you — keep it, it works with no signal'
            : ios ? 'Two taps, and it opens like an app' : 'Opens like an app, works with no signal'}</i>
        </span>
        <button className="go" onClick={go}>{ios ? 'How' : 'Install'}</button>
        <button className="x" onClick={() => setGone(true)} aria-label="Not now">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      {/* Apple gives no way to trigger this, so the next best thing is showing
          them precisely where to tap rather than describing it. */}
      {how && (
        <ol className="steps">
          <li>
            Tap the <b>Share</b> button
            <svg className="sh" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V3M8.5 6.5 12 3l3.5 3.5" /><path d="M6 12H4v9h16v-9h-2" />
            </svg>
            at the bottom of Safari
          </li>
          <li>Scroll down and tap <b>Add to Home Screen</b></li>
          <li>Tap <b>Add</b>. It lands on your home screen like any other app.</li>
        </ol>
      )}

      <style jsx>{`
        .ins{
          position:sticky;top:0;z-index:50;
          background:#10362A;color:#EAF2EC;
          padding:10px 12px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;
        }
        .row{display:flex;align-items:center;gap:10px}
        .ico{flex:none;display:grid;place-items:center;width:32px;height:32px;
          border-radius:9px;background:rgba(255,255,255,.12)}
        .ico svg{width:16px;height:16px}
        .txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
        .txt b{font-size:13px;font-weight:750;line-height:1.25}
        .txt i{font-size:11px;font-style:normal;opacity:.72;line-height:1.3}
        .go{
          flex:none;border:0;border-radius:99px;padding:8px 15px;cursor:pointer;
          background:#EE7B45;color:#fff;font-family:inherit;font-size:12.5px;font-weight:750;
        }
        .x{
          flex:none;width:28px;height:28px;padding:0;display:grid;place-items:center;
          border:0;border-radius:50%;background:transparent;color:#EAF2EC;opacity:.6;cursor:pointer;
        }
        .x svg{width:13px;height:13px}
        .steps{
          margin:10px 0 2px;padding:0 0 0 20px;display:flex;flex-direction:column;gap:7px;
          font-size:12.5px;line-height:1.45;opacity:.92;
        }
        .steps b{font-weight:750}
        .sh{width:13px;height:13px;vertical-align:-2px;margin:0 3px}
      `}</style>
    </div>
  );
}
