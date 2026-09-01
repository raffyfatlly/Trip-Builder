import { useEffect, useState } from 'react';

// Rendering for the agent's structured content: options to pick between, and
// researched numbers. Tapping an option sends it back as a message, so the
// conversation carries on normally and typing is always still available.

// Anywhere named should be one tap from seeing it. The agent supplies a real
// URL when its research turned one up; when it did not, a Maps search for the
// name is still better than nothing — and it is honest about being a search
// rather than pretending to be the venue's own page.
// (raffy, 2026-08-31: "when it suggest places like in chat, make sure it
// attach a link directly.")
const mapsFor = (name, where) =>
  'https://www.google.com/maps/search/' +
  encodeURIComponent([name, where].filter(Boolean).join(' '));


// --- the picture, and everything worth opening -------------------------------
//
// raffy, 2026-09-01: "when discussing option, locations etc , i need pictures .
// and I need the direct link to the think so i don't have to go out the app and
// type. u know what I mean? we want them to be in our app as much as possible.
// the link must be there... map is not that important actually. but any info or
// links related to the suggested place is important."
//
// So: every named place gets its photograph and its own links, and Map drops to
// the end where it belongs — it is the fallback, not the destination.
//
// The card fetches its own picture. The agent cannot supply one reliably: there
// is no free Google Images API, and an image URL lifted out of a search result
// usually blocks hotlinking on a phone even when it loads here. Places has the
// real photograph of the real building, so /api/place answers with that, the
// rating, and the venue's own site — the key never leaving the server.
// The PROMISE is cached, not the answer.
//
// Caching the resolved value and reserving the key with a null meant the
// picture and the links — two components asking about the same place — raced:
// whichever asked second saw the reservation, read null, and never heard the
// answer. Its map link fell back to a search for a place we knew the real page
// of. Everyone awaiting one promise fires one request and all of them learn.
const PLACE = new Map();   // name+where -> Promise<{photo,rating,site,maps}|null>

function usePlace(name, where) {
  const q = [name, where].filter(Boolean).join(' ').trim();
  const [found, setFound] = useState(null);

  useEffect(() => {
    if (!q) return undefined;
    let alive = true;
    if (!PLACE.has(q)) {
      PLACE.set(q, fetch('/api/place?q=' + encodeURIComponent(q))
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (d && (d.photo || d.site || d.rating) ? d : null))
        // A card with no picture is fine. A card that never renders is not.
        .catch(() => null));
    }
    PLACE.get(q).then((v) => { if (alive) setFound(v); });
    return () => { alive = false; };
  }, [q]);

  return found;
}

// A thumbnail beside the name, not a banner above it.
//
// raffy, 2026-09-01: "should come out as a curated google search i think. also
// the try to structure everything so its not becoming long read. smartly
// visualise it to the reader."
//
// The banner version was 132px of picture per card, so three hotels were a
// scroll rather than a comparison. A search result puts the picture beside the
// facts precisely so the eye can run down the column — which is the whole job
// of a card set: choosing between these, not admiring each one.
function Pic({ name, where }) {
  const place = usePlace(name, where);
  const [dead, setDead] = useState(false);
  const live = place && place.photo && !dead;
  return (
    <div className={'pic' + (live ? '' : ' none')}>
      {live && <img src={place.photo} alt="" loading="lazy" onError={() => setDead(true)} />}
      <style jsx>{`
        .pic{
          width:92px;height:92px;flex:none;border-radius:15px;overflow:hidden;
          background:var(--sage);
        }
        .pic img{width:100%;height:100%;object-fit:cover;display:block}
        /* Kept, empty, rather than removed: a card set where one place has no
           photograph should still line up as a column. */
        .pic.none{background:var(--sage)}
      `}</style>
    </div>
  );
}

