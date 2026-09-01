# Roadmap

**Scope line, set 2026-09-01:** *a person who has never met raffy can plan a
real trip, arrange it through the app, and use it while they are travelling.*
Anything not on that path is v2. This exists because the honest cause of
"i feel a bit overwhelm" was that nothing said when a thing was done.

**Strategy, same date:** the build is the moat, the arranging phase is the
business, the chat is the front door. Read the items below through that.

**Done since this list was written:** buttons in chat (1), editing without a
rebuild (4), photos (5), the arranging spine and Travelpayouts. Still open:
accounts (2), admin and metering (3), scope guard (6), commercial model (7).

---

Raffy's asks, **not started**. His words verbatim. Items 1-7 captured
2026-08-31; item 8 added 2026-09-01.

> * more interactive chat , like for example for certain things chat offers
>   button, instead of type. but stil let the type as an option (3rd choice) or
>   whatever.
> * user need account , like email and phone number , so they can access from
>   anywhere
> * need admin (this is where i can see who using it, and most importantly, how
>   much the cost of api for these agents to work etc.

---

## 1. Buttons in the chat, typing still available

The chat agent needs a way to say "here are the choices" rather than only
prose. Typing stays available alongside them.

**Where it lands:** the agent has to emit the options as structured data, not
as text the frontend parses. Two workable shapes:

- A second custom tool (`offer_choices`) the agent calls alongside its reply,
  answered immediately like `build_itinerary` is. Fits the existing pump.
- A structured field on the reply. Needs the message shape to change, which
  the current `eventsToTranscript` does not carry.

The first is closer to what already works.

**Watch out for:** the prompt currently tells the agent to ask two or three
things at a time in prose. Buttons and that instruction will fight unless the
prompt says when each is right. Good candidates for buttons are closed
questions — pace, dietary needs, confirmed vs still deciding. Bad candidates
are the open ones that produce the best `considerations` material.

## 2. Accounts (email and phone), reachable from anywhere

**This is the big one, and it breaks the current architecture on purpose.**

Today there is deliberately **no storage at all**: people are separated by an
anonymous session id in their own `localStorage`, and the itinerary is replayed
from the builder session's event log. That is why there is no database.

Accounts mean a real user table, a session-to-user mapping, and auth. Once
that exists the localStorage-only model goes away, and "clear your browser and
lose the chat" stops being an accepted trade.

**Note that item 3 needs the same database.** Doing them together is one piece
of work; doing them separately is two migrations.

Decisions still open: auth method (magic link by email is simplest and matches
"email and phone"; SMS costs money and needs a provider), and whether existing
anonymous sessions get claimed by an account or abandoned.

## 3. Admin: who is using it, and what the agents cost

Cost is the part he cares about most, and the good news is the data already
exists — Managed Agents sessions emit **`session.usage`** events. The builder
test showed one after every model request. Nothing currently reads them.

**What an admin view needs:**

- Per-session token usage and cost, summed from `session.usage`, split by the
  chat agent and the builder (the builder is far more expensive: it runs web
  search and writes the whole itinerary).
- How many itineraries were built, and how many builds each conversation
  triggered — re-builds are cheap by design but they add up.
- Which destinations, to see what people actually use it for.

**Related, worth doing at the same time:** there is no link gating, so anyone
with the URL can spend against the API key. There is a 40-turn cap per session
(`MAX_TURNS_PER_SESSION`) but nothing stops new sessions being created. Once
accounts exist, that cap can move to the account.

## 4. Editing should not rebuild the whole trip

> add things to consider is the process, (chat , build, chat , iterate ) cause
> now it seems like if there are things that need to be edited , its building
> again, so its slow, and expensive) maybe we can think of other ways to make
> it not too heavy m just edit the part need to be edited etc.
>
> — raffy, 2026-08-31

**He is describing a real flaw, not a preference.** Every `build_itinerary`
call spawns a *fresh* builder session that re-researches the destination from
nothing, and `getState` reads only the LAST builder session — so a rebuild
discards the previous itinerary entirely. Changing one dinner time costs a
full research pass and about four minutes.

