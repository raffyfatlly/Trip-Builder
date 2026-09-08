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

export default function Packs({ onError, compact, paid }) {
  const [packs, setPacks] = useState(null);
  const [busy, setBusy] = useState('');
  // What a custom top-up is allowed to be, and what a ringgit buys. Comes from
  // the server so the rate cannot drift out of step with what it charges.
  const [topup, setTopup] = useState(null);
  const [amount, setAmount] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/pay')
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !d.ready) return;
        setPacks(d.packs || []);
        if (d.topup) { setTopup(d.topup); setAmount(String(d.topup.min)); }
      })
      .catch(() => { /* the paywall still reads fine without prices */ });
    return () => { alive = false; };
  }, []);

  const buy = async (id, myr) => {
    setBusy(id);
    try {
      const r = await fetch('/api/pay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Only the AMOUNT goes up. The credits it buys are worked out on the
        // server, at the same rate the named packs use.
        body: JSON.stringify(myr ? { pack: id, myr } : { pack: id }),
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

  // TOP-UP IS FOR PEOPLE WHO HAVE ALREADY BOUGHT. raffy, 2026-09-07: "topup only
  // offer to those who have selected either one of the two packs. or else only 2
  // pax default."
  //
  // Right, and not only for tidiness: RM10 next to RM28 makes RM10 the obvious
  // first move, and RM10 does not buy a trip. Somebody's first purchase should
  // be the one that actually gets them what they came for; the small one is for
  // topping up a trip already under way.
  const shown = (paid ? packs : packs.filter((p) => p.id !== 'topup'))
    .filter((p) => p.id !== 'topup');
  // TOP UP IS AN AMOUNT, NOT A CARD. raffy, 2026-09-08: "the topup function is
  // rm 10 minimum. then user can put any amount after that."
  //
  // The two named packs are a decision made once, and a price with a name on it
  // is easier to choose than a box to fill in. Topping up is the opposite: it
  // happens mid-trip, they know roughly what they still need, and RM10 steps
  // mean paying twice for something that costs RM12.
  const rate = (topup && topup.perCredit) || 0;
  const asked = Number(String(amount).replace(/[^\d.]/g, ''));
  const enough = topup && asked >= topup.min && asked <= topup.max;
  const buys = enough && rate > 0 ? Math.floor(asked / rate) : 0;

  return (
    <div className={'packs' + (compact ? ' compact' : '')}>
      {shown.map((p) => (
        <button key={p.id} className={'pack' + (p.id === 'starter' ? ' lead' : '')}
          disabled={!!busy} onClick={() => buy(p.id)}>
          <span className="pname">{p.name}</span>
          <span className="pprice">RM{p.myr}</span>
          <span className="pcr">{p.credits} credits</span>
          <span className="psay">{SAYS[p.id] || ''}</span>
          {busy === p.id && <span className="pgo">Taking you to checkout…</span>}
        </button>
      ))}

      {paid && topup && (
        <div className="topup">
          <span className="tname">Top up</span>
          <span className="tsay">Any amount from RM{topup.min}. Same rate as the packs.</span>
          <div className="trow">
            <label className="tin">
              <i>RM</i>
              <input
                type="number" inputMode="decimal"
                min={topup.min} max={topup.max} step="1"
                value={amount}
                disabled={!!busy}
                onChange={(e) => setAmount(e.target.value)}
                aria-label={'Amount to top up, at least RM' + topup.min}
              />
            </label>
            <button className="tbtn" disabled={!!busy || !enough}
              onClick={() => buy('topup', asked)}>
              {busy === 'topup' ? 'Taking you to checkout…'
                : enough ? 'Add ' + buys.toLocaleString('en') + ' credits'
                  : 'Minimum RM' + topup.min}
            </button>
          </div>
        </div>
      )}
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

        /* The top-up row. Same card, but the price is theirs to type, so the
           input has to look like the thing you act on rather than a field on a
           form — big figure, the RM outside it, and a button that says what the
           money buys instead of saying "Pay". */
        .topup{
          display:grid;gap:3px;padding:13px 15px;border-radius:15px;
          border:1.5px solid rgba(20,50,40,.10);background:#fff;
          box-shadow:0 1px 2px rgba(16,54,42,.05);
        }
        .tname{font-weight:700;font-size:14px;color:#10362A;letter-spacing:-.01em}
        .tsay{font-size:12px;line-height:1.4;color:#4C6157}
        .trow{display:flex;align-items:center;gap:8px;margin-top:8px}
        .tin{
          display:flex;align-items:center;gap:4px;flex:none;width:104px;
          padding:7px 10px;border-radius:11px;background:#F3F6F3;
          border:1.5px solid rgba(20,50,40,.10);
        }
        .tin i{font-style:normal;font-size:13px;font-weight:700;color:#5A6C63}
        .tin input{
          width:100%;border:0;background:none;outline:none;
          font-family:inherit;font-size:17px;font-weight:800;color:#10362A;
          font-variant-numeric:tabular-nums;letter-spacing:-.02em;
          -moz-appearance:textfield;
        }
        .tin input::-webkit-outer-spin-button,
        .tin input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
        .tbtn{
          flex:1;padding:10px 12px;border-radius:11px;border:0;
          background:#10362A;color:#EAF2EC;font-family:inherit;
          font-size:13.5px;font-weight:700;cursor:pointer;
          transition:transform 120ms cubic-bezier(.2,.7,.3,1);
        }
        .tbtn:active{transform:scale(.985)}
        .tbtn:disabled{opacity:.45;cursor:default;transform:none}
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
