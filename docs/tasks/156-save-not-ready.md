# #156 · Save reads as not ready before the block screen is live

- **Status:** Done (PR #172), with #155
- **Phase:** 7 - Hardening
- **Depends on:** #113, #122

## Task

On weak signal the block screen's HTML arrives before its script, and a Save tapped then
lands on the stand-in (D-111-40), which saved nothing and said nothing (D-113-5). The
member could walk to the next door. Make Save read as not ready from the server's HTML
and CSS alone, keep the field and the level usable, and leave the live Save as it is.
Built with #155 on one branch: bcd1f91.

## Decisions

- **D-156-1 · The stand-in is `SaveNotReady`: a disabled `type="button"` reading
  "Getting ready…".** `btn-primary`'s `disabled:opacity-60` dims it, as it dims
  "Saving…". It shares `SAVE_BUTTON` with the live Save, so the swap moves nothing. It
  is server HTML and the stylesheet only, with no inline script, so #122's CSP is
  untouched. A tap still saves nothing; what was typed and picked is kept for the Save
  that replaces it (D-113-1, D-113-2). Supersedes D-113-5 (owner, in #156). Refines
  D-111-40: the stand-in is no longer `SaveAndNext` naming no form, and `SaveAndNext`
  now requires `form`. _Why:_ the first tap did nothing and nothing said so.
- **D-156-2 · `disabled`, not `aria-disabled`.** _Why:_ the dim and the press rule key
  on `:disabled`, so it reads and behaves as not ready with no new CSS, and the browser
  ignores a tap with no script to refuse it.
- **D-156-3 · Before live, the label guesses nothing.** The server's HTML no longer
  says "Save"; the guess from the session's kind applies once the page is live. On a
  load by address it reads "Getting ready…", "Save", then "Save and next", in one box.
  Refines D-117-19. _Why:_ with nothing to save with yet, any Save label promised a
  save.
- **D-156-4 · The record-visit E2E checks the stand-in before live and the Save after,
  on both phones.** With JavaScript off, the first paint has a disabled "Getting ready…"
  at opacity 0.6. With every script held, the test force-taps it, since it is disabled. With only the screen's chunk held, it is in view above the nav, and once live
  "Save and next" is enabled, at opacity 1 and the same size. `untilLive` is unchanged
  and now matches only the real Save. Refines D-113-9. _Why:_ the issue's E2E criterion.
  It compares size, not position, because a short form's resting bar moves as the
  answers arrive above it.

## Evidence

Verifier rounds 0 to 2, both engines, 16 to 32px, light and dark: before live the
stand-in is disabled at 0.6, above the nav and what a tap at its centre hits; a tap sends
nothing. Through the swap Save's box is the same frame by frame, and no layout shift has
it as a source. The fixtures saw no CSP violation.

## Known limits

- The zero-violations check cannot see an inline script while `script-src` allows
  `'unsafe-inline'` (D-122-2). "No inline script" rests on the markup, plain JSX with no
  `<script>`, and on the JavaScript-off run.
- In light mode the dimmed label is about 2.4:1 on its button (the live Save about
  4.7:1). WCAG exempts an inactive control, but this one can show for 2.6 to 13 s
  (D-113-7). Not looked at in daylight.
- On iOS before scroll-driven animations, the pinned stand-in's glass stays clear
  (D-111-55), so content can show through the 0.6-opacity button at large text, possibly
  for those 2.6 to 13 s. Playwright's WebKit draws no blur; not seen on a device.
- A screen whose chunk never arrives shows a disabled "Getting ready…" indefinitely.
- In a follow-up session at 16px, Save moves from resting to pinned as the banner, chips
  and history arrive above it. That is content landing, as before, not the swap.
- "All units (0)" in the server's HTML still reads as an empty block until the units
  load (not from this PR).
- VoiceOver reading the stand-in was not checked on a device.

### How existing decisions are handled

| Decision                  | Effect                                                                               | By      |
| ------------------------- | ------------------------------------------------------------------------------------ | ------- |
| D-113-5                   | Superseded: the stand-in says it is not ready; a tap still saves nothing             | D-156-1 |
| D-111-40                  | Refined: the stand-in is `SaveNotReady`; `SaveAndNext` requires `form`               | D-156-1 |
| D-117-19                  | Refined: no Save label before live; the kind's guess once live                       | D-156-3 |
| D-113-9                   | Refined: the stand-in is force-tapped; `untilLive` matches only Save                 | D-156-4 |
| D-113-1, D-113-2, D-113-4 | Kept: the field and the level work before live; Enter still submits nothing natively | D-156-1 |
| D-122-2, D-122-8          | Kept: no inline script; the fixtures' CSP watch is unchanged                         | D-156-1 |

## Relies on

D-111-20, D-111-40, D-111-55, D-113-1, D-113-2, D-113-4, D-113-7, D-117-19, D-122-2,
D-122-8.

## Open questions

None. The owner asked for D-113-5 to be superseded (#156).