The tools to fix it already exist and are simply not reachable from the chat
side: `update_day`, `update_stay`, `update_trip` and `add_idea` are declared
on the builder but only ever used by the builder itself, within one build.

**Three tiers, cheapest first:**

1. **Chat edits directly.** Give the chat agent `update_day` / `update_stay`
   for changes that need no research: move a time, rename something, drop an
   item, mark a stay confirmed. No builder session at all, no web search,
   near-instant. This covers most edits.
2. **Targeted revision.** A `revise_itinerary(instruction)` tool that spawns a
   builder session seeded with the CURRENT itinerary JSON plus the change
   requested, told to touch only what the change affects. For things that do
   need research ("add a half day in Hoi An") but not a rewrite.
3. **Full rebuild.** Only when the trip itself changes shape — different
   dates, a different city, a hotel swap that moves everything.

The chat agent decides which tier, and its prompt has to say plainly that
tier 3 is expensive and rarely right.

**One thing to fix alongside it:** `getState` taking the last builder session
means tier 2 and 3 must carry the existing itinerary forward rather than
starting empty, or edits made in tier 1 get lost on the next rebuild.

## 5. Photos, wherever the Phu Quoc app has them

> whereever photo is available in my phu quoc itenary, it should be in my user
> itenary too. that's what make it looks nice . so the agent need to find nice
> photo and put it in the itenary too
>
> — raffy, 2026-08-31

He is right that it is most of why his own app looks good: 9 of 50 timeline
items carry a photo, every stay has one, the hero has one.

**This is closer to done than it looks.** `photos` is a map of key to URL, and
the renderer does not care whether that URL is local or absolute — a remote
image loads fine in the preview with no hosting. The no-photo fallbacks
already built (gradient placeholders, restacked feature card) stay as the
graceful path when nothing is found.

**Where the photos come from**, roughly in order of preference:

- **Wikimedia Commons** — genuinely free, stable URLs, attribution required
  and already supported by the schema's `credit` / `licence` fields. This is
  what the Phu Quoc app used.
- **The hotels' own marketing images**, as raffy supplied for his four stays.
  Fine for a hotel's own card; not something to scrape generally.
- **User uploads** — already works end to end.
- Unsplash or Pexels need an API key and a paid tier past a low limit.

**The hard rule, learned the expensive way on the Phu Quoc build:** there was
no free photo of Meliá Vinpearl, and the nearby Vinholidays Fiesta was
beautiful and available. Using it would have been a quiet lie. The app showed
the neighbourhood instead and *said so in the caption*. The builder must do
the same: attach a photo only when it is verifiably of that place, and put an
honest caption on anything that is the area rather than the thing. A wrong
photo is worse than no photo.

Resolution matters too: size each image to its source rather than upscaling.

## 6. Scope guard: a travel agent, not an app builder

> another thing to note also is a safeguard to prevent user building whatever
> they want . minor change is okay , but the strcture of app should look
> similar.
>
> we don't need an agent that can build any app. but travel agent that can
> build nicely according to the structure we set. so this can reduce its usage
> too. u know what i mean?
>
> — raffy, 2026-08-31

**Half of this is already guaranteed, structurally.** The agent cannot build
an arbitrary app even if it tried: it has no ability to emit HTML, CSS or
code. Its only outputs are tool calls that fill a fixed schema, and the
renderer is a fixed template. Layout, navigation, typography and palette are
not reachable from the agent side at all. This is the payoff of the
schema-first decision, and it is worth not accidentally giving away later —
any future feature that lets the agent emit markup would hand back exactly
the freedom he is asking to prevent.

**The half that is genuinely open is content and cost, not structure:**

- **Off-topic use.** Nothing stops someone using the chat as a free general
  assistant. It cannot build them anything, so the structure holds, but it
  will happily talk — and every turn bills his card. This is what he means by
  "reduce its usage too": scope discipline and cost control are the same lever.
- **Implausible trips.** The schema accepts a nonsense destination or joke
  dates as readily as a real trip, and the builder will then spend a full
  research pass on it. Cheapest guard is at the chat agent, before
  `build_itinerary` is ever called.

