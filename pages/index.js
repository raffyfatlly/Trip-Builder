import { Credits } from '../components/Ring.js';
import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import { renderPreview } from '../lib/preview.js';
import Packs from '../components/Packs.js';
import Progress from '../components/Progress.js';
import Auth from '../components/Auth.js';
import { applyEdits, countStale, loadEdits, saveEdits, forRender } from '../lib/edits.js';

// Measuring has to happen before the browser paints, not after. useEffect runs
// after, which leaves one frame where the new character is rendered at the old
// height — the textarea scrolls itself to fit and the end of the line appears
// to vanish. useLayoutEffect does not exist on the server, so fall back there.
const useMeasure = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
import { loadTrips, rememberTrip, forgetTrip, loadMemory, saveMemory, adoptAccount, releaseAccount } from '../lib/trips.js';
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
  // Who else is in this trip, from /api/state. null when it is just them.
  // Declared up here with the other hooks rather than beside the code that
  // uses it: the poll reads setParty ~470 lines earlier, and a hook declared
  // below its first use is a trap even when useEffect happens to make it safe.
  const [party, setParty] = useState(null);
  // Whether the next message goes to the assistant rather than to the other
  // person. A real mode rather than something read back out of the draft: the
  // whole complaint was not knowing where a message was going before sending
  // it, and inferring the answer from text you are still editing is exactly
  // that uncertainty with extra steps.
  const [ask, setAsk] = useState(false);
  // Everyone in the trip except whoever is reading. The composer, the
  // placeholder and the header all need it, and computing it inline three
  // times is how two of them end up disagreeing.
  const others = useMemo(() => (party
    ? [party.owner, ...(party.guests || [])].filter((e) => e && e !== party.me)
    : []), [party]);
  // What the agent is doing, in its own words, and how long it has been at it.
  const [doing, setDoing] = useState(null);
  // A turn that died on the model's side. Silence is the worst thing the chat
  // can do, and until this it was the only thing it did.
  const [agentErr, setAgentErr] = useState(null);
  // The credit balance, polled with everything else. null when the deployment
  // has no store and nothing is metered — the app then behaves as it always did.
  const [purse, setPurse] = useState(null);
  // True while a message has been sent but the server's log does not show it
  // yet. Used to suppress the previous turn's steps — see the poll.
  const pendingSend = useRef(false);
  // And what it has already done this turn, so a long wait shows progress
  // rather than one line that might mean it is stuck.
  const [steps, setSteps] = useState([]);
  const [since, setSince] = useState(0);
  // Consecutive failed polls. A blank page after a refresh reads as "my trip
  // is gone" when the truth is "the server did not answer" — say which.
  const [stalled, setStalled] = useState(0);
  // A REFUSAL IS NOT A BLIP, and until now the poll could not tell them apart.
  //
  // raffy, 2026-09-07: "my last session give error again. can't access the
  // chat." /api/state answers 403 when the trip belongs to another account —
  // which happens after signing in and out on somebody else's phone, exactly
  // what he does. The poll threw, the catch counted it as a stall, and it
  // retried every couple of seconds forever. The one banner that mentions a
  // stall only renders while the agent is thinking, and on a trip that never
  // loaded it is not, so the screen said NOTHING. A permanent lockout that
  // looks identical to a slow connection.
  const [blocked, setBlocked] = useState(null);
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
  // Whether /api/state has answered even once.
  //
  // `booting` clears as soon as the SESSION id is known, which is well before
  // the transcript arrives — so gating on it alone showed the required sign-in
  // dialog over a traveller who was already mid-trip, for as long as the first
  // poll took. It flashed, and on a slow connection it would not have been a
  // flash. Caught by setup/test-authui.mjs, where the header button became
  // unclickable because the dialog was sitting on top of it.
  const [seenState, setSeenState] = useState(false);
  const [edits, setEdits] = useState([]);
  const [pane, setPane] = useState('preview');   // preview | edit
  const [staleNote, setStaleNote] = useState(0);
  const [progress, setProgress] = useState(null);
  const [capped, setCapped] = useState(false);
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
  // Which way the sign-in dialog opens. null means closed.
  // raffy, 2026-09-06: "proper sign-up and sign-in pop-ups and buttons".
  const [authMode, setAuthMode] = useState(null);
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
        // 403 (not yours) and 404 (gone) are answers, not failures. Retrying
        // them changes nothing and hides them; say so and stop.
        if (r.status === 403 || r.status === 404) {
          const why = await r.json().catch(() => ({}));
          if (!alive) return;
          setBlocked({ status: r.status, why: (why && why.error) || '' });
          log('error', { why: 'state ' + r.status + ' ' + ((why && why.error) || '') });
          return;                       // no reschedule: this will not recover
        }
        if (!r.ok) throw new Error('state ' + r.status);
        const d = await r.json();
        if (!alive) return;
        // Merged, not replaced.
        //
        // raffy, 2026-09-05: "everytime i replied, the bubble like a glitch, or
        // appear late." Sending drops an optimistic bubble in straight away, and
        // this line then overwrote the list with the server's transcript — which
        // does not contain that message until the send has been recorded. So
        // their own words appeared, vanished for a poll or two, and came back.
        //
        // An optimistic message is kept until the transcript actually has it.
        // Who is in this trip. Drives the name over the other person's
        // messages and whether the invite panel appears at all.
        setParty(d.party || null);

        if (d.transcript) {
          setMessages((prev) => {
            const waiting = prev.filter((m) => String(m.id || '').startsWith('tmp'));
            if (!waiting.length) { pendingSend.current = false; return d.transcript; }
            const flat = (t) => String(t || '').replace(/\s+/g, ' ').trim();
            const landed = new Set(
              d.transcript.filter((m) => m.role === 'user').map((m) => flat(m.text)));
            const keep = waiting.filter((m) => !landed.has(flat(m.text)));
            pendingSend.current = keep.length > 0;
            return keep.length ? [...d.transcript, ...keep] : d.transcript;
          });
        }
        setThinking(!!d.thinking);
        setBuilding(!!d.building);
        setProgress(d.progress || null);
        setCapped(!!d.buildCapped);
        setSeenState(true);
        setDoing(d.doing || null);
        setAgentErr(d.agentError || null);
        if (d.credits !== undefined) setPurse(d.credits);
        // Steps belong to a turn, and stepsNow() reads them from the last
        // user.message on the SERVER's log. Between sending and that message
        // being recorded there is a window where the server still has the
        // previous turn — so the old round's "Looked it up: budget hotels…"
        // hung around under the new question.
        //
        // raffy, 2026-09-05: "the note (what it search) from past message crept
        // for awhile after I ask new question."
        //
        // The optimistic bubble is the signal that the server has not caught up
        // yet. While one is waiting, show nothing rather than something stale.
        setSteps(pendingSend.current || !Array.isArray(d.steps) ? [] : d.steps);
        if (d.itinerary) setItinerary(d.itinerary);
        setAgentEdits(d.agentEdits || []);
        setPlan(d.plan || {});
        if ((d.memoryOps || []).length) foldMemory(d.memoryOps);
        setLoaded(true);
        setStalled(0);
        setBlocked(null);
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
  // Out of credit, and the deployment is actually metering. `purse` is null
  // when there is no store, and the app is then what it always was.
  // BACK FROM STRIPE. The success_url returns to /?paid=<pack>, so the first
  // thing somebody sees after paying is their own trip with the credits already
  // in it — not a receipt page they have to click out of.
  //
  // The balance is NOT read from the URL. The webhook is what grants credits,
  // and it can land a second or two after the browser does; the poll picks it
  // up. Trusting a query string here would mean a bookmarked ?paid=starter
  // showed a balance nobody bought.
  const [paid, setPaid] = useState('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search).get('paid');
    if (!q) return;
    setPaid(q);
    // Take it out of the URL so a refresh does not re-announce it.
    const u = new URL(window.location.href);
    u.searchParams.delete('paid');
    window.history.replaceState({}, '', u.toString());
    if (q !== 'cancelled') log('paid', { pack: q });
  }, []);

  const spent = !!(purse && purse.left <= 0);
  // ENOUGH TO TALK, NOT ENOUGH TO BUILD. The state between "fine" and "spent",
  // and the one the free tier lives in: four credits buys a conversation and a
  // build costs twenty-five.
  //
  // Worth its own panel because the alternative is letting somebody plan a whole
  // trip and then be refused at the last step. Chat keeps working — only the
  // build is out of reach — so this offers rather than blocks.
  // Building is the paid part. "new account with no paid credit cannot build at
  // all" — so this is true for anyone who has never bought, and for anyone who
  // has but is now short. Same rule the server enforces, said early.
  const mustBuy = !!(purse && !spent && purse.signedIn
    && (!purse.paid || (purse.buildCost && purse.left < purse.buildCost)));

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

    // Optimistic: the poll will replace this with the real transcript. The
    // stamp is kept so it can be taken back out again if the send is refused.
    const stamp = Date.now();
    const label = [pending.map((f) => '📎 ' + f.name).join('\n'), text]
      .filter(Boolean).join('\n');
    setMessages((m) => [...m, { role: 'user', text: label, id: 'tmp' + stamp }]);
    // The previous turn's trail goes now, not when the server catches up.
    pendingSend.current = true;
    setSteps([]);
    if (typeof override !== 'string') setDraft('');
    const files = pending;
    setPending([]);
    setThinking(true);
    // Back to talking to each other. Asking is a per-message act, not a room
    // you stay in — leaving it latched is how somebody's next aside gets sent
    // to the assistant by accident.
    setAsk(false);

    try {
      const r = await fetch('/api/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session, text, files, memory,
          // Said outright rather than inferred from the text: the button and
          // the typed @ are the same intent, and the server should not have to
          // reverse-engineer which one happened.
          // The mode, or a typed @. Both are the same intent said two ways,
          // and the server should not have to reverse-engineer which happened.
          asked: ask || /@/.test(text),
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
        // 402: out of credit. Not an error to apologise for — it is the
        // paywall, and it has its own panel below the composer. Take the
        // optimistic message back out, since it was never sent.
        if (r.status === 402 && d.paywall) {
          setPurse({ left: 0, granted: d.paywall.granted, used: d.paywall.used, signedIn: d.paywall.signedIn });
          setMessages((m) => m.filter((x) => x.id !== 'tmp' + stamp));
          if (typeof override !== 'string') setDraft(text);
          setThinking(false);
          return;
        }
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

  // The download is gone.
  //
  // raffy, 2026-09-07: "remove the download function and replace the button
  // with the install app function."
  //
  // It had become the wrong answer to its own question. Saving a one-off HTML
  // file meant baking every photograph and the map into it so the copy would
  // still work from disk — a lot of machinery, a long wait, and a trip frozen
  // at the moment it was saved. Installing does the same job better: the same
  // trip on the home screen, opening like an app, and still the live one, so an
  // edit made in the chat is there next time it opens.
  //
  // Gone with it: bakeAll(), /api/bake and /api/mapbake, which existed only to
  // make a file survive being detached from the server.


  // Sharing the trip, as a link.
  //
  // raffy, 2026-09-06: "i want to explore the idea of sharing their itenary to
  // people." A link rather than a file: a PDF is wrong the moment a hotel
  // changes, and a link is the only shape that can become group planning later.
  //
  // The share sheet is the phone's own, so it lands in WhatsApp in one tap,
  // which is where a Malaysian trip actually gets discussed. Desktop has no
  // share sheet, so there it copies.
  const [shareNote, setShareNote] = useState('');
  const [sharing, setSharing] = useState(false);
  const shareTrip = async () => {
    if (sharing) return;
    setSharing(true); setShareNote('');
    try {
      const r = await fetch('/api/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session }),
      });
      const d = await r.json();
      if (!r.ok || !d.path) { setShareNote(d.error || 'Could not make a link.'); setSharing(false); return; }
      const url = window.location.origin + d.path;
      const text = (title ? title + ' — ' : '') + 'here is the trip';
      if (navigator.share) {
        // A cancelled share sheet rejects, and that is not an error worth
        // showing: they changed their mind, they did not hit a problem.
        try { await navigator.share({ title: title || 'Trip', text, url }); }
        catch (e) { /* dismissed */ }
      } else {
        try { await navigator.clipboard.writeText(url); setShareNote('Link copied'); }
        catch (e) { setShareNote(url); }
      }
    } catch (e) {
      setShareNote('Could not reach the server.');
    }
    setSharing(false);
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
    // A different account on the same device takes its own list, not the last
    // person's. adoptAccount() clears the local one when the signer changed;
    // see lib/trips.js. The open session goes too — it belonged to them.
    const email = (d.user || {}).email || '';
    if (adoptAccount(email) === 'drop') {
      try { localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
      setMessages([]);
      setSession(null);
    }
    if (Array.isArray(d.trips)) mergeTrips(d.trips);
  };

  const onSignOut = async () => {
    try { await fetch('/api/auth/signout', { method: 'POST' }); } catch (e) { /* ignore */ }
    // Let go of the OPEN session, and of the trip list this account brought
    // with it.
    //
    // raffy, 2026-09-07: "I use her phone, log out, then sign in again suddenly
    // her session is saved on my account." Signing out left both of those in
    // localStorage, so the next person to sign in on the same phone opened the
    // previous person's conversation and their browser then claimed it. The
    // server refuses that claim now, but leaving somebody else's chat on screen
    // after they signed out is its own problem — it is their conversation.
    //
    // Their trips are not deleted; they are on their account and come back when
    // they sign in. What is cleared is only this browser's copy.
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem('itin.memory.v1');
    } catch (e) { /* a browser that refuses storage has nothing to clear */ }
    // The list and the note of who it belongs to go together. Clearing one
    // without the other is how the next signer inherits an orphaned list.
    releaseAccount();
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

  // The email gate. Defined HERE, below `ready`, not up with the other
  // flags: it reads `ready`, and a const read before its declaration is a
  // ReferenceError. The && chain short-circuits before reaching it whenever
  // there is a transcript, so every test with a conversation in it passed
  // and only a brand-new session — the one case the gate exists for — took
  // the whole page down with a client-side exception. Only on a deployment that HAS accounts, only while there is
  // nothing to lose, and never while the page is still finding out who they are
  // — booting with account.user still null would flash the dialog at somebody
  // who is already signed in.
  const mustSignIn = account.accounts && !account.user && !booting && seenState
    && messages.length === 0 && !ready && !building;
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

        <div className="hend">
          {/* Somewhere to sign in that is not folded into the bottom of a menu.
              Only when this deployment actually has accounts: a button that
              opens a dialog which then says accounts are not set up is worse
              than no button. */}
          {account.accounts && !account.user && (
            <button className="signin" onClick={() => setAuthMode('signin')}>Sign in</button>
          )}
          {account.accounts && account.user && (
            <button className="av" onClick={() => setMenu(true)}
              aria-label={'Signed in as ' + account.user.email} title={account.user.email}>
              {(account.user.email || '?')[0].toUpperCase()}
            </button>
          )}
          {ready ? (
            <button className="itbtn" onClick={openSheet} aria-label="Itinerary" title="Itinerary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" />
              </svg>
              {unseen && <i className="ping" />}
            </button>
          ) : <span className="spacer" />}
        </div>
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
                {/* The examples are for somebody who has not started. Once
                    they have, two suggested openings sitting under their own
                    first message read as if the app did not hear them. */}
                {messages.length === 0 && (
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
                )}
              </div>
            )}

            {/* SAY IT, RATHER THAN RETRYING FOREVER.
                A trip that belongs to another account, or one that no longer
                exists, is a permanent answer. Before this the poll retried it
                every two seconds and the screen stayed empty, which is what
                "can't access the chat" looked like from his side. */}
            {blocked && (
              <div className="blocked">
                <h3>{blocked.status === 404 ? 'This trip is not here' : 'This trip is on another account'}</h3>
                <p>{blocked.why || 'The server would not open this conversation.'}</p>
                <p className="sub">
                  {blocked.status === 404
                    ? 'The link may be from a session that was deleted.'
                    : 'Trips belong to the account that started them. If you have more than one — or you signed in on somebody else\'s phone — sign in as the account that made this trip.'}
                </p>
                <div className="row">
                  {blocked.status !== 404 && (
                    <button className="go" onClick={() => setAuthMode('signin')}>Sign in</button>
                  )}
                  <button className="alt" onClick={() => { window.location.href = '/'; }}>
                    Start a new trip
                  </button>
                </div>
                <code>{session}</code>
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
                <Block key={m.id} block={m} disabled={thinking || spent} where={tripName} onChoose={(t) => send(t)} />
              ) : (
                <div key={m.id}
                  className={'msg ' + m.role
                    + (m.who && party && m.who !== party.me ? ' theirs' : '')
                    + (m.aside ? ' aside' : '')}>
                  {m.role === 'assistant' ? (
                    <>
                      <Rich text={m.text} />
                      <Actions actions={m.actions} />
                    </>
                  ) : (
                    <>
                      {/* Whose message this is, but only when there is more
                          than one of them — a name over every message in a
                          conversation with yourself is noise. */}
                      {m.who && party && party.shared && m.who !== party.me && (
                        <span className="from">{m.who.split('@')[0]}</span>
                      )}
                      {m.text.split('\n').map((line, i) => <p key={i}>{line}</p>)}
                    </>
                  )}
                </div>
              )
            ))}

            {/* Found by using the app as a traveller would: a reply never came,
                the dots vanished, and the thread sat there forever. The event
                log had a session.error in it and nothing read that type. */}
            {!thinking && agentErr && (
              <div className="agenterr">
                <span className="ae">{agentErr.say}</span>
                {agentErr.retry && (
                  <button className="aeb" onClick={() => {
                    setAgentErr(null);
                    // Advancing is what runs the agent, so this picks the turn
                    // back up rather than making them retype what they said.
                    // resume, not just advance: a turn that died left the
                    // session idle with nothing pending, so advancing alone
                    // restarts nothing.
                    fetch('/api/advance?resume=1&session=' + encodeURIComponent(session),
                      { method: 'POST' }).catch(() => {});
                  }}>
                    Try that again
                  </button>
                )}
              </div>
            )}

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
                          {/* A research step's detail is its questions, one per
                              line. Rendered as separate elements rather than
                              one string with newlines in it, because five
                              questions run together into a paragraph and the
                              whole point is that you can read them as a list of
                              things being looked up for you. */}
                          {s.detail
                            ? s.detail.split('\n').filter(Boolean).map((d, di) => <em key={di}>{d}</em>)
                            : null}
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
            {/* The stages go in the CHAT, not only in the trip pane.
                On a phone the trip pane is a separate view, so a traveller
                waiting out a four-minute build saw one spinning line and
                nothing else — which is the blind waiting raffy asked to end
                (2026-09-06). Caught by screenshotting the build at 390px.
                A button through to the half-written trip, because by now
                there is usually something in it worth looking at. */}
            {building && (
              <div className="buildwrap">
                <Progress itinerary={working} progress={progress} />
                {preview && (
                  <button className="peek" onClick={openSheet}>
                    Look at it so far
                  </button>
                )}
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
            {/* The paywall.
                raffy, 2026-09-05: "if they move beyond they can't use chat or
                rebuild anymore except just edit their iteniry manually."

                It replaces the composer rather than sitting above a dead one.
                A text box you can type into and cannot send from is the worst
                version of this — it lets somebody write a paragraph before
                telling them. And the sentence that matters most is the second
                one: their trip is not taken away, and they can still work on
                it. */}
            {/* Back from checkout. Deliberately not a modal: they were in the
                middle of planning a holiday and a dialog would be one more
                thing to dismiss. It disappears on its own once the credits
                arrive, because by then it has said everything it can. */}
            {paid && (
              <div className={'paid' + (paid === 'cancelled' ? ' off' : '') + (paid.startsWith('error:') ? ' bad' : '')}>
                {paid === 'cancelled'
                  ? <span>No payment taken. Your trip is exactly where you left it.</span>
                  : paid.startsWith('error:')
                    ? <span>{paid.slice(6)}</span>
                    : <span>{purse && purse.left > 0
                        ? 'Paid — ' + purse.left.toLocaleString('en') + ' credits are in. Carry on.'
                        : 'Paid. Your credits are landing now…'}</span>}
                <button onClick={() => setPaid('')} aria-label="Dismiss">×</button>
              </div>
            )}
            {/* Enough to talk, not enough to build. Offered before they ask,
                because being refused at the end of planning a holiday is a
                worse moment than being told at the start. */}
            {mustBuy && !paid && (
              <div className="wall low">
                <b>{purse.paid ? 'Not quite enough to build it' : 'Building your trip is the paid part'}</b>
                <p>
                  {purse.paid
                    ? 'You have ' + purse.left.toLocaleString('en') + ' credits and building takes about '
                      + purse.buildCost + '. Carry on chatting — everything you decide is saved.'
                    : 'Keep planning as long as you like — the chat, the research, the recommendations are'
                      + ' yours. Turning it into an app you can carry is what a pack buys.'}
                </p>
                <Packs onError={(m) => setPaid('error:' + m)} />
              </div>
            )}
            {spent ? (
              <div className="wall">
                {/* A paying customer who runs out has not used up "free
                    credit" — they used up credit they bought, and calling it
                    free reads as a slight. */}
                <b>{!purse.signedIn ? 'Free trial used up'
                  : purse.paid ? "You're out of credits" : "That's your free credit used up"}</b>
                <p>
                  {ready
                    ? 'Your itinerary is yours — open it any time, and you can still edit it by hand: move things, rewrite them, tick off the to-do list. Everything saves.'
                    : 'Anything you have already planned is still here.'}
                </p>
                <p className="wsub">
                  {purse.signedIn
                    ? 'What stops is the chat and rebuilding. Top up below and you pick up exactly where you left off.'
                    : 'Sign in with your email first — credits belong to an account, so there has to be one to put them in.'}
                </p>
                {!purse.signedIn ? (
                  <button className="wbtn" onClick={() => setMenu(true)}>Sign in</button>
                ) : (
                  /* The packs, right here rather than behind another tap. They
                     have already hit the wall; making them navigate to a
                     pricing page to get past it is one step too many. */
                  <Packs onError={(m) => setPaid('error:' + m)} />
                )}
                <div className="wring"><Credits credits={purse} size={104} /></div>
              </div>
            ) : (
            <>
            {/* Shown only once it starts to matter. A balance in somebody's
                face from the first message reads as a meter running, which is
                exactly the feeling this should not create while they are still
                deciding whether they like it. */}
            {purse && purse.left > 0 && purse.used / (purse.granted || 1) > 0.6 && (
              <button className="fuel" onClick={() => setMenu(true)}
                title="See what's left" aria-label="See what's left">
                <i><b style={{ width: Math.max(3, Math.round(100 * purse.left / (purse.granted || 1))) + '%' }} /></i>
                <span>{purse.left.toLocaleString('en')} credits left</span>
              </button>
            )}
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
            {/* WHERE THIS MESSAGE IS GOING. ONE control you tap, not two tabs.
                raffy, 2026-09-07: "I don't like the current two tab design for
                choosing. i want click toggle style."
                Two tabs took the full composer width and gave a permanent seat
                to the option you are not using. This says the current
                destination and flips on tap — smaller, and it reads as a state
                rather than a pair of choices. The label and icon swap
                instantly: this gets tapped constantly, and a crossfade on a
                control used that often is in the way. Only the colour moves.
                Only in a shared trip; alone there is one possible destination
                and a control saying so is noise. */}
            {party && party.shared && (
              <button type="button"
                className={'dest' + (ask ? ' asking' : '')}
                aria-pressed={ask}
                aria-label={ask ? 'Asking the assistant. Tap to message '
                  + (others.length === 1 ? others[0].split('@')[0] : 'everyone')
                  : 'Messaging ' + (others.length === 1 ? others[0].split('@')[0] : 'everyone')
                    + '. Tap to ask the assistant'}
                onClick={() => { setAsk((v) => !v); if (inputRef.current) inputRef.current.focus(); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {ask
                    ? <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
                    : <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" />
                      <path d="M16 6.5a3 3 0 0 1 0 5.4M17.5 20a6 6 0 0 0-2.2-4.6" /></>}
                </svg>
                <span>{ask ? 'Assistant'
                  : (others.length === 1 ? others[0].split('@')[0] : 'Everyone')}</span>
                <i aria-hidden="true">tap to switch</i>
              </button>
            )}
            <div className={'row' + (tall ? ' tall' : '') + (ask ? ' asking' : '')}>
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
                placeholder={party && party.shared
                  ? (ask ? 'Ask about the trip\u2026'
                    : 'Message ' + (others.length === 1 ? others[0].split('@')[0] : 'everyone') + '\u2026')
                  : (messages.length ? 'Reply, or attach a booking' : 'Tell me about your trip')}
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
            </>
            )}
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
            {/* Was the download. A phone, because what it does now is put the
                trip ON one — the served page carries the manifest and the
                worker, which a saved file never could. */}
            {ready && session && (
              <a className="dl" href={'/t/' + encodeURIComponent(session)}
                target="_blank" rel="noopener noreferrer"
                aria-label="Put this trip on your home screen"
                title="Put this trip on your home screen">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round">
                  <rect x="6" y="2" width="12" height="20" rx="3" /><path d="M11 18h2" />
                </svg>
              </a>
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

          {/* A build that ran out of steps used to be indistinguishable from a
              finished one — done, no error, possibly thin. Now it says so, and
              asking for the gaps is an EDIT, which is instant and nearly free,
              rather than another full rebuild. */}
          {capped && ready && !building && (
            <div className="stale">
              This one ran to its limit while it was writing, so a day or two may be
              thinner than the rest. Have a look, and tell me what to fill in.
              <button onClick={() => { setSheet(false); send('Some of this looks thin — check it over and fill in whatever is missing.'); }}>
                Ask it to check
              </button>
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
                ? (
                  <>
                    {/* raffy, 2026-09-06: "Enable users to click into the app
                        interface even while it is still being generated."
                        The preview already drew as soon as there were days —
                        what was missing was any sign that more was still
                        coming, so a half-built trip looked like a finished
                        bad one. */}
                    {building && (
                      <Progress itinerary={working} progress={progress} compact />
                    )}
                    <iframe title="Itinerary preview" srcDoc={preview} />
                  </>
                )
                : (
                  <div className="empty">
                    <div className="ph" />
                    {/* Four different situations used to say the same
                        sentence, which is why "it just says your itinerary
                        will appear here, even after I ask it to rebuild" was
                        impossible to act on. Each one now says which. */}
                    <p>{building
                      ? 'Your trip appears here as it is written — the first days show up before the rest is done.'
                      : previewErr
                        ? 'Your trip is safe, but this preview would not draw. Reload the page — that is usually enough. If it says this again, tell me.'
                        : working && !(working.days || []).length
                          ? 'The build came back without any days in it. Ask for it again and it will start over.'
                          : 'Your itinerary will appear here once there is enough to build.'}</p>
                    {previewErr && !building && (
                      <p className="phwhy">{previewErr}</p>
                    )}
                    {/* Named stages, ticked off the half-written itinerary, so
                        the wait says what has actually landed rather than "7 of
                        14". The bar is still under them — it moves when the
                        BUILDER moves, never on a timer. */}
                    {building && (
                      <Progress itinerary={working} progress={progress} />
                    )}
                  </div>
                )}
            </div>
          )}
        </section>
      </main>

      {/* raffy, 2026-09-06: "actually just make sure they have email to start
          using". So on a deployment with accounts, an email is the door — but
          only BEFORE a trip exists. Someone already mid-conversation, or with
          an itinerary already built, is never locked out of work they have
          done and paid for; that would be taking something away, not asking
          for something. */}
      <Auth
        open={!!authMode || mustSignIn}
        mode={mustSignIn && !authMode ? 'signup' : authMode}
        required={mustSignIn}
        trips={trips}
        onClose={() => setAuthMode(null)}
        onSignedIn={(d) => { onSignedIn(d); setMenu(false); }}
      />

      <Drawer
        open={menu}
        onClose={() => { setMenu(false); setSignInNow(false); }}
        trips={trips}
        session={session}
        onOpenTrip={openTrip}
        onDrop={dropTrip}
        onNew={startOver}
        onShare={shareTrip}
        shareNote={shareNote}
        sharing={sharing}
        hasTrip={ready}
        memory={memory}
        onEditSlot={editSlotByHand}
        onForgetSlot={forgetSlot}
        onForgetAll={forgetAll}
        nudge={nudge}
        onNudgeSave={() => { nudgeLater(); setMenu(true); setSignInNow(true); }}
        signInNow={signInNow}
        onNudgeLater={nudgeLater}
        credits={purse}
        accounts={account.accounts}
        user={account.user}
        onSignedIn={onSignedIn}
        onOpenAuth={(m) => { setMenu(false); setAuthMode(m); }}
        onSignOut={onSignOut}
      />

      <style jsx global>{`
        :root{
          /* raffy, 2026-09-07: "can you make the background of the chat
             lighter? instead of the green color."

             --bg was #EDF2EA, a distinctly green page. It is now nearly
             neutral and much lighter. The catch was that --bg did two jobs:
             the page behind everything, AND the recessed panels INSIDE white
             cards — the sign-in tabs, the profile fields, the account row.
             Lightening one role to near-white erases the other, so they are
             separate variables now. --well is what --bg used to be. */
          --bg:#F5F7F4; --well:#EAEFE8; --surface:#FFFFFF; --sage:#E4EBE1; --deep:#10362A;
          --ink:#0C241B; --ink-soft:#4C6157; --ink-faint:#5A6C63;
          --coral:#EE7B45; --line:rgba(12,36,27,.10);
          --sh-s:0 1px 2px rgba(12,36,27,.05),0 3px 12px rgba(12,36,27,.07);
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
        /* The right-hand end of the bar. Both of these are optional, so it is
           a row rather than a fixed slot — with neither, the spacer keeps the
           trip name centred exactly as it did before. */
        .hend{display:flex;align-items:center;gap:8px;flex:none}
        /* A refusal, said plainly. Deliberately not styled as a toast or a
           banner — it is the whole answer for this screen, not a note beside
           one, and the screen is otherwise empty. */
        .blocked{
          margin:18px 2px;padding:18px;border-radius:16px;
          background:var(--card,#fff);border:1px solid rgba(20,50,40,.10);
        }
        .blocked h3{margin:0 0 6px;font-size:17px;letter-spacing:-.01em}
        .blocked p{margin:0 0 8px;font-size:14px;line-height:1.5}
        .blocked .sub{color:rgba(20,50,40,.62)}
        .blocked .row{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 10px}
        .blocked .go,.blocked .alt{
          border:0;border-radius:999px;padding:10px 16px;font:inherit;
          font-weight:600;font-size:14px;cursor:pointer;
        }
        .blocked .go{background:var(--ink,#12352b);color:#fff}
        .blocked .alt{background:rgba(20,50,40,.07);color:var(--ink,#12352b)}
        /* The session id, so a screenshot of this screen is enough to debug it.
           Every previous report of this arrived without one. */
        .blocked code{
          display:block;font-size:11px;color:rgba(20,50,40,.45);
          word-break:break-all;
        }
        .signin{
          flex:none;border:1.5px solid var(--line);border-radius:99px;
          padding:7px 13px;background:var(--surface);color:var(--deep);
          font-family:inherit;font-size:12.5px;font-weight:750;cursor:pointer;
          transition:background 150ms ease,border-color 150ms ease;
          white-space:nowrap;
        }
        .signin:active{background:var(--sage)}
        .av{
          flex:none;width:32px;height:32px;border:0;border-radius:50%;
          background:var(--deep);color:#EAF2EC;cursor:pointer;
          font-family:inherit;font-size:13px;font-weight:800;line-height:1;
          display:grid;place-items:center;
        }
        .av:active{transform:scale(.94)}
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

        /* The destination line. Reads as a label, not a toolbar: the point is
           that you can SEE where the next message goes without decoding an
           icon. */
        /* The destination pill. Auto width, so it takes only the room its
           label needs — the two-tab version reserved half the composer for the
           option you were not using. */
        .dest{
          display:inline-flex;align-items:center;gap:6px;
          margin:0 0 8px;padding:5px 11px 5px 9px;
          border:0;border-radius:99px;cursor:pointer;
          background:var(--well);color:var(--ink-soft);
          font-family:inherit;font-size:12px;font-weight:700;line-height:1.3;
          /* Colour and press only. This is tapped constantly and anything more
             would be in the way; colour is also what reduced-motion keeps. */
          transition:background 160ms ease,color 160ms ease,transform 140ms cubic-bezier(.23,1,.32,1);
        }
        .dest svg{width:14px;height:14px;flex:none;opacity:.75}
        /* "tap to switch", set apart by a dot rather than sitting flush
           against the label — two text runs of different weight touching read
           as one broken word. */
        .dest i{
          font-style:normal;font-weight:600;font-size:10.5px;
          color:var(--ink-faint);
        }
        .dest i::before{content:'·';margin:0 5px 0 3px;opacity:.55}
        .dest.asking{background:var(--deep);color:#EAF2EC}
        .dest.asking svg{opacity:.9}
        .dest.asking i{color:#93AEA2}
        .dest:active{transform:scale(.97)}

        /* Asking used to draw a hard dark ring INSIDE the box and then the
           coral focus ring OUTSIDE it — two outlines fighting, which is the
           "not clean like others" raffy photographed. Nothing else in this app
           has two rings.
           The pill above already went dark green and the placeholder already
           says "Ask about the trip" — the box does not need to shout it a third
           time. A tinted background was tried and dropped: at the distance from
           sage that still looked like the same family it was indistinguishable,
           so it was decoration pretending to be a signal.
           So the input is now IDENTICAL in both modes, which is what "clean
           like the others" means — the same shape, the same one focus ring as
           every other field in the app. */
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

        /* The other person's messages, in a shared trip.
           raffy, 2026-09-07: two people in one chat. Theirs sit on the LEFT in
           a pale bubble — the traveller's own dark bubble on the right stays
           exactly as it was, so a solo trip looks untouched and a shared one
           reads as a conversation at a glance rather than needing the name to
           be read. */
        .msg.user.theirs{
          margin-left:0;margin-right:auto;
          background:var(--sage);color:var(--ink);
          border-radius:20px;border-bottom-right-radius:20px;border-bottom-left-radius:8px;
          box-shadow:var(--sh-s);
        }
        .from{
          display:block;font-size:11px;font-weight:750;letter-spacing:.02em;
          color:var(--ink-faint);margin-bottom:3px;text-transform:capitalize;
        }
        /* Said to each other, not to the agent. Quieter, and a hair narrower —
           it is beside the conversation rather than in it. */
        .msg.user.aside{opacity:.9}
        .msg.user.aside .from{color:var(--ink-faint)}

        .msg.user{
          max-width:min(80%,44ch);width:fit-content;margin-left:auto;
          padding:11px 15px;border-radius:20px;border-bottom-right-radius:8px;
          background:var(--deep);color:#EAF2EC;box-shadow:var(--sh-m);
        }
        @keyframes rise{from{opacity:0;transform:translateY(7px) scale(.985)}to{opacity:1;transform:none}}

        .agenterr{
          margin:10px 0;padding:13px 15px;border-radius:18px;
          background:var(--sage);color:var(--ink-soft);font-size:13.5px;line-height:1.5;
          display:flex;flex-direction:column;align-items:flex-start;gap:9px;
          animation:rise 300ms var(--e) both;
        }
        .agenterr .aeb{
          font-size:12.5px;font-weight:700;color:var(--deep);
          background:var(--surface);border-radius:99px;padding:8px 14px;
          box-shadow:var(--sh-s);cursor:pointer;
        }
        .agenterr .aeb:active{transform:scale(.96)}

        /* The credit meter. Deliberately small, low-contrast and late: it only
           appears past 60% spent. A balance visible from the first message
           reads as a taxi meter, which is the wrong feeling while somebody is
           still deciding whether they like the thing. */
        .fuel{
          display:flex;align-items:center;gap:9px;
          padding:0 4px 8px;font-size:11.5px;color:var(--ink-faint);
          animation:rise 300ms var(--e) both;
        }
        /* A track and a fill, not a bare bar. A bar sized by percentage inside
           a flex row is capped by its max-width long before the percentage
           starts meaning anything — at 24% left it looked identical to full,
           which is worse than showing nothing. */
        .fuel i{
          display:block;flex:none;width:88px;height:3px;border-radius:99px;
          /* A translucent colour, not opacity: opacity on the track applies to
             the fill inside it too, which made the fill invisible and the
             meter useless in exactly the way the max-width bug did. */
          background:rgba(16,54,42,.15);overflow:hidden;
        }
        .fuel i b{
          display:block;height:100%;border-radius:99px;background:var(--deep);
          transition:width 500ms var(--e);
        }
        .fuel span{white-space:nowrap}
        .fuel{background:none;border:0;cursor:pointer;width:100%}
        .fuel:active{opacity:.6}
        .wall .wring{margin-top:14px}

        /* The paywall replaces the composer. It is not an error state and does
           not look like one — the trip is still theirs and the first line they
           read should not be a refusal. */
        /* Back from checkout. A strip, not a modal — they were mid-holiday and
           a dialog is one more thing to dismiss. */
        .paid{
          display:flex;align-items:center;gap:10px;
          margin:2px 0 8px;padding:11px 12px 11px 15px;border-radius:14px;
          background:var(--deep);color:#fff;font-size:13px;line-height:1.45;
          box-shadow:var(--sh-s);animation:rise 320ms var(--e) both;
        }
        .paid span{flex:1;min-width:0}
        .paid button{
          flex:none;width:26px;height:26px;border:0;border-radius:99px;
          background:rgba(255,255,255,.16);color:#fff;font-size:15px;line-height:1;
          cursor:pointer;
        }
        /* Cancelled is not a failure and should not look like one. */
        .paid.off{background:var(--sage);color:var(--ink-soft)}
        .paid.off button{background:rgba(20,50,40,.10);color:var(--ink-soft)}
        .paid.bad{background:#8C2F1F}

        .wall{
          margin:2px 0 6px;padding:18px 18px 16px;border-radius:22px;
          background:var(--sage);box-shadow:var(--sh-s);
          animation:rise 320ms var(--e) both;
        }
        /* The low-balance variant is an offer, not a stop. Lighter ground and
           no shadow, so it sits beside the conversation rather than replacing
           it the way the spent-out wall does. */
        .wall.low{background:var(--surface);border:1px solid rgba(20,50,40,.10);box-shadow:none}
        .wall b{
          display:block;font-size:15.5px;font-weight:700;color:var(--deep);
          letter-spacing:-.01em;margin-bottom:7px;
        }
        .wall p{
          margin:0 0 8px;font-size:13.5px;line-height:1.55;color:var(--ink-soft);
        }
        .wall .wsub{color:var(--ink-faint);font-size:12.5px;margin-bottom:0}
        .wall .wbtn{
          margin-top:12px;font-size:13.5px;font-weight:700;color:var(--surface);
          background:var(--deep);border-radius:99px;padding:10px 20px;
          box-shadow:var(--sh-s);cursor:pointer;
        }
        .wall .wbtn:active{transform:scale(.97)}
        .wall .wmeter{
          display:block;margin-top:12px;font-size:11px;color:var(--ink-faint);
          letter-spacing:.02em;
        }

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
        /* A question after the first is a sibling line under the same step, so
           it lines up with the one above rather than restating the tick. */
        .typing .trail em + em{margin-top:2px}
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
          /* A column, so the build-progress strip can sit above the trip while
             it is still being written without pushing the frame off the pane. */
          display:flex;flex-direction:column;
        }
        .phone iframe{width:100%;flex:1 1 auto;min-height:0;border:0;display:block}
        .bbar{
          width:min(220px,60%);height:5px;border-radius:99px;background:var(--sage);
          overflow:hidden;margin-top:4px;
        }
        .bbar i{
          display:block;height:100%;border-radius:99px;background:var(--deep);
          transition:width 600ms var(--e);
        }
        .buildwrap{display:flex;flex-direction:column;align-items:flex-start;gap:9px;
          margin:10px 0 4px}
        .peek{
          border:0;border-radius:99px;padding:9px 15px;font-size:13px;font-weight:650;
          background:var(--sage);color:var(--deep);cursor:pointer;font-family:inherit;
        }
        .empty{
          flex:1 1 auto;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
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
