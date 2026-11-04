# #113 · Typing before the page is live

- **Status:** In review (PR #154)
- **Phase:** none (no milestone; found on PR #112)
- **Depends on:** #25, #111, #119

## Task

On weak signal the block screen's HTML arrives well before its scripts. A unit typed, a
level picked and a Save tapped into it were lost or misreported: the unit reverted, the
level was a button that did nothing yet, and a Save could say "Enter the unit number".
This PR keeps what was typed and picked across hydration, stops Enter from reloading the
page before then, and stops the session's answer from throwing away a screen whose own
script is late.

## Decisions

- **D-113-1 · `useEarlyInput` adopts what a field holds, once, at mount.**
  `src/lib/hooks/use-early-input.ts` reads the field in a layout effect as the form
  mounts and hands the value to state if it differs. The recording form adopts its unit
  this way, the interest picker its checked level. _Why:_ React keeps a typed value
  through hydration but not in state, and the next render wrote the state back
  (R-125). The issue offered this or inputs uncontrolled until hydrated; this keeps the
  field controlled, so nothing else that reads the unit changes. A layout effect lands
  before anything renders again.
- **D-113-2 · The interest level is four native radios, each over its whole tile.** The
  tile is a `<label>` filled from `:checked`; the radio is `appearance-none`, laid over
  it inside the border. Group names come from `useId`, so a sheet's picker over the form
  is its own group. Refines D-25-2: still four large targets, not a select. As native
  radios, the group is one tab stop, arrow keys move and check, and Enter on a level
  submits the form, so it saves (reviewer). _Why:_ a button pick before the page was
  live did nothing; a radio shows the pick in the server's HTML, and D-113-1 adopts it.
- **D-113-3 · Each radio is `autocomplete="off"`, as the unit field is (68fef05).**
  _Why:_ a page loaded again from history came back with the level ticked and the unit
  blank, and D-113-1 took that level as picked for the next unit typed. The new E2E
  failed on both phones without it. _Research:_ R-127.
- **D-113-4 · Until the page is live, the recording form's first submit button is
  hidden and disabled.** `useLive` (`src/lib/hooks/use-live.ts`) is false in the
  server's HTML and while hydrating, true from the render after. _Why:_ before then the
  unit field is the form's only text field and Save is outside it, so Enter (Go)
  submitted the form natively, reloading `/blocks/X?` without the unit. A disabled
  default button blocks that. It is markup, not an inline script, so the Report-Only CSP
  and its E2E guard are untouched (D-122-2, D-122-8). _Research:_ R-68.
- **D-113-5 · A Save tapped before the page is live saves nothing and says nothing.**
  The tap lands on the stand-in, a `type="button"` with no handler and a different
  element from the form's Save (D-111-40). React 19 does not move it there: it hydrates
  at once and dispatches to the same target, or drops the tap while the screen's code is
  late (R-73). Measured with every script held and with only the screen's held. What was
  typed and picked is kept, so the next tap saves it. A tap that reaches the form's own
  Save as the page goes live sees the adopted unit, so the Not saved pop-up does not open
  for a unit that was typed. Keeps D-33-29 and D-119-15 for a unit really left out.
  _Why:_ the issue's second ask; the stand-in has no code to save with until the screen's
  script arrives. Owner, 2026-11-04: silent here; showing it is #156.
- **D-113-6 · Only the block screen's recording form needs this.** Sign-in, the account
  screen, Record for a member and the follow-up sheet are drawn on the client only, so
  nothing can be typed into them before the page is live; the offline shell's form
  appears after mount (D-111-40). _Why:_ the builder checked every page's server HTML as
  an admin; only the block screen had fields.
- **D-113-7 · The session reaches the app as a transition, through
  `DeferredSessionProvider`.** In the root layout, Auth.js's `SessionProvider` sits
  beside the app, and a relay hands its value to a `SessionContext` round the app in
  `startTransition`. It starts at `loading`, and an `update()` before the server answers
  sends nothing. _Why:_ when the shell's scripts arrived before the block screen's, the
  session answering was an urgent context change above a screen still the server's HTML,
  and React replaced that HTML with "Loading the block…", losing the unit and level
  (R-126). _Trade-off:_ while a late screen is still the server's HTML, the whole shell
  sees `loading`: the nav (no Admin tab), `useRole`, `AccountGate`'s check and
  `SyncProvider`, which starts no sends until then (D-33-19's app-start send waits too).
  The verifier's iPhone runs waited 2.6 to 13 s. _Rejected:_ handing the provider the
  server's session, which makes every page dynamic, the offline page included (D-77-7).
- **D-113-8 · A level's tile eases back like a button.** The press-release rule in
  `globals.css` also matches `label:has(> input[type="radio"])`: only `opacity` and
  `transform` ease, as D-111-67 requires. It matches the create-session kind radios too,
  harmlessly. _Why:_ the tile is no longer a button, and would have snapped back.
- **D-113-9 · E2E waits for `untilLive` only before tapping Save.** Refines D-111-66.
  New `record-visit.spec.ts` tests, on both phones and with service workers blocked:
  - every script held: type, Enter, pick, tap the stand-in, then all of it is kept and
    Save saves;
  - only the form's chunk held (found by its copy "Enter the unit number"): the same
    after the session answers;
  - a level left unsaved is not ticked again after a full load and Back.

  The reflow and large-text sweeps measure a level by its tile. _Why:_ typing before
  live is kept now (D-113-1), but a tap on the stand-in still saves nothing (D-113-5).
  `page.route` misses the service worker's requests in WebKit.

- **D-113-10 · The `follow-up-session.spec.ts:56` WebKit flake is not fixed here.**
  After `fill("#09-999")` the field still goes back to `#05-123`: 2 of 40 on WebKit at
  e0ea12f, 0 of 20 on Chromium. Its cause is unconfirmed. The screen is reached by
  client navigation, not hydration, and the flake was seen on `main` before this branch.
  The fill lands in the commit of the screen's first answers, and a probe with capture
  listeners hid it (0 of 140). No wait was added. _Why:_ the task asked for the cause to
  be fixed, not waited out, and it has not been found. Owner, 2026-11-04: its own issue,
  #155.

### How existing decisions are handled

| Decision          | Effect                                                                       | By               |
| ----------------- | ---------------------------------------------------------------------------- | ---------------- |
| D-25-2            | Refined: four native radios, each over its whole tile                        | D-113-2          |
| D-111-40          | Its "Corrected" note corrected: a tap on the stand-in is not replayed        | D-113-5          |
| D-111-66          | Refined: `untilLive` only before tapping Save                                | D-113-9          |
| D-119-22          | Refined: a radio's tile is its `<label>`, which wraps it; nothing more moves | D-113-2          |
| D-111-67          | Kept: the tile eases back by `opacity` and `transform` only                  | D-113-8          |
| D-33-29, D-119-15 | Kept: the line and the pop-up are for a unit really left out                 | D-113-5          |
| D-77-7            | Kept: the server's session is not handed in                                  | D-113-7          |
| D-36-3            | Its note on the root layout's provider updated                               | D-113-7          |
| R-68, R-73        | R-68 extended (implicit submission); R-73 corrected                          | D-113-4, D-113-5 |

## Known limits

- No test pins `useEarlyInput`'s layout-effect timing: with `useEffect`, every test
  still passes. After a default-priority hydration, a passive effect would leave a frame
  in which Save sends the stale unit (verifier).
- The late-chunk E2E finds the form's chunk by its copy. If that text moved to another
  chunk, the test would hold nothing and pass silently (reviewer).
- A screen whose chunk never arrives stays the server's HTML with a Save that does
  nothing. Before e0ea12f it showed "Loading the block…"; neither saved anything.
- Native radios, form restoration and Enter's implicit submission are checked in
  Playwright's engines only, not on an iPhone; VoiceOver and TalkBack were not run.

## Relies on

D-07-3, D-25-1, D-25-2, D-25-8, D-33-19, D-33-29, D-74-44, D-77-7, D-111-11, D-111-40,
D-111-66, D-111-67, D-119-13, D-119-15, D-119-22, D-122-2, D-122-8.

## Open questions

None. The owner ruled on both (D-113-5, D-113-10).