**What to add:**

1. A topic boundary in the chat prompt: this assistant plans real trips. Off
   topic gets one short redirect, not an answer, and never a build.
2. A plausibility check before handing over — a real place, dates that are in
   the future and in a sane order, at least one identifiable stay.
3. Keep the turn cap, and consider a per-session build cap, since a build is
   the expensive call by a wide margin.

**Loose end found while writing this:** `trip.theme` is in the schema with
`sage | sand | navy`, and **none of it is implemented** — the renderer only
ever produces the sage palette. Either build the other two token sets (this
is the "minor change is okay" latitude he is describing, and it is cheap once
the palette is tokenised) or drop the field so the agent stops filling in
something with no effect.

## 7. Commercial model, and the cost work it depends on

> at this rate ill go bankrupt [...] i want at least charfge 10x from what it
> cost me., so my goal is to drive the cost really low, while customer paying
> something that worth the money for the purpose.
>
> — raffy, 2026-08-31

### Measured cost, 2026-08-31

From `session.usage` events via `setup/cost.js`, on `claude-sonnet-5`:

| | model requests | output tokens | cache read | cost |
|---|---|---|---|---|
| One build | 4-5 | ~115,000 | 1.3-1.9M | **$1.40-1.57 (RM6.20-6.90)** |
| One chat turn | 2 | ~2,600 | ~3,900 | **$0.027 (RM0.12)** |

**A build costs about fifty times a chat turn.** That single ratio should drive
every product decision here.

### The finding that matters

**115,000 output tokens to produce an itinerary whose JSON is roughly 10,000
tokens.** Output is ~80% of the bill. The gap is thinking tokens: Sonnet 5 runs
adaptive thinking and bills it as output, and a research task with seven web
searches thinks a great deal.

Levers, largest first:

1. **`output_config.effort`.** Default is `high`. Dropping the builder to
   `medium` is the single biggest saving available and is a config change, not
   a rewrite. Needs testing against output quality — worth a side-by-side on
   the same brief. (`create-agent.js` printing `model [object Object]` suggests
   the agent's model field takes an object, so effort is likely settable
   per-agent; confirm before assuming.)
2. **Fewer tool round trips.** Each one re-reads the accumulated context:
   1.3-1.9M cache-read tokens across 4-5 requests, about $0.30 a build. A
   builder told to emit one complete `save_itinerary` rather than a stream of
   `update_day` calls cuts most of that.
3. **Tier-1 edits (roadmap item 4).** Turns an RM6.50 edit into an RM0.12 one.
   This is the difference between viable and not.
4. **Haiku 4.5 for the chat agent.** Chat is already cheap, so this saves
   little in absolute terms, but it is close to free to do.
5. **Cap web searches per build.** Seven per build, billed separately.

Together these plausibly take a build from RM6.50 to under RM2. At RM50 that
is 25x, comfortably past his 10x goal.

### The pricing shape

His own instinct — chat freely, explicit Build button, lock, then limited
edits — is right, and the cost data says why: chat is nearly free, builds are
not. Making the expensive action **deliberate and visible** is both the cost
control and the better UX.

**The tension to solve:** showing a real preview before payment means eating a
build for every tyre-kicker. Charging before they see anything is a hard sell
at RM50.

**The way through, and it maps exactly onto the cost structure:**

- **The Trip tab is cheap** — hero, stays, flights, the feature card. These are
  facts from the brief, no research. The chat agent could fill them directly
  for almost nothing.
- **The Days are expensive** — that is where the research, the prose and the
  115k output tokens live.

So: **free tier is the Trip tab, the paid product is the Days.** They see their
own destination, their own dates, their family's names, the shape of their
trip — and the day-by-day is behind the paywall. The free half costs cents and
is genuinely persuasive because it is already personal.

**Charge one-off per trip, not a subscription.** People take one to three trips
a year; a monthly fee is the wrong shape for that. RM39-59 for one trip, which
includes the full build, unlimited tier-1 edits, and a small number of rebuilds
(three is generous given the measured cost).

### What still needs deciding

