import { useState } from 'react';
import Rich from './Rich.js';

// The free question. This is the whole growth hook.
//
// raffy, 2026-09-16: "i see user always ask questions in fb groups about the
// trip they going to make. i want them to be able to use this part of the
// landing page to ask for free. one question. then when continue after it
// got the answer bring them to the plan a trip page and continue their trip
// building there... i want it too look real nice. really focus on this
// section... the agent must answer it nicely and really specific like a
// travel agent AI not just generic ai... because we want to hook by giving
// maximum value we want to answer in this part, then at the end we hint that
// they could get more relevant thing by clicking planning a trip."
//
// Deliberately its own small machine, not a mode bolted onto the real
// composer: it never touches session credits, never becomes a turn in the
// chat log, and it disappears the moment "Continue planning" hands the same
// question to the real send() — see pages/index.js, where this only ever
// renders while messages.length is 0.

const EXAMPLES = [
  'Is Da Nang worth it in September with two kids?',
  'Bali or Phuket for a couple who want to actually relax?',
  'Is 4 days enough for Tokyo first-timers?',
];

export default function HookBox({ session, onContinue, log }) {
  const [q, setQ] = useState('');
  // ask -> loading -> answered | spent | error
  const [phase, setPhase] = useState('ask');
  const [answer, setAnswer] = useState('');
  const [err, setErr] = useState('');

  const ask = async (text) => {
    const question = (typeof text === 'string' ? text : q).trim();
    if (!question || phase === 'loading') return;
    setQ(question);
    setPhase('loading');
    setErr('');
    try {
      const r = await fetch('/api/hook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, session }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 429) {
        setPhase('spent');
        return;
      }
      if (!r.ok || !d.answer) {
        setErr(d.answer || "Couldn't get an answer just now — you can still carry on below.");
        setPhase('error');
        return;
      }
      setAnswer(d.answer);
      setPhase('answered');
      if (log) log('hook_answered', { chars: question.length });
    } catch (e) {
      setErr("Couldn't reach the desk just now — you can still carry on below.");
      setPhase('error');
    }
  };

  const continuePlanning = () => {
    if (log) log('hook_continue', { fromPhase: phase });
    onContinue(q);
  };

  const done = phase === 'answered' || phase === 'spent' || phase === 'error';

  return (
    <div className={'hook' + (done ? ' done' : '')}>
      {!done && (
        <>
          <div className="hooktop">
            <span className="hooktag">Free · one question</span>
          </div>
          <div className="hookrow">
            <input
              className="hookin"
              value={q}
              placeholder="Ask like you would in a travel group…"
              disabled={phase === 'loading'}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
            />
            <button className="hookask" onClick={() => ask()} disabled={phase === 'loading' || !q.trim()}>
              {phase === 'loading' ? <i className="hookdots"><i /><i /><i /></i> : 'Ask'}
            </button>
          </div>
          {phase !== 'loading' && (
            <div className="hookegs">
              {EXAMPLES.map((s) => (
                <button key={s} className="hookeg" onClick={() => ask(s)}>{s}</button>
              ))}
            </div>
          )}
        </>
      )}

      {phase === 'answered' && (
        <div className="hookans">
          <span className="hookq">“{q}”</span>
          <div className="hookbody"><Rich text={answer} /></div>
          <button className="hookcta" onClick={continuePlanning}>
            Continue planning this trip
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      )}

      {phase === 'spent' && (
        <div className="hookans">
          <span className="hookq">You've used your free question here.</span>
          <p className="hookspent">Everything from here needs a real trip started — same desk, same
            depth, and it remembers what you tell it instead of answering once and forgetting.</p>
          <button className="hookcta" onClick={continuePlanning}>
            Start planning
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div className="hookans">
          <p className="hookspent">{err}</p>
          <button className="hookcta ghost" onClick={continuePlanning}>
            Ask it while we plan instead
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      )}

      <style jsx>{`
        .hook{
          margin-top:16px;padding:16px;border-radius:20px;background:var(--surface);
          box-shadow:var(--sh-m);border:1px solid var(--line);
        }
        .hook.done{padding:18px}
        .hooktop{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
        .hooktag{
          font-size:10.5px;font-weight:750;letter-spacing:.07em;text-transform:uppercase;
          color:var(--coral);
        }
        .hookrow{display:flex;gap:8px}
        .hookin{
          flex:1;min-width:0;border:0;background:var(--well);border-radius:14px;
          padding:13px 14px;font-size:15px;font-family:inherit;color:var(--ink);outline:none;
        }
        .hookin:focus{box-shadow:0 0 0 2px var(--deep)}
        .hookin:disabled{opacity:.6}
        .hookask{
          flex:none;border:0;background:var(--coral);color:#fff;font-weight:700;font-size:14px;
          padding:0 20px;border-radius:14px;cursor:pointer;transition:transform 150ms var(--e);
          min-width:64px;
        }
        .hookask:active:not(:disabled){transform:scale(.95)}
        .hookask:disabled{opacity:.4;cursor:default}
        .hookdots{display:inline-flex;gap:3px;align-items:center;justify-content:center}
        .hookdots i{
          width:4px;height:4px;border-radius:99px;background:#fff;
          animation:hookpulse 1.1s var(--e) infinite;
        }
        .hookdots i:nth-child(2){animation-delay:.15s}
        .hookdots i:nth-child(3){animation-delay:.3s}
        @keyframes hookpulse{0%,60%,100%{opacity:.35;transform:translateY(0)}30%{opacity:1;transform:translateY(-2px)}}

        .hookegs{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
        .hookeg{
          border:0;background:var(--well);color:var(--ink-soft);font-size:12.5px;font-weight:600;
          padding:8px 12px;border-radius:99px;cursor:pointer;text-align:left;
        }
        .hookeg:hover{color:var(--ink)}

        .hookans{display:flex;flex-direction:column;gap:2px}
        .hookq{font-size:13px;font-weight:650;color:var(--ink-soft);margin-bottom:8px}
        .hookbody{font-size:14.5px;line-height:1.55;color:var(--ink)}
        .hookspent{margin:0 0 4px;font-size:13.5px;line-height:1.5;color:var(--ink-soft)}
        .hookcta{
          margin-top:14px;align-self:flex-start;display:inline-flex;align-items:center;gap:8px;
          border:0;background:var(--deep);color:#EAF2EC;font-size:14.5px;font-weight:700;
          padding:13px 18px;border-radius:99px;cursor:pointer;box-shadow:var(--sh-s);
          transition:transform 160ms var(--e);
        }
        .hookcta.ghost{background:var(--well);color:var(--ink)}
        .hookcta:active{transform:scale(.97)}
        .hookcta svg{width:16px;height:16px}
      `}</style>
    </div>
  );
}
