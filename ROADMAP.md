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