- Payment provider. Stripe is the obvious one but check Malaysian card and FPX
  support; local options may convert better.
- Whether an unlock is per trip or a small credit pack.
- Whether the download is part of the unlock or a separate upsell. It should be
  included: the file is the thing they keep, and holding it back cheapens the
  purchase.

### 7b. Credits, and why they should be priced per tier

> the chat stay free . but the rebuild is by credit . [...] they receive free
> credit in the beginning . they can see each iteration will cost their credit
> to reduce. [...] the chat plays an important role of giving good experience
> but still guarding the valuable so the valuable part needs credit to be
> produced [...] agent just say I've integrate bla bla bla with good reason,
> but to view it they need to build it
>
> — raffy, 2026-08-31

This is the right shape and it fits the measured costs exactly: free chat is
RM0.12 a turn, the gated build is RM6.50. He is giving away the cheap thing
and charging for the expensive one.

**The chat carrying the research verbally is the strongest part of the idea.**
"I found the Dragon Bridge does fire on weekend evenings, so I have put it on
Saturday rather than Friday" is satisfying, costs cents, and creates
appetite for seeing it laid out. Nothing is being withheld dishonestly — they
get the thinking free and pay for the artifact.

**The thing that makes it work commercially:** price credits **per tier**, not
per action, using the tiers in item 4.

| Action | Real cost | Credits |
|---|---|---|
| Chat turn | RM0.12 | free |
| Tier 1 edit (move a time, rename, drop an item) | ~RM0.12 | free or 0 |
| Tier 2 revision (targeted, some research) | est. RM1-2 | 1 |
| Tier 3 full rebuild | RM6.50, target under RM2 | 5 |

**Pricing and cost then push in the same direction.** A user who wants to spend
fewer credits makes smaller changes, which is exactly the behaviour that keeps
his bill down. Flat per-build pricing would teach the opposite.

**The tension to decide: free build plus download is a giveaway.** Most people
take one trip. If the free credits cover a full build *and* the download, a
single-trip user never pays. Options:

- **Preview free, download paid.** Cleanest. Seeing it in the browser is the
  demo; taking it on the plane is the product, and the download is genuinely
  the thing they keep — offline, live weather, editable times.
- Free build covers the first two days only.
- Rely on repeat builds as plans firm up (flights get booked, hotels change).
  Real, but not reliable enough to price on.

Preview free / download paid is recommended: it matches where the value
actually is, and it does not require crippling the free experience.

**Credit meter UX.** Show the balance, and show the price *before* the action —
"Rebuild this trip · 5 credits" on the button itself. That is his explicit
Build button, with a price tag on it, and it doubles as the cost guard.

**Sizing the free grant.** Enough for one full build and a couple of revisions
is a complete first experience and costs roughly RM10 today, under RM4 after
the optimisation work. That is the customer acquisition cost, and it should be
decided as one, not guessed.

### 7c. The draft layer, and fixed credits over metered

> if a small change cost a rebuild thats not good [...] maybe we need to build
> another layer of like document style itenary , then cost of rebuild and
> modification can be done when they are completely sure to spend their
> credits . i think 1 credit RM 1 . thats my target.
>
> or should i just let the credit runs itself as api token consumed?
>
> — raffy, 2026-08-31

**The draft layer is the best idea in this thread, and it is a cost lever as
much as a UX one.**

Today the builder does research AND structuring in one expensive pass, and any
change repeats both. Split them:

1. Chat researches once and produces a **plain-text draft** of the trip.
2. They iterate on the draft freely — move things, drop things, add a day — at
   chat prices, roughly RM0.12 a turn.
3. When they are happy, **Build** converts the draft into the structured app.

**The build then needs no research at all**, because the research already sits
in the draft. It becomes a formatting pass — read this text, emit this JSON —
which is a fraction of the 115k output tokens the current build spends
thinking. This plausibly does more for the bill than the effort setting.

It also gives a clean free tier: the draft is free, the app is paid. That is
honest positioning rather than a crippled trial — anyone can get a text
itinerary out of a chatbot; the differentiator is the thing you actually use
on the trip, with live weather, real times and offline access.

