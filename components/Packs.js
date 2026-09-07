// What you can buy, and the button that starts the payment.
//
// raffy, 2026-09-07: "im targeting about RM 28 for first payment. thats a nice
// cost to plan a big trip."
//
// Deliberately three cards and nothing else — no feature matrix, no comparison
// table, no "most popular" badge on the middle one. Somebody looking at this
// has already hit a wall mid-trip and wants to get back to their holiday, not
// evaluate a pricing page.
//
// The credit numbers are shown because they are what runs out, but the sentence
// under each is what people actually decide on. "One big trip, with room to
// change your mind" is the honest description of 100 credits: a trip measures
// 27 to 49, so it is one comfortably and usually two — under-promised on
// purpose, which is what he asked for.

import { useEffect, useState } from 'react';

// What each pack really means, in trips rather than credits. Keyed by pack id
// so a price change in config does not need a code change to stay honest.
const SAYS = {
  topup: 'A bit more room — enough to finish what you started.',
  starter: 'One big trip, researched properly, with room to change your mind.',
  plus: 'A few trips, or one you keep coming back to.',
};

export default function Packs({ onError, compact }) {
  const [packs, setPacks] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/pay')
      .then((r) => r.json())
      .then((d) => { if (alive && d.ready) setPacks(d.packs || []); })
      .catch(() => { /* the paywall still reads fine without prices */ });
    return () => { alive = false; };
  }, []);

  const buy = async (id) => {
    setBusy(id);
    try {
      const r = await fetch('/api/pay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pack: id }),
      });
      const d = await r.json();
      if (!r.ok || !d.url) throw new Error(d.error || 'could not start the payment');
      // Stripe's own page. Nothing about a card is ever typed into this app.
      window.location.href = d.url;
    } catch (err) {
      setBusy('');
      if (onError) onError(String((err && err.message) || err));
    }
  };

  if (!packs || !packs.length) return null;

  return (
    <div className={'packs' + (compact ? ' compact' : '')}>
      {packs.map((p) => (
        <button key={p.id} className={'pack' + (p.id === 'starter' ? ' lead' : '')}
          disabled={!!busy} onClick={() => buy(p.id)}>
          <span className="pname">{p.name}</span>
          <span className="pprice">RM{p.myr}</span>
          <span className="pcr">{p.credits} credits</span>
          <span className="psay">{SAYS[p.id] || ''}</span>
          {busy === p.id && <span className="pgo">Taking you to checkout…</span>}
        </button>
      ))}
      <p className="pfoot">Card or online banking, through Stripe. No card details are typed into this app.</p>

      {/* STYLES LIVE HERE, NOT IN THE PAGE.
          styled-jsx scopes a <style jsx> block to the JSX in the SAME component
          — put these in pages/index.js and this renders as unstyled text runs
          ("Top upRM1035 creditsA bit more room"), which is exactly what the
          first screenshot showed. Fourth time this trap has been hit in this
          codebase; the rule is that a component carries its own styles. */}
      <style jsx>{`
        /* Cards, not a pricing table. Somebody seeing this has hit a wall
           mid-trip and wants to get back to their holiday, not evaluate tiers.
           So: price big, one honest sentence, no feature matrix, no badge. */
        .packs{display:grid;gap:8px;margin-top:14px}

        /* Stacked, not three across. Three columns at 360px gives each about
           100px — not enough for a price and a sentence — and the usual fix,
           shrinking the type, is how a payment screen starts to look
           untrustworthy. */
        .pack{
          display:grid;grid-template-columns:1fr auto;
          grid-template-areas:'name price' 'say cr';
          gap:3px 12px;width:100%;text-align:left;
          padding:13px 15px;border-radius:15px;
          border:1.5px solid rgba(20,50,40,.10);
          background:#fff;color:#0C241B;cursor:pointer;
          box-shadow:0 1px 2px rgba(16,54,42,.05);
          transition:transform 120ms cubic-bezier(.2,.7,.3,1), border-color 120ms;
        }
        /* The one most people want. A border rather than a ribbon: it draws the
           eye without shouting, and it still reads if colour is lost. */
        .pack.lead{border-color:#10362A}
        .pack:active{transform:scale(.985)}
        .pack:disabled{opacity:.5;cursor:default;transform:none}
        .pname{
          grid-area:name;align-self:center;font-weight:700;font-size:14px;
          color:#10362A;letter-spacing:-.01em;
        }
        /* Tabular figures so RM10, RM28 and RM68 line up down the column
           instead of each sitting a pixel off. */
        .pprice{
          grid-area:price;align-self:center;font-weight:800;font-size:17px;
          color:#10362A;font-variant-numeric:tabular-nums;letter-spacing:-.02em;
        }
        .pcr{
          grid-area:cr;font-size:11px;color:#5A6C63;text-align:right;
          font-variant-numeric:tabular-nums;white-space:nowrap;
        }
        .psay{grid-area:say;font-size:12px;line-height:1.4;color:#4C6157}
        .pgo{grid-column:1/-1;margin-top:6px;font-size:11px;color:#5A6C63}
        .pfoot{margin:9px 3px 0;font-size:10.5px;line-height:1.45;color:#5A6C63}

        @media (prefers-color-scheme: dark){
          .pack{background:#14231D;border-color:rgba(255,255,255,.10);color:#EAF0EC}
          .pack.lead{border-color:#7FB79E}
          .pname,.pprice{color:#EAF0EC}
          .psay{color:#A9BDB2}
          .pcr,.pgo,.pfoot{color:#8CA096}
        }
      `}</style>
    </div>
  );
}
