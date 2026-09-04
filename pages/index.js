import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import { renderPreview, downloadName } from '../lib/preview.js';
import { applyEdits, countStale, loadEdits, saveEdits, forRender } from '../lib/edits.js';

// Measuring has to happen before the browser paints, not after. useEffect runs
// after, which leaves one frame where the new character is rendered at the old
// height — the textarea scrolls itself to fit and the end of the line appears
// to vanish. useLayoutEffect does not exist on the server, so fall back there.
const useMeasure = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
import { loadTrips, rememberTrip, forgetTrip, loadMemory, saveMemory } from '../lib/trips.js';
import Editor from '../components/Editor.js';
import Block from '../components/Blocks.js';
import Onboard from '../components/Onboard.js';
import Plan from '../components/Plan.js';
import Drawer from '../components/Drawer.js';
import Rich from '../components/Rich.js';
import Actions from '../components/Actions.js';
import { applyMemory, editSlot, filledCount } from '../lib/memory.js';

const KEY = 'itin.session.v1';
const POLL_MS = 2000;
// The server can legitimately spend a while advancing the agent, but a poll
// that outlives this is not going to arrive. Give up, show something honest,
// and try again on the next tick.
const POLL_TIMEOUT_MS = 45000;
// How often to nudge the agent forward. Slower than the render poll on
// purpose: this one does the expensive work, and only one runs at a time.
const ADVANCE_MS = 2500;

