import { useState } from 'react';
import Rich from './Rich.js';

// The actual landing page — its own screen, no chat chrome.
//
// raffy, 2026-09-16, correcting the first version of this feature: "no place
// it wrong. u placed it inside the chat session. i actually want it on the
// landing page. here [a screenshot: a search-style input, a full-width CTA,
// three quick chips below it]. instead of plan a trip change to ask about
// upcoming trip or whatever suitable for this and for landing page
// aesthetic. then after that it answers with tools it have and said
// something relevant to entice them to do more so by clicking the plan a
// trip. don't put the one free question thing etc."
//
// So: one box, two states. Type something and it answers — real numbers,
// via lib/hook.js, the same tools the main chat uses for facts — then the
// button underneath switches to "Plan a trip", which hands that same text to
// the real conversation. No "free question" framing anywhere; asking again
// is just asking again. A quiet server-side cap (pages/api/hook.js) still
// exists so this can't be turned into a free API, but nothing about it is
// shown here — hitting it just folds gracefully into the next answer rather
// than throwing an error at somebody who was enjoying the product.

const CHIPS = [
  {
    label: 'Beach',
    q: "Where's a good beach destination for a relaxing week right now?",
    icon: <path d="M3 21c3-2 6-2 9 0s6 2 9 0M4 15c4-8 12-8 16 0M12 3v6" />,
  },
  {
    label: 'Road trip',
    q: 'What’s a great road trip route for a long weekend?',
    icon: <><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M8 19h5a3 3 0 0 0 3-3v-2a3 3 0 0 1 3-3h-3" /></>,
  },
  {
    label: 'City break',
    q: 'Which city is great for a short city break right now?',
    icon: <path d="M4 21V9l6-4 6 4v12M4 21h16M10 21v-5h4v5M9 12h1M14 12h1M9 9h1M14 9h1" />,
  },
];

