# #1 · Scaffold Next.js + TypeScript + Tailwind

- **Status:** Done (PR #39)
- **Phase:** 0 - Foundation

## Task

Bootstrap the app shell: Next.js 16 App Router, TypeScript, Tailwind v4, `src/` layout,
bottom nav, theme tokens.

## Decisions

- **D-01-1 · Phone-first text and zoom.** 16px body text; `maximumScale: 5`, not 1.
  _Why:_ under 16px iOS zooms on input focus; capping zoom fails WCAG 1.4.4. _Research:_ R-15.
- **D-01-2 · Interest colours differ in lightness, not only hue.** _Why:_ chips must
  read in greyscale and for colour-blind members.
- **D-01-3 · No overscroll bounce.** `overscroll-behavior-y: none`. _Why:_ bounce makes
  one-handed taps miss.
- **D-01-4 · Route matching is pure functions in `src/lib/nav.ts`**, matched on the `/`
  boundary. _Why:_ testable without rendering; `/history-of-blocks` must not activate History.
- **D-01-5 · Tailwind v4 CSS-first config**, theme as CSS variables via `@theme inline`;
  no `tailwind.config.js`.