export default function Home() {
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState([]);      // uploaded, not yet sent
  const [thinking, setThinking] = useState(false);
  // What the agent is doing, in its own words, and how long it has been at it.
  const [doing, setDoing] = useState(null);
  // And what it has already done this turn, so a long wait shows progress
  // rather than one line that might mean it is stuck.
  const [steps, setSteps] = useState([]);
  const [since, setSince] = useState(0);
  // Consecutive failed polls. A blank page after a refresh reads as "my trip
  // is gone" when the truth is "the server did not answer" — say which.
  const [stalled, setStalled] = useState(0);
  const [building, setBuilding] = useState(false);
  const [itinerary, setItinerary] = useState(null);
  // What the page saw, for the beta journal. Never awaited, never allowed to
  // fail loudly: a log line is not worth an error boundary.
  const logged = useRef(new Set());
  const log = useCallback((ev, data, once) => {
    if (!session) return;
    if (once) { if (logged.current.has(once)) return; logged.current.add(once); }
    try {
      fetch('/api/log', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session, ev, data: data || {} }),
        keepalive: true,
      }).catch(() => {});
    } catch (e) { /* ignore */ }
  }, [session]);

  const [preview, setPreview] = useState('');
  // A render that throws used to be logged and then look exactly like a trip
  // with nothing in it yet, so the one screen that could have said something
  // was wrong said "once there is enough to build" instead — through every
  // reload and every rebuild.
  const [previewErr, setPreviewErr] = useState('');
  const [sheet, setSheet] = useState(false);       // itinerary open on mobile
  const [error, setError] = useState('');
  const [booting, setBooting] = useState(true);
  const [edits, setEdits] = useState([]);
  const [pane, setPane] = useState('preview');   // preview | edit
  const [staleNote, setStaleNote] = useState(0);
  const [progress, setProgress] = useState(null);
  // The composer, docked over the trip, so a change never costs you the view.
  const [dock, setDock] = useState(null);
  const [agentEdits, setAgentEdits] = useState([]);
  const [trips, setTrips] = useState([]);
  const [menu, setMenu] = useState(false);
  // "Save profile" has to land on the email field, not just open the drawer
  // and leave them hunting for it behind a collapsed row.
  const [signInNow, setSignInNow] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const [plan, setPlan] = useState({});
  const [skipOb, setSkipOb] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [hintOff, setHintOff] = useState(true);
  const [account, setAccount] = useState({ accounts: false, user: null });
  const [memory, setMemory] = useState(null);

  const router = useRouter();

  const scroller = useRef(null);
  const inputRef = useRef(null);
  const lastItinerary = useRef('');

  // --- session ------------------------------------------------------------
  useEffect(() => {
    setTrips(loadTrips());
    try { setHintOff(localStorage.getItem('itin.hint.attach') === 'off'); } catch (e) { setHintOff(false); }
    setMemory(loadMemory());

    // ?s=<session id> opens one specific trip. It is how a trip gets back to
    // you when the browser has lost it — a different phone, cleared storage.
    let id = null;
    let q = null;
    try { q = new URLSearchParams(location.search).get('s'); } catch (e) { /* ignore */ }
    if (q) {
      id = q;
      try { localStorage.setItem(KEY, q); } catch (e) { /* private mode */ }
      // Through the router, not history.replaceState: Next rewrites the URL
      // from its own history state during hydration, so a raw replaceState is
      // undone a moment later and ?s= stays put — which would make "New trip"
      // reopen the same trip forever.
      router.replace('/', undefined, { shallow: true });
    }

    if (!id) {
      try { id = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
    }
    if (id) { setSession(id); setBooting(false); return; }

    fetch('/api/session', { method: 'POST' })
      .then((d0) => d0.json())
      .then((d) => {
        if (!d.session) throw new Error(d.error || 'no session');
        try { localStorage.setItem(KEY, d.session); } catch (e) { /* ignore */ }
        setSession(d.session);
      })
      .catch(() => setError('Could not start. Reload to try again.'))
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    if (session) setEdits(loadEdits(session));
  }, [session]);

  // Who is signed in, and what does their account already hold. Runs once, and
  // failing is fine: no account simply means the browser's own list stands, the
  // way it did before accounts existed.
  useEffect(() => {
    let alive = true;
    fetch('/api/me')
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !d) return;
        setAccount({ accounts: !!d.accounts, user: d.user || null });
        if (d.user && Array.isArray(d.trips)) mergeTrips(d.trips);
        // The account's profile wins on sign-in: it is the one that has
        // followed them across devices.
        if (d.user && d.memory) { saveMemory(d.memory); setMemory(d.memory); }
      })
      .catch(() => { /* anonymous, as before */ });
    return () => { alive = false; };
  }, []);



  // --- polling ------------------------------------------------------------
  useEffect(() => {
    if (!session) return;
    let alive = true;
    let timer;

    const tick = async () => {
      try {
        // The server holds this open while it advances the agent, and a poll
        // that never returns used to leave the page blank forever. Give up and
        // try again rather than waiting on it.
        const r = await fetch('/api/state?session=' + encodeURIComponent(session),
          { signal: AbortSignal.timeout(POLL_TIMEOUT_MS) });
        if (!r.ok) throw new Error('state ' + r.status);
        const d = await r.json();
        if (!alive) return;
        if (d.transcript) setMessages(d.transcript);
        setThinking(!!d.thinking);
        setBuilding(!!d.building);
        setProgress(d.progress || null);
        setDoing(d.doing || null);
        setSteps(Array.isArray(d.steps) ? d.steps : []);
        if (d.itinerary) setItinerary(d.itinerary);
        setAgentEdits(d.agentEdits || []);
        setPlan(d.plan || {});
        if ((d.memoryOps || []).length) foldMemory(d.memoryOps);
        setLoaded(true);
        setStalled(0);
      } catch (e) {
        if (alive) setStalled((n) => n + 1);
      }
      if (alive) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [session]);

  // The other half of the loop, kept away from the one that renders.
  //
  // /api/advance answers the agent's pending tool calls and takes the build
  // forward. It can legitimately run for minutes, so it gets its own slow
  // cadence and never blocks the poll above — which is the whole reason the
  // Italy trip came back blank. One at a time: a second call while the first
  // is still going would duplicate work and cost money twice.
  useEffect(() => {
    if (!session) return;
    let alive = true;
    let timer;
    let inFlight = false;

    const push = async () => {
      if (!inFlight) {
        inFlight = true;
        try {
          await fetch('/api/advance?session=' + encodeURIComponent(session), { method: 'POST' });
        } catch (e) { /* the next one retries; the page is unaffected */ }
        inFlight = false;
      }
      if (alive) timer = setTimeout(push, ADVANCE_MS);
    };
    push();
    return () => { alive = false; clearTimeout(timer); };
  }, [session]);

  // How long the current wait has been going. Reset whenever it stops working,
  // so the escalating copy below is about this wait, not the session.
  useEffect(() => {
    if (!thinking && !building) { setSince(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setSince(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [thinking, building]);

  // The itinerary is read-only (replayed from the event log), so manual edits
  // live alongside it and are applied on top.
  // Two sources of edits: the chat agent's (replayed from the chat log) and
  // the traveller's own (localStorage). Ordered by timestamp so whichever
  // happened last wins, rather than one source always overriding the other.
  const allEdits = useMemo(() => {
    const merged = [...agentEdits, ...edits];
    merged.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return merged;
  }, [agentEdits, edits]);

  const working = useMemo(
    () => applyEdits(itinerary, allEdits), [itinerary, allEdits]);

  // What to call this trip, in one place. The destination is known from the
  // moment the agent notes it, long before anything is built — and it must be
  // declared here, above every use: a const referenced from a hook's
  // dependency array higher up hits the temporal dead zone and takes the whole
  // page down.
  const tripName =
    (working && working.trip && working.trip.title)
    || (plan && plan.destination)
    || '';

  // Keep this browser's trip list current. The label is the destination once
  // the itinerary exists, and before that the first thing they typed — an
  // unbuilt trip is still worth being able to get back to.
  const lastLabel = useRef('');
  useEffect(() => {
    if (!session || !messages.length) return;
    // Best name available, in order: what the built itinerary calls itself,
    // then the destination the agent has settled on. The first line they typed
    // is the last resort — "We're going to Da Nang, 10 September 2026 to 14
    // September" is a sentence, not a name, and it reads badly in a list.
    const label = tripName
      || (messages.find((m) => m.role === 'user') || {}).text?.replace(/\s+/g, ' ').slice(0, 42)
      || '';
    if (!label || label === lastLabel.current) return;
    lastLabel.current = label;
    rememberTrip(session, label);
    setTrips(loadTrips());
    if (account.user) {
      fetch('/api/me', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claim: { id: session, label } }),
      }).catch(() => { /* the local list is still right */ });
    }
  }, [session, tripName, messages, account.user]);

  // A rebuild can orphan edits that pointed at days which no longer exist.
  // Say so rather than letting them disappear quietly.
  useEffect(() => {
    if (!itinerary || !allEdits.length) return;
    setStaleNote(countStale(itinerary, allEdits));
  }, [itinerary, allEdits]);

  const applyOp = useCallback((op) => {
    setEdits((prev) => {
      const next = [...prev, { ...op, ts: Date.now(), by: 'you' }];
      if (session) saveEdits(session, next);
      return next;
    });
  }, [session]);

  // "Change this" from inside the preview.
  //
  // raffy, 2026-09-01: "give the button to chat , then auto interactive message
  // send to chat . chat agent then make the edits."
  //
  // Handed to the composer rather than sent, with the cursor after it. The
  // agent cannot act on "Change dinner:" alone, and a message that fires on tap
  // would be a question with no question in it — the same mistake as an option
  // chip that sends itself.
  useEffect(() => {
    const onAsk = (e) => {
      const ask = e && e.data && e.data.tripAsk;
      if (!ask || typeof ask !== 'object') return;
      // "Add something of your own" is the one ask with nothing named yet —
      // that is the whole point of it. raffy, 2026-09-02: "i cant click the add
      // something on my own". The button worked; this guard threw its message
      // away for having an empty `what`.
      if (!ask.what && ask.kind !== 'addtask') return;
      // Stay on the trip. raffy, 2026-09-01: "for mobile we need to find better
      // way where chat can exist in the same page , especially on the change
      // this part... i just want the chat continues to live in the app."
      //
      // Bouncing to the chat to type one sentence loses the thing you were
      // looking at, which is the whole context of the change. The composer
      // comes to the trip instead, as a dock over the bottom of it.
      setDock({ what: ask.what, when: ask.when || '', kind: ask.kind || 'change', sending: false });
    };
    window.addEventListener('message', onAsk);
    return () => window.removeEventListener('message', onAsk);
  }, []);

  // Task labels start with a verb because they are instructions to do
  // something. Once it is done, the verb is in the way: "Booked: Book the
  // flights" reads like a stutter.
  const thing = (what) => String(what || '').replace(/^(book|confirm|sort|apply for)\s+/i, '');

  const dockRef = useRef(null);

  // How many things the agent has said. The dock uses it to tell an answer to
  // THIS ask from the one before it.
  const saidCount = messages.filter((m) => m.role === 'assistant' && m.text).length;

  // What the agent last said, trimmed to something that fits a dock — but only
  // if it said it after they asked.
  //
  // raffy, 2026-09-02: "the chat field sometimes show old messages from the
  // chat... it should just focus on the new msg or process its producing at
  // that moment . like a glitch."
  //
  // It was showing the last assistant line whenever `thinking` was false, and
  // `thinking` is a server flag that takes a poll to turn on. So for the second
  // between pressing send and the server admitting it was working, the dock
  // displayed the PREVIOUS answer — an old message flashing up as though it
  // were the reply. It read as a glitch because it was one.
  //
  // Counting is the fix, not a longer delay: an answer either exists or it does
  // not, and a count says which without asking a flag that lags.
  const answerSince = (n) => {
    if (!Number.isInteger(n) || saidCount <= n) return '';
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== 'assistant' || !m.text) continue;
      const line = String(m.text).split('\n').map((x) => x.trim()).filter(Boolean)[0] || '';
      return line.length > 130 ? line.slice(0, 128) + '…' : line;
    }
    return '';
  };


  const undoEdits = useCallback(() => {
    setEdits([]);
    if (session) saveEdits(session, []);
    setStaleNote(0);
  }, [session]);

  // --- render the preview when the itinerary actually changes -------------
  useEffect(() => {
    if (!working || !working.days || !working.days.length) return;
    const sig = JSON.stringify(working);
    if (sig === lastItinerary.current) return;
    lastItinerary.current = sig;
    renderPreview(forRender(working))
      .then((html) => { setPreview(html); setPreviewErr(''); })
      .catch((e) => {
        console.error('preview failed', e);
        setPreviewErr(String((e && e.message) || e));
        log('preview.failed', { why: String((e && e.message) || e).slice(0, 160) });
      });
  }, [working]);

  // Follow the conversation down, but only while they are actually at the
  // bottom. The poll fires every two seconds, and unconditionally scrolling on
  // each one made reading back through the chat impossible on a phone — you
  // scrolled up and were yanked to the end again a moment later.
  const pinned = useRef(true);
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    // A little slack: "near the bottom" counts as at it, so momentum scrolling
    // and rubber-banding do not unpin you by a pixel.
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages, thinking, building, steps.length]);

  // Sending is the one moment to override that: their own message should
  // always bring them back to the bottom.
  const stickToBottom = () => { pinned.current = true; };

  // The box grows with what they write, up to a point, then scrolls. Height
  // has to be reset to auto first or it can only ever get taller — shrinking
  // back after a delete would not work.
  const grow = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    // A hidden box cannot be measured, and measuring it anyway sets a height
    // of zero that nothing later corrects.
    //
    // raffy, 2026-09-01: "sometimes when im back from app to chat, the chat
    // input fill become like in photo" — the placeholder sliced in half. On a
    // phone the trip pane hides the chat outright, so any grow() that fires
    // while it is open reads scrollHeight 0 and writes height:0px. Coming back
    // re-showed a box that had already been told to be nothing.
    if (el.offsetParent === null) return;
    el.style.height = 'auto';
    const h = el.scrollHeight;
    if (!h) return;
    el.style.height = Math.min(h, 168) + 'px';
    // Past one line the controls drop to their own row underneath, so the
    // text gets the full width instead of threading between two buttons.
    // Measured against the line height rather than a fixed pixel count, so it
    // holds if the type size ever changes.
    // scrollHeight includes the padding, so compare like with like — measuring
    // the raw value against one line made an EMPTY box look like two lines.
    const cs = getComputedStyle(el);
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const line = parseFloat(cs.lineHeight) || 22;
    const lines = (h - pad) / line;
    // Tall latches until the box is empty, and that is the whole fix.
    //
    // Going tall moves the two buttons onto their own row, so the textarea
    // gets about 96px WIDER. Text that had just wrapped to a second line then
    // fits on one again — which says "go short" — which narrows it — which
    // wraps it. The composer flip-flopped on every keystroke for the whole
    // end of the first line, and settled only once the text was long enough
    // to wrap at both widths. Measured here: thirteen switches in one line.
    //
    // No threshold can fix that, because the measurement is downstream of the
    // thing it decides. Breaking the loop is the fix: once it has grown it
    // stays grown until they send or clear, which is also what anyone would
    // expect a text box to do mid-sentence.
    // (raffy, 2026-09-01: "as i was writing the first line, at the end, some
    // words and letters go missing, and glitch. only after finishing that last
    // few lines and moving to second line it will stabilise again.")
    setTall((was) => (!el.value ? false : was || lines > 1.7));
  }, []);

  useMeasure(() => { grow(); }, [draft, grow]);

  // The height was measured once at mount and then only when they typed. The
  // conversation loading in above it, a font finishing its swap, the keyboard
  // opening — none of those change `draft`, so none of them re-measured, and
  // a stale height just sat there through all of it.
  useEffect(() => {
    grow();
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    window.addEventListener('resize', grow);
    if (vv) vv.addEventListener('resize', grow);
    if (typeof document !== 'undefined' && document.fonts) {
      Promise.resolve(document.fonts.ready).then(grow).catch(() => {});
    }
    return () => {
      window.removeEventListener('resize', grow);
      if (vv) vv.removeEventListener('resize', grow);
    };
  }, [grow]);

  useEffect(() => { grow(); }, [messages.length, grow]);

  // And re-measure the moment the chat is on screen again. Nothing else in
  // this component changes when the trip pane closes, so without this the box
  // keeps whatever height it had when it went away.
  useMeasure(() => { grow(); }, [sheet, grow]);

  // On a phone there is no shift key, so Enter cannot mean "send" — it has to
  // mean a new line, or you can never write a second paragraph. With a real
  // keyboard Enter still sends and shift+Enter breaks the line, which is what
  // anyone typing at a desk expects.
  const [tall, setTall] = useState(false);

  // Switching to tall changes the width, so the height measured a moment ago
  // was for the old layout. Re-measure once the class has actually landed.
  // Safe from looping now that tall only latches one way.
  useMeasure(() => { grow(); }, [tall, grow]);
  const [hasKeyboard, setHasKeyboard] = useState(false);
  useEffect(() => {
    try { setHasKeyboard(window.matchMedia('(hover: hover) and (pointer: fine)').matches); }
    catch (e) { setHasKeyboard(false); }
  }, []);

  // --- sending ------------------------------------------------------------
  const send = useCallback(async (override) => {
    const text = typeof override === 'string' ? override : draft.trim();
    if ((!text && !pending.length) || !session) return;

    stickToBottom();

    // Optimistic: the poll will replace this with the real transcript.
    const label = [pending.map((f) => '📎 ' + f.name).join('\n'), text]
      .filter(Boolean).join('\n');
    setMessages((m) => [...m, { role: 'user', text: label, id: 'tmp' + Date.now() }]);
    if (typeof override !== 'string') setDraft('');
    const files = pending;
    setPending([]);
    setThinking(true);

    try {
      const r = await fetch('/api/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session, text, files, memory,
          // The browser knows its own timezone exactly; the IP lookup only
          // approximates it. No permission prompt for either.
          client: {
            tz: (() => {
              try { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
              catch (e) { return null; }
            })(),
            lang: typeof navigator !== 'undefined' ? navigator.language : null,
          },
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error || 'Could not send that.');
        setThinking(false);
      }
    } catch (e) {
      setError('Could not send that.');
      setThinking(false);
    }
  }, [draft, pending, session]);

  const attach = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    for (const f of files) {
      try {
        const data = await new Promise((ok, no) => {
          const rd = new FileReader();
          rd.onload = () => ok(String(rd.result).split(',')[1]);
          rd.onerror = no;
          rd.readAsDataURL(f);
        });
        const r = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: f.name, type: f.type, data, session }),
        });
        const d = await r.json();
        if (d.file_id) setPending((p) => [...p, d]);
        else setError(d.error || 'Could not attach that.');
      } catch (err) {
        setError('Could not attach that.');
      }
    }
  };

  // Saving the trip bakes the photographs into it.
  //
  // raffy, 2026-09-03: "make sure the photos stay in app too." They did not:
  // the file kept the pictures as URLs, and /api/photo is a relative path, so
  // opened from disk it resolved to file:///api/photo and every Google Places
  // photo was a broken image. Anything on somebody else's host was one outage
  // from the same. See pages/api/bake.js for why the fetching happens there.
  //
  // Best effort, and never a reason not to get the file: if baking fails or
  // takes too long, the download goes ahead with the URLs it already had.
  const [baking, setBaking] = useState(false);
  const download = async () => {
    let html = preview;
    const urls = (working && working.photos) || {};
    if (Object.keys(urls).length) {
      setBaking(true);
      try {
        const r = await fetch('/api/bake', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ urls }),
          signal: AbortSignal.timeout(60000),
        });
        if (r.ok) {
          const { photos } = await r.json();
          const baked = { ...urls, ...photos };
          // Re-render rather than string-replacing: the URLs appear inside a
          // JSON blob in the document, and a blind replace would also hit any
          // that happen to be a prefix of another.
          html = await renderPreview(forRender({ ...working, photos: baked }));
        }
      } catch (e) {
        console.error('baking photos failed, saving with links instead', e);
      }
      setBaking(false);
    }
    log('download', { baked: Object.keys(urls).length, bytes: html.length });
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName(working);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Starting a new trip must never lose the last one. The id stays in the
  // trip list; only the pointer to the current one is cleared.
  const startOver = () => {
    setMenu(false);
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    location.reload();
  };

  // Switching trips reloads rather than swapping state in place: everything on
  // this page hangs off the session id, and a reload is the one way to be sure
  // none of the old trip is left behind.
  const openTrip = (id) => {
    if (id === session) { setMenu(false); return; }
    try { localStorage.setItem(KEY, id); } catch (e) { /* ignore */ }
    location.reload();
  };

  // The agent's remember/forget calls arrive as ops replayed from the chat
  // log. Folding them here, rather than storing a profile on the server, keeps
  // the same stateless shape as the itinerary edits.
  const seenOps = useRef(new Set());
  const foldMemory = (ops) => {
    const fresh = ops.filter((o) => !seenOps.current.has(o.id));
    if (!fresh.length) return;
    fresh.forEach((o) => seenOps.current.add(o.id));
    setMemory((prev) => {
      const next = fresh.reduce((m, o) => applyMemory(m, o.name, o.input), prev);
      persistMemory(next);
      return next;
    });
  };

  const persistMemory = (next) => {
    saveMemory(next);
    if (account.user) {
      fetch('/api/me', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memory: next }),
      }).catch(() => { /* the local copy still stands */ });
    }
  };

  const forgetSlot = (key) => {
    setMemory((prev) => {
      const next = applyMemory(prev, 'forget', { fields: [key] });
      persistMemory(next);
      return next;
    });
  };

  const editSlotByHand = (key, text) => {
    setMemory((prev) => {
      const next = editSlot(prev, key, text);
      persistMemory(next);
      return next;
    });
  };

  const forgetAll = () => {
    setMemory(null);
    persistMemory(null);
  };

  // Asking to save the profile, without becoming a nag.
  //
  // Signed out, everything still works — the profile just lives in this
  // browser. So this is an offer, not a wall, and it is only worth making once
  // there is something to lose: a few things known, and asked again only after
  // the profile has GROWN since they last said no. Dismissing it does not
  // silence it forever, and agreeing to it never blocks anything.
  const NUDGE_KEY = 'itin.saveprofile.v1';
  const [nudgeAt, setNudgeAt] = useState(null);
  useEffect(() => {
    try { setNudgeAt(Number(localStorage.getItem(NUDGE_KEY) || 0)); } catch (e) { setNudgeAt(0); }
  }, []);

  const known = filledCount(memory);
  const nudge = account.accounts && !account.user && nudgeAt !== null && known >= 3 && known > nudgeAt + 1;

  const nudgeLater = () => {
    setNudgeAt(known);
    try { localStorage.setItem(NUDGE_KEY, String(known)); } catch (e) { /* ignore */ }
  };

  // The account's trips and this browser's are both real. Union them, newest
  // label wins, so signing in never hides work and signing out never loses it.
  const mergeTrips = (remote) => {
    for (const t of remote) rememberTrip(t.id, t.label);
    setTrips(loadTrips());
  };

  const onSignedIn = (d) => {
    setAccount({ accounts: true, user: d.user || null });
    if (Array.isArray(d.trips)) mergeTrips(d.trips);
  };

  const onSignOut = async () => {
    try { await fetch('/api/auth/signout', { method: 'POST' }); } catch (e) { /* ignore */ }
    // The local list stays. Signing out is not "delete my trips".
    setAccount((a) => ({ ...a, user: null }));
    // Land on the landing page rather than on a thinner copy of the app.
    // Someone who has just left an account is not mid-task, and the page they
    // want next is the one that says what this is.
    window.location.href = '/welcome';
  };

  const dropTrip = (id) => {
    forgetTrip(id);
    setTrips(loadTrips());
    if (account.user) {
      fetch('/api/me', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ forget: id }),
      }).catch(() => { /* ignore */ });
    }
  };

  // The builder can land save_itinerary before it has written any days, so an
  // itinerary object alone is not enough to show. Wait for a real day.
  const ready = !!(working && working.days && working.days.length > 0);
  const title = tripName || null;

  // A build runs for minutes, so it almost always lands while they are still
  // typing. Mark the button rather than interrupting them.
  //
  // Must sit below `ready`: the dependency array is evaluated during render,
  // so referencing it from higher up hits the temporal dead zone and takes the
  // whole page down.
  const wasBuilding = useRef(false);
  useEffect(() => {
    if (wasBuilding.current && !building && ready) setUnseen(true);
    wasBuilding.current = building;
  }, [building, ready]);

  // The most recent ready card, which is the only one that gets to say New.
  const lastReady = (() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'ready') return i;
    return -1;
  })();

  const openSheet = () => { setSheet(true); setUnseen(false); };

  // The onboarding steps stand in for the empty chat, not in front of it: skip
  // them and you are simply in the conversation with the box focused.
  //
  // Waits for the first poll. Reopening an existing trip starts with an empty
  // transcript for a moment, and flashing the onboarding at someone who is
  // three days into planning would be its own small betrayal.
  const onboarding = !booting && loaded && messages.length === 0 && !skipOb;

  // Nobody thinks to send a booking confirmation to a chat box. The paperclip
  // is right there and still invisible, so say it once, while it is useful —
  // when flights or a hotel are the thing still missing.
  const showHint =
    !hintOff && !onboarding && messages.length > 0 && !ready &&
    (!plan.flights || !plan.stays);

  const dismissHint = () => {
    setHintOff(true);
    try { localStorage.setItem('itin.hint.attach', 'off'); } catch (e) { /* ignore */ }
  };

  return (
    <div className="app">
      <header className="bar">
        <button className="burger" onClick={() => setMenu(true)} aria-label="Menu">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h11" />
          </svg>
        </button>

        {/* The trip's own name once it has one. A wordmark tells you nothing
            you did not already know; the destination tells you which trip. */}
        <span className="where">{title || 'Trip builder'}</span>

        {ready ? (
          <button className="itbtn" onClick={openSheet} aria-label="Itinerary" title="Itinerary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
            {unseen && <i className="ping" />}
          </button>
        ) : <span className="spacer" />}
      </header>

      <main className="split">
        <section className={'chat' + (sheet ? ' hidden-m' : '')}>
          {onboarding ? (
            <Onboard
              memory={memory}
              onStart={(seed, answers) => {
                setSkipOb(true);
                log('onboard', {
                  dest: (answers && answers.destination) || '',
                  kind: (answers && answers.kind) || '',
                  pace: (answers && answers.ready && answers.ready.pace) || '',
                });
                send(seed);
              }}
              onSkip={() => { setSkipOb(true); setTimeout(() => inputRef.current?.focus(), 0); }}
            />
          ) : (
            <>
          <Plan
            plan={plan}
            built={ready}
            building={building}
            onBuild={() => send('Build it now with what you have.')}
          />
          <div className="scroll" ref={scroller} onScroll={onScroll}>
            {booting && <div className="sys">Starting…</div>}

            {/* It stays. raffy, 2026-09-05: "The first message in chat should
                stay, the where are u going etc part." It was rendered only
                while the thread was empty, so the first thing anybody typed
                deleted the only explanation of what the two halves of this app
                are. It is the opening of the conversation now, and it scrolls
                away with everything else. */}
            {!booting && skipOb && (
              <div className="intro">
                <h1>Where are you going?</h1>
                {/* What the two halves of this thing are, in two lines.
                    raffy, 2026-09-01: "important also id to make it clear to
                    user how to use the whole app . like agents fot them to be
                    consulted... and the app itself is the app that have all
                    their plans , decision and everything displayed nicely."
                    Said once, here, where somebody is deciding whether to
                    bother — not as a tour nobody reads. */}
                <div className="how">
                  <div className="hrow">
                    <span className="hn">Talk to me</span>
                    <span>Ask anything, any time — what a hotel really costs, whether
                      it rains that week, what is worth the trip out. I look it up.</span>
                  </div>
                  <div className="hrow">
                    <span className="hn">Get your own app</span>
                    <span>Everything we settle turns into a trip app that is yours:
                      the days, the places, and what is still left to book.</span>
                  </div>
                </div>
                <div className="egs">
                  {[
                    'Da Nang with my wife and 2 kids, 10 to 14 September, staying at Furama',
                    'Tokyo for a week in November, first time, just the two of us',
                  ].map((s) => (
                    <button key={s} className="eg" onClick={() => { setDraft(s); inputRef.current?.focus(); }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, mi) => (
              /* The way into the trip, where the build happened. raffy,
                 2026-09-02: "the open app file button should stay at the
                 location where its given and not persisting to be at the
                 bottom of chat everytime." Only the most recent one is New —
                 a rebuild leaves the earlier card in place as a record of
                 when that version landed, but it is not news any more. */
              m.role === 'ready' ? (
                ready && !building ? (
                  <div key={m.id}
                    className={'done' + (unseen && mi === lastReady ? ' fresh' : '')}>
                    <div className="donetext">
                      <b>
                        {title ? title + ' is ready' : 'Your itinerary is ready'}
                        {unseen && mi === lastReady && <i className="new">New</i>}
                      </b>
                      <span>Day by day, with times, weather and everything you can edit.</span>
                    </div>
                    <button onClick={openSheet}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" />
                      </svg>
                      {unseen && mi === lastReady ? 'Open it' : 'Open'}
                    </button>
                  </div>
                ) : null
              ) : m.role === 'block' ? (
                <Block key={m.id} block={m} disabled={thinking} where={tripName} onChoose={(t) => send(t)} />
              ) : (
                <div key={m.id} className={'msg ' + m.role}>
                  {m.role === 'assistant' ? (
                    <>
                      <Rich text={m.text} />
                      <Actions actions={m.actions} />
                    </>
                  ) : m.text.split('\n').map((line, i) => <p key={i}>{line}</p>)}
                </div>
              )
            ))}

            {thinking && (
              <div className="msg assistant typing">
                {/* What it has already done, ticked off. raffy, 2026-09-05:
                    "can it leave some of the steps or action it taken then
                    continue it's task? or else user might think it got stuck."
                    Every line here is a tool call that is really on the event
                    log, and the tick is really its result. */}
                {steps.length > 0 && (
                  <ul className="trail">
                    {steps.map((s) => (
                      <li key={s.id} data-step={s.done ? 'done' : 'now'}>
                        <span className="tick">
                          {s.done ? (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                              strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 6 9 17l-5-5" />
                            </svg>
                          ) : <i />}
                        </span>
                        <span className="tw">
                          {s.what}
                          {s.detail ? <em>{s.detail}</em> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <span className="dots"><span /><span /><span /></span>
                {/* Says what it is actually doing, from the event log — not a
                    rotating list of invented phrases. After a minute it stops
                    pretending this is normal and says so, because a status that
                    keeps reassuring you through a genuine hang is worse than
                    three dots. (raffy, 2026-09-01) */}
                {/* With a trail above, this line stops repeating the step it
                    is on and says only the thing the trail cannot: that the
                    wait has gone on longer than it should have. */}
                {(() => {
                  const note = stalled > 2 ? 'Lost the connection — still trying'
                    : since > 120 ? "Longer than usual, it hasn't given up"
                      : since > 25 ? 'This one is taking a moment' : '';
                  const text = steps.length
                    ? note
                    : [doing || 'Thinking', note].filter(Boolean).join(' — ');
                  return text ? <span className="says">{text}</span> : null;
                })()}
              </div>
            )}
            {building && (
              <div className="working">
                <span className="spin" />
                {since > 240
                  ? 'Still building your itinerary. It is a big one — this can take a few minutes.'
                  : 'Building your itinerary. This takes a couple of minutes.'}
              </div>
            )}

          </div>

          {error && (
            <div className="err" onClick={() => setError('')}>{error} <b>Dismiss</b></div>
          )}

          {showHint && (
            <div className="hint">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7.5-7.5" />
              </svg>
              <span>
                Got a booking confirmation? Send the screenshot, PDF or email —
                flight times, hotel address, all of it gets read.
              </span>
              <button onClick={dismissHint} aria-label="Dismiss">×</button>
            </div>
          )}

          <div className="composer">
            {pending.length > 0 && (
              <div className="chips">
                {pending.map((f, i) => (
                  <span key={i} className="chip">
                    {f.name}
                    <button onClick={() => setPending((p) => p.filter((_, j) => j !== i))}>×</button>
                  </span>
                ))}
              </div>
            )}
            <div className={'row' + (tall ? ' tall' : '')}>
              <label className="attach" title="Attach a photo or booking">
                <input type="file" multiple accept="image/*,application/pdf,text/plain" onChange={attach} />
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7.5-7.5" />
                </svg>
              </label>
              <textarea
                ref={inputRef}
                rows={1}
                value={draft}
                placeholder={messages.length ? "Reply, or attach a booking" : "Tell me about your trip"}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.shiftKey) return;
                  // Mid-composition in an IME, Enter is choosing a candidate.
                  if (e.nativeEvent && e.nativeEvent.isComposing) return;
                  if (!hasKeyboard) return;             // phone: Enter is a new line
                  e.preventDefault();
                  send();
                }}
              />
              <button className="sendbtn" onClick={send} aria-label="Send"
                disabled={!draft.trim() && !pending.length}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20V5M5 12l7-7 7 7" />
                </svg>
              </button>
            </div>
          </div>
            </>
          )}
        </section>

        <section className={'pane' + (sheet ? ' open' : '')}>
          <div className="panehead">
            {/* Both say where they go, not which direction they point. A
                chevron means "back" and leaves you to remember back to what;
                the bubble is the conversation you came from and the one you
                return to when something needs changing. */}
            <button className="back" onClick={() => setSheet(false)} aria-label="Back to the chat" title="Back to the chat">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H7l-4 3v-6.6A8.5 8.5 0 0 1 12.5 3h.5a8.5 8.5 0 0 1 8 8.5z" />
              </svg>
            </button>
            <span>{title || 'Your itinerary'}</span>
            {ready && (
              <button className={'dl' + (baking ? ' busy' : '')} onClick={download}
                disabled={baking}
                aria-label={baking ? 'Saving, and keeping the photos' : 'Save this trip to your phone'}
                title={baking ? 'Saving, and keeping the photos' : 'Save this trip to your phone'}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" /><path d="M4 17.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5" />
                </svg>
              </button>
            )}
          </div>

          {/* The Preview/Edit toggle is gone. Changing something is a button on
              the thing itself now, which asks the agent — not a mode you switch
              into and hunt for the same item in a list of form fields.
              Photos stay by hand: the agent cannot see a picture, and choosing
              one is genuinely faster than describing it. */}
          {ready && (
            <div className="seg">
              <button className={pane === 'preview' ? 'on' : ''}
                onClick={() => setPane('preview')}>Your trip</button>
              <button className={pane === 'photos' ? 'on' : ''}
                onClick={() => setPane('photos')}>Photos</button>
            </div>
          )}

          {staleNote > 0 && (
            <div className="stale">
              {staleNote === 1 ? 'One of your changes did not' : staleNote + ' of your changes did not'} fit
              the new version of the trip, so it was left out.
              <button onClick={undoEdits}>Undo my changes</button>
            </div>
          )}

          {ready && pane === 'photos' ? (
            <div className="editwrap">
              <Editor itinerary={working} onOp={applyOp} photosOnly />
            </div>
          ) : (
            <div className="phone">
              {/* The chat, docked over the trip rather than instead of it.
                  It carries the last thing the agent said, so a change you ask
                  for here is answered here — the conversation keeps going
                  without the trip ever leaving the screen. */}
              {dock && (
                <div className="dock">
                  <button className="dx" onClick={() => setDock(null)} aria-label="Close">×</button>
                  {/* What they tapped, as a label. raffy, 2026-09-01: "the edit
                      placeholder in chat a bit weird... if i just click it and
                      send the chat will respond the message cut off". It was
                      prefilled with "Change X on Thu 10: " — a sentence you
                      could send unfinished, and a colon with nothing after it is
                      not an instruction. The context is a label now and the box
                      starts empty, so an unfinished ask cannot be sent. */}
                  {!dock.sending && (
                    <div className="dwhat">
                      <b>
                        {dock.kind === 'booked' ? 'Booked: ' + thing(dock.what)
                          : dock.kind === 'droptask' ? 'Remove: ' + thing(dock.what)
                            : dock.kind === 'addtask' ? 'Add to your list'
                              : dock.what}
                      </b>
                      {dock.when && <span>{dock.when}</span>}
                    </div>
                  )}
                  {dock.sending ? (
                    <div className="dsay">
                      {answerSince(dock.said)
                        ? <span>{answerSince(dock.said)}</span>
                        : <><i className="dd" /><i className="dd" /><i className="dd" /><span>Working on it</span></>}
                      <button className="dfull" onClick={() => { setDock(null); setSheet(false); }}>
                        Open chat
                      </button>
                    </div>
                  ) : (
                    <form
                      className="drow"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const t = (dockRef.current ? dockRef.current.value : '').trim();
                        if (dock.kind === 'addtask') {
                          if (!t) return;
                          send('Add this to my to-do list: ' + t);
                        } else if (dock.kind === 'droptask') {
                          send('Take this off my to-do list: ' + dock.what + '.'
                            + (t ? ' ' + t : '')
                            + ' Just remove it, no need to talk me out of it.');
                        } else if (dock.kind === 'booked') {
                          // "I have booked it" is already a complete
                          // instruction, so this one can send with nothing
                          // typed. A reference, a date or a pasted email just
                          // makes the record better.
                          send('I have booked this: ' + thing(dock.what) + '.'
                            + (t ? ' ' + t : '')
                            + ' File it and tick it off my list.');
                        } else {
                          // "Change this" with no change in it is not something
                          // the agent can act on.
                          if (!t) return;
                          send('Change "' + dock.what + '"'
                            + (dock.when ? ' on ' + dock.when : '') + ': ' + t);
                        }
                        // Remember what the conversation looked like at the
                        // moment of asking, so an older answer cannot be
                        // mistaken for this one.
                        setDock({ ...dock, sending: true, said: saidCount });
                      }}
                    >
                      <textarea
                        ref={dockRef}
                        rows={2}
                        autoFocus
                        placeholder={dock.kind === 'booked'
                          ? 'Paste the reference or the confirmation email — or just send.'
                          : dock.kind === 'addtask'
                            ? 'Buy an eSIM. Sort travel insurance. Renew the passports.'
                            : dock.kind === 'droptask'
                              ? 'Send to remove it. Say why only if you want to.'
                              : 'Make it later? Somewhere else? Drop it?'}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            e.currentTarget.form.requestSubmit();
                          }
                        }}
                      />
                      <button type="submit" aria-label="Send">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                          strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 19V5M5 12l7-7 7 7" />
                        </svg>
                      </button>
                    </form>
                  )}
                </div>
              )}
              {preview
                ? <iframe title="Itinerary preview" srcDoc={preview} />
                : (
                  <div className="empty">
                    <div className="ph" />
                    {/* Four different situations used to say the same
                        sentence, which is why "it just says your itinerary
                        will appear here, even after I ask it to rebuild" was
                        impossible to act on. Each one now says which. */}
                    <p>{building
                      ? 'Building your itinerary. Carry on — it keeps going without you.'
                      : previewErr
                        ? 'Your trip is safe, but this preview would not draw. Reload the page — that is usually enough. If it says this again, tell me.'
                        : working && !(working.days || []).length
                          ? 'The build came back without any days in it. Ask for it again and it will start over.'
                          : 'Your itinerary will appear here once there is enough to build.'}</p>
                    {previewErr && !building && (
                      <p className="phwhy">{previewErr}</p>
                    )}
                    {/* A bar that moves when the BUILDER moves, not when time
                        passes. An animation that fills on a timer is a lie
                        about progress, and this build genuinely varies. */}
                    {building && progress && progress.steps > 0 && (
                      <div className="bbar" role="progressbar"
                        aria-valuenow={progress.step} aria-valuemin={0} aria-valuemax={progress.steps}>
                        <i style={{ width: Math.min(97, Math.round((progress.step / progress.steps) * 100)) + '%' }} />
                      </div>
                    )}
                  </div>
                )}
            </div>
          )}
        </section>
      </main>

      <Drawer
        open={menu}
        onClose={() => { setMenu(false); setSignInNow(false); }}
        trips={trips}
        session={session}
        onOpenTrip={openTrip}
        onDrop={dropTrip}
        onNew={startOver}
        onDownload={() => { setMenu(false); download(); }}
        canDownload={ready}
        memory={memory}
        onEditSlot={editSlotByHand}
        onForgetSlot={forgetSlot}
        onForgetAll={forgetAll}
        nudge={nudge}
        onNudgeSave={() => { nudgeLater(); setMenu(true); setSignInNow(true); }}
        signInNow={signInNow}
        onNudgeLater={nudgeLater}
        accounts={account.accounts}
        user={account.user}
        onSignedIn={onSignedIn}
        onSignOut={onSignOut}
      />

      <style jsx global>{`
        :root{
          --bg:#EDF2EA; --surface:#FFFFFF; --sage:#E2EBDE; --deep:#10362A;
          --ink:#0C241B; --ink-soft:#4C6157; --ink-faint:#5A6C63;
          --coral:#EE7B45; --line:rgba(12,36,27,.10);
          --sh-s:0 2px 10px rgba(12,36,27,.06);
          --sh-m:0 8px 26px -10px rgba(12,36,27,.20);
          --sh-l:0 18px 44px -16px rgba(12,36,27,.30);
          --e:cubic-bezier(.23,1,.32,1);
        }
        *{box-sizing:border-box}
        html,body,#__next{height:100%}
        body{
          margin:0;background:var(--bg);color:var(--ink);
          font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
          -webkit-font-smoothing:antialiased;
        }
        button{font-family:inherit}
      `}</style>

      <style jsx>{`
        .app{display:flex;flex-direction:column;height:100%}
        .bar{
          display:flex;align-items:center;gap:10px;
          padding:calc(12px + env(safe-area-inset-top)) 16px 12px;
          flex:none;
        }

        .burger{
          flex:none;border:0;background:var(--surface);color:var(--ink);cursor:pointer;
          width:36px;height:36px;border-radius:12px;display:grid;place-items:center;
          box-shadow:var(--sh-s);transition:transform 150ms var(--e);
        }
        .burger:active{transform:scale(.94)}
        .burger svg{width:17px;height:17px}

        /* The title takes whatever is left and truncates. Nothing in this row
           may push the row wider than the screen. */
        .where{
          flex:1;min-width:0;text-align:center;font-weight:700;font-size:15px;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 4px;
        }
        .spacer{flex:none;width:36px}

        /* An icon, not a word. It sits opposite the burger and reads as its
           pair, which leaves the whole middle of the bar for the trip's name —
           the one thing there worth reading. */
        .itbtn{
          position:relative;flex:none;display:grid;place-items:center;
          width:36px;height:36px;border:0;border-radius:12px;
          background:var(--deep);color:#EAF2EC;box-shadow:var(--sh-s);
          cursor:pointer;transition:transform 150ms var(--e);
        }
        .itbtn:active{transform:scale(.94)}
        .itbtn svg{width:17px;height:17px}
        .ping{
          position:absolute;top:-3px;right:-3px;width:10px;height:10px;border-radius:99px;
          background:var(--coral);border:2px solid var(--bg);
        }

        .split{flex:1;display:flex;min-height:0;gap:20px;padding:0 16px 0}

        .chat{flex:1;display:flex;flex-direction:column;min-height:0;min-width:0}
        .scroll{flex:1;overflow-y:auto;padding:6px 2px 10px;scroll-behavior:smooth}

        .intro{padding:26px 4px 10px;max-width:30ch}
        /* Over the trip, not instead of it. Anchored to the bottom because
           that is where a keyboard comes from on a phone. */
        .dock{
          position:absolute;left:10px;right:10px;bottom:10px;z-index:5;
          background:var(--surface);border-radius:20px;padding:12px 12px 11px;
          box-shadow:0 2px 6px rgba(12,36,27,.08), 0 18px 40px -20px rgba(12,36,27,.55);
        }
        .dock .dx{
          position:absolute;right:9px;top:7px;border:0;background:none;padding:2px 5px;
          font-size:17px;line-height:1;color:var(--ink-faint);cursor:pointer;
        }
        .dwhat{
          display:flex;align-items:baseline;gap:8px;margin:0 0 9px;padding-right:20px;
        }
        .dwhat b{
          font-family:'Outfit',sans-serif;font-size:14.5px;font-weight:700;
          line-height:1.25;flex:1;min-width:0;
        }
        .dwhat span{
          flex:none;font-size:11px;font-weight:750;letter-spacing:.04em;
          text-transform:uppercase;color:var(--coral-text,#AE4715);
          background:var(--sage);padding:3px 8px;border-radius:99px;
        }
        .drow{display:flex;gap:9px;align-items:flex-end}
        .drow textarea{
          flex:1;min-width:0;border:0;background:var(--sage);border-radius:14px;
          padding:10px 12px;font-size:15px;font-family:inherit;color:var(--ink);
          outline:0;resize:none;line-height:1.45;
        }
        .drow textarea:focus{box-shadow:0 0 0 2px var(--coral)}
        .drow button{
          flex:none;width:38px;height:38px;border:0;border-radius:50%;cursor:pointer;
          background:var(--deep);color:#EAF2EC;display:grid;place-items:center;
        }
        .drow button svg{width:17px;height:17px}
        .dsay{display:flex;align-items:center;gap:7px;font-size:13.5px;color:var(--ink-soft);padding-right:18px}
        .dsay span{flex:1;min-width:0;line-height:1.45}
        .dsay .dd{
          width:5px;height:5px;border-radius:50%;background:var(--ink-faint);flex:none;
          animation:dbl 1.2s var(--e,ease) infinite;
        }
        .dsay .dd:nth-child(2){animation-delay:.15s}
        .dsay .dd:nth-child(3){animation-delay:.3s}
        @keyframes dbl{0%,60%,100%{opacity:.25}30%{opacity:1}}
        @media (prefers-reduced-motion:reduce){ .dsay .dd{animation:none} }
        .dfull{
          flex:none;border:0;background:var(--sage);color:var(--deep);border-radius:99px;
          padding:6px 12px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;
        }

        .done .new{
          margin-left:8px;font-style:normal;font-size:10px;font-weight:800;
          letter-spacing:.06em;text-transform:uppercase;vertical-align:2px;
          background:var(--coral);color:#3A1405;padding:3px 7px;border-radius:99px;
        }
        /* Once it has been opened it is a record of what happened, not a
           notification, so it stops shouting. */
        .done:not(.fresh){opacity:.72}
        .how{display:flex;flex-direction:column;gap:12px;margin:2px 0 22px}
        .hrow{display:flex;flex-direction:column;gap:3px}
        .hrow .hn{
          font-size:11px;font-weight:750;letter-spacing:.07em;text-transform:uppercase;
          color:var(--coral-text,#AE4715);
        }
        .hrow span:last-child{font-size:14px;line-height:1.5;color:var(--ink-soft)}

        .intro h1{
          font-family:'Outfit',sans-serif;font-size:34px;line-height:1.08;
          font-weight:800;margin:0 0 12px;letter-spacing:-.01em;
        }
        .intro p{margin:0;color:var(--ink-soft);font-size:15px;line-height:1.55}
        .egs{display:flex;flex-direction:column;gap:9px;margin-top:22px}
        .eg{
          text-align:left;border:0;background:var(--surface);color:var(--ink-soft);
          padding:13px 16px;border-radius:18px;box-shadow:var(--sh-s);font-size:13.5px;
          line-height:1.45;cursor:pointer;transition:transform 160ms var(--e);
        }
        .eg:active{transform:scale(.98)}

        .msg{
          font-size:15px;line-height:1.55;margin:9px 0;
          animation:rise 260ms var(--e) both;
        }
        .msg p{margin:0}
        .msg p + p{margin-top:9px}

        /* The agent gets the page; only the traveller gets a bubble.
           (raffy, 2026-08-31: "agent is just taking the whole space just like
           this claude session.") Two speakers of equal weight in matching
           bubbles reads as a transcript. One voice on the page and the other
           in a bubble reads as someone talking to you — and it gives long
           replies, lists and prices the full column to breathe in. */
        .msg.assistant{max-width:60ch;padding:2px 2px 4px}

        .msg.user{
          max-width:min(80%,44ch);width:fit-content;margin-left:auto;
          padding:11px 15px;border-radius:20px;border-bottom-right-radius:8px;
          background:var(--deep);color:#EAF2EC;box-shadow:var(--sh-m);
        }
        @keyframes rise{from{opacity:0;transform:translateY(7px) scale(.985)}to{opacity:1;transform:none}}

        .typing{
          display:flex;gap:10px;align-items:center;width:fit-content;max-width:none;
          padding:10px 2px;
        }
        /* With a trail above it, the row of dots belongs under the list rather
           than beside it. */
        .typing:has(.trail){flex-wrap:wrap;width:100%}
        .typing .trail{
          list-style:none;margin:0 0 2px;padding:0;width:100%;
          display:flex;flex-direction:column;gap:5px;
        }
        /* An attribute rather than a class, because .done belongs to the To do
           list and every finished step was picking up its dark card. The
           background reset below is there for the same reason: this list sits
           inside a message row. */
        .typing .trail li{
          display:flex;align-items:flex-start;gap:8px;font-size:12.5px;line-height:1.35;
          color:var(--ink-faint);background:none;padding:0;border-radius:0;box-shadow:none;
          animation:steprise 260ms var(--e) both;
        }
        .typing .trail li[data-step="now"]{color:var(--ink-soft);font-weight:600}
        .typing .trail .tick{
          flex:none;width:14px;height:14px;margin-top:1px;
          display:grid;place-items:center;color:var(--coral-text);
        }
        .typing .trail .tick svg{width:12px;height:12px}
        /* The one still running gets a pulse rather than a tick, because it has
           not earned one yet. */
        .typing .trail .tick i{
          width:7px;height:7px;border-radius:99px;background:var(--coral);
          animation:pulse 1.1s ease-in-out infinite;
        }
        .typing .trail .tw{min-width:0}
        .typing .trail em{
          font-style:normal;color:var(--ink-faint);font-weight:500;
          display:block;
        }
        .typing .trail li[data-step="now"] em{color:var(--ink-faint);font-weight:500}
        @keyframes steprise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
        @keyframes pulse{0%,100%{opacity:.35;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
        .typing .dots{display:flex;gap:5px;align-items:center;flex:none}
        .typing .dots span{
          width:7px;height:7px;border-radius:99px;background:var(--ink-faint);opacity:.45;
          animation:bob 1.15s infinite;
        }
        .typing .dots span:nth-child(2){animation-delay:.14s}
        .typing .dots span:nth-child(3){animation-delay:.28s}
        .typing .says{
          font-size:13px;line-height:1.4;color:var(--ink-faint);
          animation:fadein 300ms var(--e) both;
        }
        @keyframes fadein{from{opacity:0}to{opacity:1}}
        @keyframes bob{0%,60%,100%{transform:none;opacity:.35}30%{transform:translateY(-4px);opacity:.85}}

        .working{
          display:flex;align-items:center;gap:11px;margin:12px 0;padding:14px 17px;
          background:var(--sage);border-radius:20px;font-size:13.5px;color:var(--ink-soft);
          line-height:1.45;
        }
        .spin{
          width:15px;height:15px;flex:none;border-radius:99px;
          border:2px solid rgba(12,36,27,.15);border-top-color:var(--coral);
          animation:spin .8s linear infinite;
        }
        @keyframes spin{to{transform:rotate(360deg)}}

        .sys{color:var(--ink-faint);font-size:14px;padding:20px 4px}
        .err{
          background:#FBE6DC;color:#8C3B14;padding:11px 15px;border-radius:16px;
          font-size:13.5px;margin:0 0 10px;cursor:pointer;
        }

        /* What the agent's messages are allowed to look like. A price gets
           weight because it is the thing people scan for; everything else
           stays quiet. */
        .msg :global(strong){font-weight:700}
        .msg :global(.cost){
          font-family:'Outfit',sans-serif;font-weight:700;font-size:14.5px;
          color:var(--coral-text,#AE4715);
        }
        .msg.user :global(.cost){color:#F4C4A8}
        .msg :global(a){color:inherit;text-decoration:underline;text-underline-offset:2px}
        .msg :global(a):hover{text-decoration-thickness:2px}

        .done{
          display:flex;flex-direction:column;gap:11px;align-items:flex-start;
          margin:10px 0;padding:15px 16px;max-width:min(92%,44ch);
          background:var(--deep);color:#E7EFE9;border-radius:20px;
          box-shadow:var(--sh-m);animation:rise 320ms var(--e) both;
        }
        .donetext{display:flex;flex-direction:column;gap:4px}
        .donetext b{font-size:15px;font-weight:700;font-family:'Outfit',sans-serif}
        .donetext span{font-size:12.5px;line-height:1.45;color:#B9CFC1}
        .done button{
          display:inline-flex;align-items:center;gap:8px;border:0;
          background:#EAF2EC;color:var(--deep);font-family:inherit;
          font-size:13.5px;font-weight:650;padding:10px 16px;border-radius:99px;
          cursor:pointer;transition:transform 150ms var(--e);
        }
        .done button:active{transform:scale(.96)}
        .done button svg{width:15px;height:15px}

        .hint{
          display:flex;align-items:flex-start;gap:9px;margin:0 2px 8px;
          background:var(--sage);border-radius:14px;padding:10px 11px;
          font-size:12.5px;line-height:1.45;color:var(--ink-soft);
          animation:rise 300ms var(--e) both;
        }
        .hint svg{width:14px;height:14px;flex:none;margin-top:2px;color:var(--deep)}
        .hint span{flex:1;min-width:0}
        .hint button{
          flex:none;border:0;background:none;color:var(--ink-faint);cursor:pointer;
          font-size:16px;line-height:1;padding:0 2px;opacity:.6;
        }
        .hint button:hover{opacity:1}

        .composer{flex:none;padding:8px 0 calc(12px + env(safe-area-inset-bottom))}
        .chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:9px}
        .chip{
          display:inline-flex;align-items:center;gap:7px;background:var(--sage);
          padding:7px 8px 7px 13px;border-radius:99px;font-size:12.5px;color:var(--ink-soft);
        }
        .chip button{border:0;background:none;font-size:16px;line-height:1;color:var(--ink-faint);cursor:pointer;padding:0 3px}
        .row{
          display:flex;align-items:center;gap:8px;background:var(--surface);
          border-radius:26px;padding:7px 7px 7px 6px;box-shadow:var(--sh-m);
        }

        /* Once the message wraps, the buttons drop to a row of their own and
           the text takes the full width. Threading a paragraph through a gap
           between two round buttons wastes the line and reads badly.
           (raffy, 2026-08-31: "the text move up and the icons stay down
           rather than it stays in line.") */
        .row.tall{
          display:grid;grid-template-columns:1fr auto;grid-template-areas:'text text' 'attach send';
          gap:4px 8px;border-radius:22px;padding:4px 7px 7px;
        }
        .row.tall textarea{grid-area:text;padding:9px 6px 2px}
        .row.tall .attach{grid-area:attach;justify-self:start}
        .row.tall .sendbtn{grid-area:send}
        /* Explicit flex centring, not place-items. The grid shorthand is the
           kind of thing that resolves fine in one engine and drifts by a
           pixel or two in another, and this is a 42px circle where a pixel
           shows. */
        .attach{
          width:42px;height:42px;flex:none;padding:0;cursor:pointer;
          display:flex;align-items:center;justify-content:center;
          color:var(--ink-faint);border-radius:99px;transition:background 160ms;
        }
        .attach:hover{background:var(--sage)}
        .attach input{display:none}
        .attach svg{width:19px;height:19px;display:block;flex:none}
        textarea{
          flex:1;min-width:0;border:0;outline:0;resize:none;background:none;
          font-size:16px;line-height:1.45;color:var(--ink);
          font-family:inherit;max-height:168px;overflow-y:auto;
          -webkit-appearance:none;appearance:none;
          /* Even padding, and the row centres it against the buttons with
             flex. Padding hand-matched to one line-height number only ever
             held on the machine it was measured on. */
          padding:11px 4px;
          /* Gone rather than thinned. "thin" is a suggestion the phone is
             free to ignore, and it was still a slab on his. Nothing here
             needs a visible track — it scrolls by touch. */
          scrollbar-width:none;
          -ms-overflow-style:none;
        }
        textarea::-webkit-scrollbar{display:none;width:0;height:0}
        textarea::placeholder{color:var(--ink-faint)}
        /* padding:0 and appearance:none here rather than on every button:
           an unstyled control keeps the browser's own padding until it is
           told not to, and border-box then takes that out of the 42px
           unevenly. Scoped to this button so nothing else inherits it. */
        .sendbtn{
          width:42px;height:42px;flex:none;border:0;padding:0;border-radius:99px;
          background:var(--coral);color:#fff;cursor:pointer;
          display:flex;align-items:center;justify-content:center;
          -webkit-appearance:none;appearance:none;
          transition:transform 160ms var(--e),opacity 160ms;
        }
        .sendbtn svg{width:19px;height:19px;display:block;flex:none}
        .sendbtn:disabled{opacity:.32;cursor:default}
        .sendbtn:not(:disabled):active{transform:scale(.92)}

        .pane{flex:1;min-width:0;display:flex;flex-direction:column;padding-bottom:16px}
        .panehead{
          display:flex;align-items:center;gap:10px;padding:4px 2px 12px;
          font-weight:700;font-size:14.5px;flex:none;
        }
        .panehead span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        /* Both header buttons are the same object: a round tap target with an
           icon in it, one on each end of the title. Matching them stops the
           header reading as a control and a shouty call to action. */
        .back, .dl{
          display:grid;place-items:center;flex:none;width:38px;height:38px;
          border:0;border-radius:50%;cursor:pointer;
          transition:transform 160ms var(--e), background 160ms;
        }
        .back{display:none;background:var(--sage);color:var(--deep)}
        .dl{background:var(--sage);color:var(--deep)}
        .back svg, .dl svg{width:19px;height:19px;display:block}
        .back:active, .dl:active{transform:scale(.92)}
        .dl:hover{background:var(--deep);color:#EAF2EC}
        .seg{
          display:flex;align-items:center;gap:6px;flex:none;
          background:var(--sage);border-radius:99px;padding:4px;margin-bottom:12px;
          align-self:flex-start;
        }
        .seg button{
          border:0;background:none;border-radius:99px;padding:8px 18px;
          font-size:13.5px;font-weight:600;color:var(--ink-soft);cursor:pointer;
          font-family:inherit;transition:background 160ms,color 160ms;
        }
        .seg button.on{background:var(--surface);color:var(--ink);box-shadow:var(--sh-s)}
        .seg .count{
          font-size:12px;color:var(--ink-faint);padding-right:12px;padding-left:2px;
        }
        .stale{
          display:flex;align-items:center;gap:10px;flex:none;
          background:#FBE6DC;color:#8C3B14;border-radius:16px;padding:11px 14px;
          font-size:13px;line-height:1.4;margin-bottom:12px;
        }
        .stale button{
          border:0;background:#8C3B14;color:#fff;border-radius:99px;
          padding:7px 13px;font-size:12.5px;font-weight:600;cursor:pointer;
          font-family:inherit;flex:none;
        }
        .editwrap{flex:1;min-height:0;overflow-y:auto;padding-right:2px}
        .phone{
          /* position:relative so the docked composer can sit over the trip
             rather than pushing it up. */
          position:relative;
          flex:1;min-height:0;border-radius:28px;overflow:hidden;background:var(--surface);
          box-shadow:var(--sh-l);
        }
        .phone iframe{width:100%;height:100%;border:0;display:block}
        .bbar{
          width:min(220px,60%);height:5px;border-radius:99px;background:var(--sage);
          overflow:hidden;margin-top:4px;
        }
        .bbar i{
          display:block;height:100%;border-radius:99px;background:var(--deep);
          transition:width 600ms var(--e);
        }
        .empty{
          height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;
          gap:16px;padding:32px;text-align:center;color:var(--ink-faint);
        }
        /* The photographs are being fetched and folded into the file; on a
           trip with a dozen of them that is a few seconds. */
        .dl.busy{opacity:.55;pointer-events:none}
        .dl.busy svg{animation:dlpulse 1.1s ease-in-out infinite}
        @keyframes dlpulse{0%,100%{opacity:.45}50%{opacity:1}}
        @media (prefers-reduced-motion:reduce){.dl.busy svg{animation:none}}
        .empty p{margin:0;font-size:14px;line-height:1.5;max-width:26ch}
        /* The reason, in the words the failure actually used. Small, and
           only ever on screen when something has genuinely broken. */
        .phwhy{
          font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
          font-size:11px;line-height:1.45;max-width:34ch;opacity:.75;
          word-break:break-word;
        }
        .ph{
          width:52px;height:52px;border-radius:18px;
          background:linear-gradient(160deg,var(--sage),#D5E2D2);
        }

        @media (max-width:860px){
          .split{padding:0 14px}
          .pane{
            position:fixed;inset:0;z-index:30;background:var(--bg);
            padding:calc(10px + env(safe-area-inset-top)) 14px calc(14px + env(safe-area-inset-bottom));
            transform:translateY(100%);transition:transform 320ms var(--e);
          }
          .pane.open{transform:none}
          .back{display:grid}
          .hidden-m{display:none}
          .done .new{
          margin-left:8px;font-style:normal;font-size:10px;font-weight:800;
          letter-spacing:.06em;text-transform:uppercase;vertical-align:2px;
          background:var(--coral);color:#3A1405;padding:3px 7px;border-radius:99px;
        }
        /* Once it has been opened it is a record of what happened, not a
           notification, so it stops shouting. */
        .done:not(.fresh){opacity:.72}
        .how{display:flex;flex-direction:column;gap:12px;margin:2px 0 22px}
        .hrow{display:flex;flex-direction:column;gap:3px}
        .hrow .hn{
          font-size:11px;font-weight:750;letter-spacing:.07em;text-transform:uppercase;
          color:var(--coral-text,#AE4715);
        }
        .hrow span:last-child{font-size:14px;line-height:1.5;color:var(--ink-soft)}

        .intro h1{font-size:30px}
        }
        @media (min-width:861px){
          .itbtn{display:none}
          .spacer{display:none}
          .split{max-width:1180px;margin:0 auto;width:100%}
          .chat{max-width:560px}
          .phone{max-width:430px;margin:0 auto;width:100%}
        }
        @media (prefers-reduced-motion:reduce){
          *{animation-duration:1ms !important;transition-duration:1ms !important}
        }
      `}</style>
    </div>
  );
}