### Fixed credits, not metered tokens

**Recommendation: fixed price per action.** Metered is simpler to build and
worse to use.

- **Predictability.** "Rebuild · 5 credits" lets someone decide. A meter
  running while they think does not.
- **Variance is the business's to absorb**, not the customer's. Some builds
  cost RM4, some RM9. Averaged across customers that is fine; to one customer
  an unlucky expensive build feels like being cheated.
- **Fixed pricing keeps the gains from optimisation.** Cutting build cost from
  RM6.50 to RM2 is margin under fixed pricing. Metered hands that saving
  straight to the customer and removes the reason to do the work.
- Customers do not want to think in tokens.

The one thing metering gets right is fairness on outliers — a 21-day trip
genuinely costs more than a 3-day one. Solve that with **tiers by trip length**
(5 credits up to a week, 8 up to a fortnight), which stays predictable.

### On RM1 per credit

Good as a unit. But **do not price for 10x per action — price for 10x on the
average customer.**

A build at 5 credits is RM5 against a target cost of RM2. That is 2.5x on that
one action, which looks thin. It is the wrong frame. Sell credits in packs:

- Pack of 30 credits, RM30.
- Typical customer: one build (5) plus three revisions (3) = 8 credits.
- Real cost to serve: roughly RM4.

That is about 7x on the customer, not 2.5x, because **most people never spend
the pack**. Unused credits are the margin — that is how every credit system
works, and it is why packs beat pay-per-action.

Two consequences worth being deliberate about: do not expire credits
aggressively (it reads as a trick and the breakage is already in your favour),
and size the free grant knowing it is customer acquisition cost.

---

## 8. From itinerary to travel app: bookings, and where they come from

Raffy, 2026-09-01, verbatim:

> just to note later in roadmap i want to turn the app into a real travel app.
> like the chat manage the research assist and everything . so right now it's
> just nice looking but it misses the handling the booking part for example. we
> need app that keep their flight bookings , hotel bookings etc. so they just
> open the app and everything is kept nicely for them in there . so since its
> managed agent i think it can handle their email, or other revelant mcp for
> user right. im not sure how to execute this. but the app will look like
> something first is the summary of trip, then we have ideas and exploration,
> then the day, then the booking pages etc . to make it like real functional

**The shape he wants:** Summary → Ideas and exploration → The days → Bookings.
That is four sections, and only two of them exist today.

### The thing this breaks

Everything in this app is **replayed, never stored**. The itinerary is
reconstructed from the builder's event log; the server keeps nothing. That was
a deliberate and good decision and **bookings break it.**

A booking is not derived state. It is a PDF someone was emailed, a reference
number they will need at a counter at 6am, and it has to survive the session,
the model, the rebuild and the event log being trimmed. It is the first thing
in this app that is genuinely the user's own data rather than a view of a
conversation.

So: a `bookings` collection in Firestore, keyed by trip, with the file itself
in storage. Not the event log. Anything else loses somebody's boarding pass.

### Where bookings come from — three ways in, in this order

**1. Forward it.** Every trip gets its own address — `trip-a7f3@…` — and they
forward the confirmation. The agent parses it into a booking record and
attaches the original PDF.

This is the one to build first, and it is worth being clear why: it needs no
OAuth, no permission screen, no Google verification review, and it works with
every airline, hotel, tour and ferry on earth including the ones with terrible
email. TripIt ran on exactly this for fifteen years. The AgentMail account
already in the vault is the piece needed.

**2. Upload it.** Already half-built — the composer takes PDFs and images and
the agent reads them. Today that information dissolves into the conversation;
it should land as a booking record instead.

**2b. Let their mail client forward it for them.** The rung nobody thinks of,
and it is the one that matters. Gmail (and Outlook) can auto-forward matching
mail to an address: one filter, set once — *from airasia / booking.com / agoda
→ trip-a7f3@…*. That is the automatic behaviour people actually want from
inbox access, with no OAuth, no verification review, and no access to anything
they did not choose to send. Ship it as a "set this up once" card in the app.

