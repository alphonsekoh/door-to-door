# #24 · Active session screen with block picker

- **Status:** Done (PR #62)
- **Phase:** 4 - Member UI
- **Depends on:** #17, #18

## Task

The first screen a member uses: the running outing and its blocks.

## Decisions

- **D-24-1 · Blocks show who is there, but never read as taken.** Relies on blocks being
  shared.
- **D-24-2 · 30s poll plus a Refresh button; polling stops on unmount.** _Why:_ blocks
  attached mid-outing (D-18-1) must appear without a restart.
- **D-24-3 · "No outing is running" is a statement, not an alert.** Relies on D-10-7.
- **D-24-4 · Visit count shown only when it exceeds the unit count.**
- **D-24-5 · `src/lib/api-client.ts` is the typed fetch wrapper.** Relies on D-11-1.