// The line every search result has and this one kept losing: what it scores,
// how many people said so, and where it is.
//
// raffy, 2026-09-01: "im not seeing good info like [rating] etc." The agent is
// told to look ratings up and often does not. Places returns one with the
// photograph we are already fetching, so the card fills its own gap rather
// than showing nothing — the agent's own figure still wins when it has one,
// because it may be from Booking or Agoda rather than Google.
function Meta({ o, name, where }) {
  const place = usePlace(name, where);
  const rating = o.rating || (place && place.rating) || '';
  const meta = o.meta || (place && place.address) || '';
  if (!rating && !meta) return null;
  return (
    <div className="meta">
      {rating && (
        <span className="r">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.2l5.9-.9z" />
          </svg>
          {rating}
        </span>
      )}
      {meta && <span className="w">{meta}</span>}
      <style jsx>{`
        /* Two rows, not one wrapping row. A separator between them looked
           right until an address wrapped and left the dot stranded at the
           start of its own line. Google stacks these for the same reason. */
        .meta{margin-top:4px;font-size:12.5px;line-height:1.45;color:var(--ink-faint)}
        .r{display:flex;align-items:center;gap:4px;font-weight:650;color:var(--ink-soft)}
        .r svg{width:12.5px;height:12.5px;flex:none;color:#E8A33D}
        .w{display:block;margin-top:1px}
      `}</style>
    </div>
  );
}

const OUT = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);

// Everything the agent found, then the venue's own site if it did not find one,
// then the map. Deduplicated by URL — the agent and Places often land on the
// same page, and the same link twice reads as a bug.
function Links({ o, name, where }) {
  const place = usePlace(name, where);
  const out = [];
  const seen = new Set();
  const add = (label, url) => {
    if (!url || !/^https?:\/\//i.test(url)) return;
    const k = url.replace(/\/+$/, '').toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ label, url });
  };

  (o.links || []).forEach((l) => l && add(l.label || 'Open', l.url));
  add('Their site', o.link);

  // Places knows the venue's own site too, but it is the fallback: the agent
  // read the page, Google only holds a record of it. So it fills a gap rather
  // than competing — skipped when the agent already named the venue's site, or
  // when anything on the card already points at the same host. Otherwise a
  // booking page and Google's copy of the same hotel both appear as "Their
  // site", which reads as a bug even though both work.
  if (place && place.site && !o.link) {
    const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
    const h = host(place.site);
    if (h && !out.some((l) => host(l.url) === h)) add('Their site', place.site);
  }

  return (
    <div className="links">
      {out.map((l) => (
        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">
          {OUT}{l.label}
        </a>
      ))}
      <a className="mapl" href={(place && place.maps) || mapsFor(name, where)}
        target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" />
        </svg>
        Map
      </a>
      <style jsx>{`
        .links{
          display:flex;flex-wrap:wrap;gap:14px;align-items:center;
          margin-top:11px;padding-top:11px;border-top:1px solid var(--line);
        }
        .links a{
          display:inline-flex;align-items:center;gap:6px;padding:0;
          background:none;color:var(--ink-soft);font-size:12.5px;font-weight:650;
          text-decoration:none;
        }
        .links a:hover{color:var(--ink)}
        /* raffy: "map is not that important actually" — it stays, last and
           quiet, because a named place should never be a dead end. */
        .links a.mapl{opacity:.6}
        .links a :global(svg){width:13px;height:13px;flex:none;color:var(--ink-faint)}
      `}</style>
    </div>
  );
}

// Where a recommendation came from, when it came from somewhere real.
function Source({ text }) {
  if (!text) return null;
  return (
    <div className="src">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round">
        <path d="M7.5 12a4.5 4.5 0 0 1 4.5-4.5h4a4.5 4.5 0 0 1 0 9h-1" />
        <path d="M16.5 12a4.5 4.5 0 0 1-4.5 4.5H8a4.5 4.5 0 0 1 0-9h1" />
      </svg>
      <span>{text}</span>
      <style jsx>{`
        .src{
          display:flex;gap:7px;align-items:flex-start;margin-top:9px;
          font-size:12.5px;line-height:1.45;color:var(--ink-faint);
        }
        .src svg{width:14px;height:14px;flex:none;margin-top:1px}
      `}</style>
    </div>
  );
}