export default function Landing({ onAsk, onPlan, onGuided }) {
  const [q, setQ] = useState('');
  // idle -> loading -> answered
  const [phase, setPhase] = useState('idle');
  const [answer, setAnswer] = useState('');

  const ask = async (text) => {
    const question = (typeof text === 'string' ? text : q).trim();
    if (!question || phase === 'loading') return;
    setQ(question);
    setPhase('loading');
    try {
      const said = await onAsk(question);
      setAnswer(said);
      setPhase('answered');
    } catch (e) {
      // A miss here still gets them somewhere useful — straight into the
      // real conversation, which can answer the same question itself.
      onPlan(question);
    }
  };

  return (
    <div className="land">
      <div className="landtop">
        <h1>Where are you going?</h1>
        <p>Ask like you would in a travel group — real numbers, real places, no
          sign-up. Then keep going and I'll build the whole trip with you.</p>
      </div>

      <div className="card">
        {phase !== 'answered' ? (
          <>
            <div className="searchrow">
              <svg className="sicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input
                className="searchin"
                value={q}
                placeholder="Ask about your upcoming trip…"
                disabled={phase === 'loading'}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
                autoFocus
              />
            </div>
            <button className="go" onClick={() => ask()} disabled={phase === 'loading' || !q.trim()}>
              {phase === 'loading' ? <i className="dots"><i /><i /><i /></i> : 'Ask about your trip'}
            </button>
          </>
        ) : (
          <div className="ans">
            <div className="ansbody"><Rich text={answer} /></div>
            <button className="go plan" onClick={() => onPlan(q)}>
              Plan a trip
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
            <button className="askmore" onClick={() => { setQ(''); setAnswer(''); setPhase('idle'); }}>
              Ask something else
            </button>
          </div>
        )}
      </div>

      {phase !== 'answered' && (
        <div className="chips">
          {CHIPS.map((c) => (
            <button key={c.label} className="chip" onClick={() => ask(c.q)} disabled={phase === 'loading'}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {c.icon}
              </svg>
              {c.label}
            </button>
          ))}
        </div>
      )}

      <button className="guided" onClick={onGuided}>
        Prefer a few quick questions instead?
      </button>

      <style jsx global>{`
        /* Duplicated from the main app's root block rather than shared,
           because this screen and that one are different return paths off
           the same component — this one can render before the other has
           ever mounted, so it cannot depend on the other having set these. */
        :root{
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
        .land{
          min-height:100%;display:flex;flex-direction:column;align-items:center;
          justify-content:center;padding:32px 20px calc(28px + env(safe-area-inset-bottom));
          background:radial-gradient(120% 100% at 50% 0%, #FAFBF9 0%, var(--bg) 60%);
        }
        .landtop{max-width:34ch;text-align:center;margin-bottom:26px}
        h1{
          font-family:'Outfit',sans-serif;font-size:34px;line-height:1.08;font-weight:800;
          letter-spacing:-.01em;margin:0 0 10px;color:var(--ink);
        }
        .landtop p{margin:0;color:var(--ink-soft);font-size:14.5px;line-height:1.55}

        .card{
          width:100%;max-width:420px;background:var(--surface);border-radius:24px;
          padding:16px;box-shadow:var(--sh-m);
        }
        .searchrow{
          display:flex;align-items:center;gap:10px;background:var(--well);
          border-radius:16px;padding:14px 16px;margin-bottom:12px;
        }
        .sicon{width:19px;height:19px;flex:none;color:var(--ink-faint)}
        .searchin{
          flex:1;min-width:0;border:0;background:none;font-size:16px;
          font-family:inherit;color:var(--ink);outline:none;
        }
        .searchin::placeholder{color:var(--ink-faint)}
        .searchin:disabled{opacity:.6}

        .go{
          width:100%;border:0;background:var(--coral);color:#fff;font-weight:700;
          font-size:15.5px;padding:16px;border-radius:16px;cursor:pointer;
          box-shadow:0 10px 24px -10px rgba(238,123,69,.55);
          transition:transform 160ms var(--e);
        }
        .go:active:not(:disabled){transform:scale(.98)}
        .go:disabled{opacity:.45;cursor:default;box-shadow:none}
        .go.plan{
          display:inline-flex;align-items:center;justify-content:center;gap:8px;
        }
        .go.plan svg{width:17px;height:17px}
        .dots{display:inline-flex;gap:4px;align-items:center;justify-content:center}
        .dots i{width:5px;height:5px;border-radius:99px;background:#fff;animation:pulse 1.1s var(--e) infinite}
        .dots i:nth-child(2){animation-delay:.15s}
        .dots i:nth-child(3){animation-delay:.3s}
        @keyframes pulse{0%,60%,100%{opacity:.35;transform:translateY(0)}30%{opacity:1;transform:translateY(-2px)}}

        .ans{display:flex;flex-direction:column;gap:14px}
        .ansbody{font-size:14.5px;line-height:1.55;color:var(--ink);padding:2px 4px}
        .askmore{
          border:0;background:none;color:var(--ink-faint);font-size:12.5px;font-weight:650;
          cursor:pointer;padding:2px;align-self:center;
        }
        .askmore:hover{color:var(--ink-soft)}

        .chips{
          display:flex;gap:8px;margin-top:16px;width:100%;max-width:420px;
          justify-content:center;flex-wrap:wrap;
        }
        .chip{
          display:inline-flex;align-items:center;gap:7px;border:0;background:var(--surface);
          color:var(--ink-soft);font-size:13px;font-weight:650;padding:10px 14px;
          border-radius:99px;cursor:pointer;box-shadow:var(--sh-s);
        }
        .chip svg{width:15px;height:15px;color:var(--coral)}
        .chip:disabled{opacity:.5;cursor:default}

        .guided{
          border:0;background:none;color:var(--ink-faint);font-size:12.5px;font-weight:600;
          margin-top:22px;cursor:pointer;padding:4px;text-decoration:underline;
          text-decoration-color:var(--line);text-underline-offset:3px;
        }
        .guided:hover{color:var(--ink-soft)}
      `}</style>
    </div>
  );
}
