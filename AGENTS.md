# Orientation for any coding tool working in this repo

This is the Trip Builder app (raffy's product), deployed at
trip-builder-two.vercel.app. It is a separate repo from raffy's vault
("second brain," `raffyfatlly/claude`, governed by its own `CLAUDE.md`) —
don't conflate the two. Notes about product decisions, copy history, and
"where we are" live in the vault's `notes/trip-builder-where-we-are.md`
and `meta/log.md`, not here.

There is no central instructions file for this repo beyond `README.md` and
`ROADMAP.md` — read both first. Beyond that, context lives in rich header
comments inside individual files (`lib/hook.js`, `lib/credits.js`,
`pages/api/og.js`, `public/welcome/index.html`, etc.) — each documents the
specific bug or raffy feedback that shaped it, often with a dated, verbatim
quote. Read the file you're touching before changing it; the comment at
the top usually explains why it's built the way it is, not just what it
does.

Git: this repo has no equivalent of the vault's two-branch rule — work on
whatever branch/PR flow raffy or your harness's own instructions specify.
Before writing anything, `git fetch origin main` and check for drift —
there is no session-start ritual enforcing this here the way there is in
the vault, so it's on you to not work from a stale checkout if another
tool (or another session of the same tool) has pushed since you last
synced.

**Remote note (2026-09-17):** pushing to `origin` here prints "This
repository moved. Please use the new location:
https://github.com/raffyfatlly/Trip-Builder.git" — the push still succeeds
against the old URL, but if a harness is configured against the new
capitalized URL instead, it would be working against a *different* local
view of the same underlying repo. If work ever looks like it vanished,
check which URL raffy's git remote actually points at before assuming
something broke.

(Added 2026-09-17, ahead of a DeepSeek harness getting the same access to
this repo as Claude Code, so a new tool doesn't miss context that would
otherwise only be discovered by reading every file.)
