# Roadmap

Raffy's asks, captured 2026-08-31, **not started**. His words verbatim:

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
