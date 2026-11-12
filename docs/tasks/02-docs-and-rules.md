# #2 · README, .gitignore, CLAUDE.md and project rules

- **Status:** Done (PR #41)
- **Phase:** 0 - Foundation

## Task

Project documentation and the working rules, written after the tooling exists so the
rules describe reality.

## Decisions

- **D-02-1 · Every rule is marked `[CI]` or `[convention]`.** _Why:_ makes clear which
  rules a machine enforces and which rely on review.
- **D-02-2 · README documents only commands that work.** Pending ones are marked
  _(not yet)_ with their issue. _Why:_ a README whose headline command fails is worse than
  one admitting a gap.
- **D-02-3 · CLAUDE.md is the guide; it imports AGENTS.md.** AGENTS.md keeps the block
  `next dev` regenerates. _Why:_ deleting that block only recreates an uncommitted change.
- **D-02-4 · `.claude/settings.json` denies reading `.env*`, force-push and hard reset.**
  Its allow list no longer covers `npm install` or `npx drizzle-kit` (D-131-8).