export default function Block({ block, onChoose, disabled, where }) {
  const { kind, title, intro, items, facts, spots, choose, proposal } = block;

  // Ticking several and sending once.
  //
  // raffy, 2026-09-01, planning two areas of Italy: "i need to click two hotels
  // selcteion… if it has more iption, enable multi select option so the agent
  // dont react immediately after user choose."
  //
  // One click used to send straight away, so a card set that needed two answers
  // got one, and the agent replied to half a question. When the agent says this
  // set wants more than one, the buttons become toggles and nothing is sent
  // until they say they are done.
  const multi = choose && block.pick === 'many';
  const [picked, setPicked] = useState([]);
  const toggle = (name) =>
    setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]));
  const sendPicked = () => {
    if (!picked.length) return;
    // Read back in the order they appear on the card, not the order tapped —
    // it matches what they are looking at.
    const inOrder = (items || []).map((o) => o.name).filter((n) => picked.includes(n));
    const list = inOrder.length === 1
      ? inOrder[0]
      : inOrder.slice(0, -1).join(', ') + ' and ' + inOrder[inOrder.length - 1];
    onChoose(`Let's go with ${list}.`);
    setPicked([]);
  };

  return (
    <div className="block">
      <div className="bhead">
        <h4>{title}</h4>
        {intro && <p>{intro}</p>}
      </div>

      {kind === 'facts' && (
        <div className="facts">
          {(facts || []).map((f, i) => (
            <div key={i} className="fact">
              <div className="l">{f.label}</div>
              <div className="v">{f.value}</div>
              {f.note && <div className="n">{f.note}</div>}
            </div>
          ))}
        </div>
      )}

      {kind === 'spots' && (spots || []).map((sp, i) => (
        <div key={i} className="opt spot">
          <div className="head">
            <Pic name={sp.name} where={where} />
            <div className="hbody">
              <div className="name">{sp.name}</div>
              <Meta o={sp} name={sp.name} where={where} />
            </div>
          </div>
          <div className="buzz">{sp.buzz}</div>
          {sp.best && (
            <div className="best">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
              </svg>
              <span>{sp.best}</span>
            </div>
          )}
          {sp.watch && (
            <div className="watch">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              </svg>
              <span>{sp.watch}</span>
            </div>
          )}
          {(sp.tags || []).length > 0 && (
            <div className="tags">{sp.tags.map((t) => <span key={t}>{t}</span>)}</div>
          )}
          <Source text={sp.source} />
          <div className="acts">
            <button className="pick" disabled={disabled}
              onClick={() => onChoose(`Put ${sp.name} in the trip.`)}>
              Add this
            </button>
            <button className="more" disabled={disabled}
              onClick={() => onChoose(`Tell me more about ${sp.name}.`)}>
              Tell me more
            </button>
          </div>
          <Links o={sp} name={sp.name} where={where} />
        </div>
      ))}

      {kind === 'proposal' && proposal && (
        <div className="prop">
          <p className="psum">{proposal.summary}</p>

          <div className="pdays">
            {(proposal.days || []).map((d, i) => (
              <div key={i} className="pday">
                <span className="pl">{d.label}</span>
                <span className="pp">{d.plan}</span>
              </div>
            ))}
          </div>

          {(proposal.stays || []).length > 0 && (
            <div className="prow"><b>Sleeping</b><span>{proposal.stays.join(' → ')}</span></div>
          )}
          {proposal.cost && <div className="prow"><b>Cost</b><span>{proposal.cost}</span></div>}

          {(proposal.unsure || []).length > 0 && (
            <div className="unsure">
              <b>Still worth checking</b>
              <ul>{proposal.unsure.map((u, i) => <li key={i}>{u}</li>)}</ul>
            </div>
          )}

          <div className="acts">
            <button className="pick" disabled={disabled}
              onClick={() => onChoose('That looks right — build it.')}>
              Build my itinerary
            </button>
            <button className="more" disabled={disabled}
              onClick={() => onChoose('Before you build — I want to change something.')}>
              Change something
            </button>
          </div>
        </div>
      )}

      {kind === 'options' && (items || []).map((o, i) => (
        <div key={i} className="opt">
          <div className="head">
            <Pic name={o.name} where={where} />
            <div className="hbody">
              <div className="name">{o.name}</div>
              <Meta o={o} name={o.name} where={where} />
              {o.price && <div className="price">{o.price}</div>}
            </div>
          </div>
          <div className="why">{o.why}</div>
          {o.watch && (
            <div className="watch">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              </svg>
              <span>{o.watch}</span>
            </div>
          )}
          {(o.tags || []).length > 0 && (
            <div className="tags">{o.tags.map((t) => <span key={t}>{t}</span>)}</div>
          )}
          <Source text={o.source} />
          <div className="acts">
            {choose && (multi ? (
              <button className={'pick tick' + (picked.includes(o.name) ? ' on' : '')}
                disabled={disabled} aria-pressed={picked.includes(o.name)}
                onClick={() => toggle(o.name)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 12.5 4.5 4.5L19 7" />
                </svg>
                {picked.includes(o.name) ? 'Picked' : 'Pick this'}
              </button>
            ) : (
              <button className="pick" disabled={disabled}
                onClick={() => onChoose(`Let's go with ${o.name}.`)}>
                Choose this
              </button>
            ))}
            <button className="more" disabled={disabled}
              onClick={() => onChoose(`Tell me more about ${o.name}.`)}>
              Tell me more
            </button>
          </div>
          <Links o={o} name={o.name} where={where} />
        </div>
      ))}

      {/* Nothing is sent until they say they are done, so a card set that
          needs two answers gets two. */}
      {multi && (
        <div className={'confirm' + (picked.length ? ' ready' : '')}>
          <span className="count">
            {picked.length === 0
              ? 'Tick the ones you want'
              : picked.length + (picked.length === 1 ? ' picked' : ' picked')}
          </span>
          <button className="send" disabled={disabled || !picked.length} onClick={sendPicked}>
            {picked.length > 1 ? 'Send these' : 'Send'}
          </button>
        </div>
      )}

      <style jsx>{`
        .block{
          margin:10px 0;animation:rise 260ms cubic-bezier(.23,1,.32,1) both;
          max-width:min(92%,56ch);
        }
        .bhead{padding:2px 4px 9px}
        .bhead h4{
          margin:0;font-family:'Outfit',sans-serif;font-size:17px;font-weight:700;
          line-height:1.25;
        }
        .bhead p{margin:4px 0 0;font-size:13px;color:var(--ink-faint);line-height:1.45}

        .facts{
          background:var(--surface);border-radius:20px;padding:6px 16px;
          box-shadow:var(--sh-s);
        }
        .fact{padding:11px 0;border-bottom:1px solid var(--line)}
        .fact:last-child{border-bottom:0}
        .fact .l{font-size:12.5px;color:var(--ink-faint);font-weight:600}
        .fact .v{font-size:16px;font-weight:700;margin-top:2px;font-family:'Outfit',sans-serif}
        .fact .n{font-size:12.5px;color:var(--ink-soft);margin-top:3px;line-height:1.4}

        .opt{
          background:var(--surface);border-radius:20px;padding:15px 16px;
          box-shadow:var(--sh-s);margin-bottom:9px;
        }
        /* The result row: picture, then name, score and price stacked beside
           it. Price stays on its own line rather than beside the name — a real
           researched price is often a range with a qualifier ("typically
           RM320-490/night, deals from ~RM270"), which on one row overflowed the
           card and squeezed the name to one word per line. */
        .head{display:flex;gap:12px;align-items:flex-start}
        .hbody{flex:1;min-width:0}
        .name{font-size:15.5px;font-weight:700;line-height:1.3}
        .price{
          font-family:'Outfit',sans-serif;font-size:14px;font-weight:700;
          color:var(--coral-text,#AE4715);line-height:1.35;margin-top:5px;
        }
        .why{font-size:13.5px;line-height:1.5;color:var(--ink-soft);margin-top:10px}
        .watch{
          display:flex;gap:7px;align-items:flex-start;margin-top:9px;
          background:#FBE6DC;color:#8C3B14;border-radius:12px;padding:9px 11px;
          font-size:12.5px;line-height:1.4;
        }
        .watch svg{width:14px;height:14px;flex:none;margin-top:1px}
        .tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}
        .tags span{
          font-size:11px;font-weight:600;background:var(--sage);color:var(--ink-soft);
          padding:4px 9px;border-radius:99px;
        }
        .spot .buzz{font-size:13.5px;line-height:1.5;margin-top:10px}
        .spot .best{
          display:flex;gap:7px;align-items:center;margin-top:9px;
          font-size:12.5px;color:var(--ink-soft);font-weight:600;
        }
        .spot .best svg{width:14px;height:14px;flex:none;color:var(--deep)}

        /* The proposal is the one card that is the whole trip, so it gets the
           dark treatment — you should be able to tell at a glance that this is
           the thing you are saying yes to. */
        .prop{
          background:var(--deep);color:#E7EFE9;border-radius:22px;
          padding:17px 17px 15px;box-shadow:var(--sh-m);
        }
        .psum{margin:0 0 14px;font-size:13.5px;line-height:1.55;color:#CBDCD0}
        .pdays{display:flex;flex-direction:column;gap:10px;margin-bottom:14px}
        .pday{display:flex;flex-direction:column;gap:2px}
        .pl{font-size:12px;font-weight:750;color:#8FB39C;letter-spacing:.01em}
        .pp{font-size:13.5px;line-height:1.45}
        .prow{
          display:flex;gap:10px;padding:9px 0;border-top:1px solid rgba(255,255,255,.12);
          font-size:12.5px;line-height:1.45;
        }
        .prow b{flex:none;width:62px;color:#8FB39C;font-weight:700}
        .prow span{min-width:0;overflow-wrap:anywhere}
        .unsure{
          margin-top:12px;background:rgba(255,255,255,.07);border-radius:14px;padding:11px 13px;
          font-size:12.5px;line-height:1.45;
        }
        .unsure b{color:#E9B99B;font-weight:700}
        .unsure ul{margin:6px 0 0;padding-left:16px}
        .unsure li{margin:3px 0}
        .prop .acts{margin-top:14px}
        .prop .pick{background:#EAF2EC;color:var(--deep)}
        .prop .more{background:rgba(255,255,255,.13);color:#CBDCD0}

        .acts{display:flex;align-items:center;gap:7px;margin-top:13px;flex-wrap:wrap}
        button,.link{
          border:0;border-radius:99px;padding:9px 15px;font-size:13px;font-weight:600;
          cursor:pointer;font-family:inherit;text-decoration:none;
          transition:transform 150ms cubic-bezier(.23,1,.32,1);
        }
        button:active,.link:active{transform:scale(.96)}
        button:disabled{opacity:.4;cursor:default}
        .pick{background:var(--coral);color:#fff}

        /* Multi-select: a tick that fills in, and a bar that does the sending. */
        .pick.tick{
          background:var(--sage);color:var(--ink-soft);
          display:inline-flex;align-items:center;gap:6px;
        }
        .pick.tick svg{width:13px;height:13px;flex:none;opacity:.32}
        .pick.tick.on{background:var(--deep);color:#EAF2EC}
        .pick.tick.on svg{opacity:1}
        .confirm{
          display:flex;align-items:center;justify-content:space-between;gap:10px;
          margin-top:8px;padding:9px 10px 9px 15px;border-radius:99px;
          background:var(--surface);box-shadow:var(--sh-s);
          transition:background 200ms var(--e);
        }
        .confirm .count{
          font-size:12.5px;font-weight:600;color:var(--ink-faint);
        }
        .confirm.ready .count{color:var(--ink)}
        .confirm .send{
          border:0;border-radius:99px;padding:9px 17px;font-size:13px;font-weight:650;
          font-family:inherit;cursor:pointer;background:var(--coral);color:#fff;
          transition:opacity 160ms;
        }
        .confirm .send:disabled{opacity:.35;cursor:default}
        .more{background:var(--sage);color:var(--ink-soft)}
        .link{background:none;color:var(--ink-faint);margin-left:auto;padding-right:4px}

        /* Links sit in their own quiet row under the buttons. Mixed in with
           them they wrapped, and a link that has wrapped onto its own line
           looks like something went wrong rather than something on offer. */
        /* The links row styles itself — see the Links component. styled-jsx
           scopes by the component that declares the rules, so a selector left
           here would stop matching the moment the markup moved into a child,
           silently, which is exactly what happened: the row lost its layout
           and every icon rendered at its natural size. */

        @keyframes rise{
          from{opacity:0;transform:translateY(7px) scale(.985)}
          to{opacity:1;transform:none}
        }
      `}</style>
    </div>
  );
}