Decided 2026-09-01, after raffy asked which of upload or forward was best:
**they are not alternatives, they cover different moments.** Upload is "I have
it right now", in-session, while planning. Forwarding is "it just arrived",
three weeks later, when they are not in the app at all. Planning takes a week
and the confirmations trickle in over the following month — so upload alone
means the app goes quiet exactly when it should be filling up, which is the
whole gap between a nice-looking itinerary and a travel app.

**3. Read their inbox.** Gmail through MCP, or a connector. This is the one he
asked about and it is the *last* one to do, not the first:

- It needs OAuth, a Google verification review for restricted scopes, and a
  privacy policy — weeks of process before a line of it works. There is no
  cheap version: even read-only with a narrow query is a restricted scope, so
  asking for less does not shorten the review.
- Reading a whole inbox to find four emails is a large ask for a small gain
  over forwarding.
- **Prompt injection becomes a real attack surface.** An agent that reads
  arbitrary email *and* can act is a target: a "booking confirmation"
  containing instructions is trivial to send to a known address. If this gets
  built, the email content must be treated as data the agent reads and never as
  instructions it follows, and it must not be able to spend money or send mail
  off the back of it.

**On Managed Agents and MCP specifically** — yes, it supports MCP servers, and
credentials can live in a vault so they are substituted at egress and never
enter the sandbox. So it is technically available. The blocker is not the
runtime, it is the OAuth and review process, which is why forwarding wins.

### The forwarding flow, from the traveller's side

Written out 2026-09-01 when raffy asked what it actually feels like to use.

**Empty state.** The built app has a Bookings section, and before anything is
in it: *"When you book a flight or a hotel, forward the confirmation here and
I'll file it — trip-a7f3@…"* with a Copy button and, more importantly, an
**"Email this to me"** button. They will book the flight three days later on a
laptop, and the address has to already be in their inbox where they can hit
reply-forward. Expecting anyone to remember a token is expecting them to fail.

**The act itself** is open → Forward → paste → send. Four or five taps on a
phone. Not free, but it is a thing people already know how to do, with no new
concept to learn.

**Two confirmations, because they could be in either place.** A short reply in
their mail — *"AirAsia AK1494, KUL → FCO, 14 Oct 23:40. Filed under Italy in
October. Ref QX8P2M."* with a link back — and the booking appearing in the app,
where the countdown stops saying "no flights yet" and starts counting to a real
departure. The reply mail is doing quiet work: it proves the thing arrived, it
lets them check the parse was right, and it puts a way back into the app in the
place they are already standing.

**Per-trip addresses, not one shared inbox.** With a single `bookings@` you
have to identify people by sender, and people forward from work accounts,
second Gmails, a partner's phone. The token identifies the trip regardless of
who sent it — which also means a spouse can forward their own flight to the
same trip without an account. That falls out for free and is worth keeping.

**Never drop what you cannot parse.** A Sorrento hotel sends plain text in
Italian with dates as 14/10. File the PDF anyway and ask: *"I've kept this —
Villa Maria, 14–17 Oct. Three nights or four?"* A booking half-understood is
still a booking you can open at a check-in desk at 6am.

**Duplicates** happen — they forward twice, or the auto-rule catches what they
already sent. Match on reference plus date and merge silently.

**Why this is a better deal for them, not just less work for us:** they grant
access to nothing, they see exactly what they sent, and if they stop trusting
the app they delete one filter rather than hunting for an OAuth revocation
screen.

### The renderer is the other constraint

The generated app is built by string-splicing the pinned Phu Quoc `app.html`.
A Bookings section is not a splice — that template has no such section to
patch. Either the template gains real sections, or the renderer stops being a
splicer. **This is the actual work in this item**, and it is bigger than the
booking parsing.

### Sequence

1. `bookings` in Firestore, stored not replayed, with file storage.
2. Uploads become booking records instead of dissolving into chat.
3. A Bookings section in the template, and a renderer that can address it.
4. Per-trip forwarding address, agent parses what arrives.
5. The auto-forward card, so it keeps working without them thinking about it.
6. Only then, and only if people ask for it: inbox access.

Steps 1–4 need no OAuth, no review, and no new permission from anybody.
