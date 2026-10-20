# #111 · Align the UI with the Apple design principles

- **Status:** In review (PR #112)
- **Phase:** none (no milestone)
- **Depends on:** #25, #33, #77, #85, #90

## Task

Audit the UI against the `apple-design` skill (WWDC _Designing Fluid Interfaces_, _The
Details of UI Typography_, _Principles of Great Design_, translated for the web) and fix
what falls short for a member using one hand at a door, often in poor signal. The audit
had two halves, merged below: a device pass at phone width (Pixel 5 on Chromium, iPhone 13
on WebKit, as member and admin) and a code pass.

Before this PR the app had no motion at all. No sheet, dialog, scrim or page animated.
The only CSS transition was `transition-colors` on the nav links and the interest picker,
and there was no `:active` style, so no press gave any response.

## Decisions

Owner decisions are marked **(owner)**. D-111-1 to D-111-6 are on the issue thread.
D-111-7 to D-111-9 answer the builder's three questions; the workflow relayed them on
2026-10-19 and they are not on the issue thread.

- **D-111-1 · Recorded UI decisions may be reworked where the design calls for it
  (owner).** Only where it clearly improves the experience. Each decision keeps its intent
  (Save always reachable above the nav, real modal focus and `inert`), and the change is
  recorded here as an explicit supersede or refine. _Why:_ otherwise the issue's
  constraints froze D-25-4, D-33-12, D-77, D-85 and D-90.
- **D-111-2 · One motion library: Motion (`motion`), pinned to an exact version
  (owner).** It is for springs, interruptible sheets and drag with velocity handoff. Import
  only what is used. Reduced motion gets cross-fades and no springs. _Why:_ a CSS
  transition cannot be grabbed mid-flight or take on a finger's velocity (skill §3).
- **D-111-3 · Chrome is translucent glass with grain (owner).** Noise over the blur,
  legible text, and a solid surface under `prefers-reduced-transparency` and
  `prefers-contrast: more`. Never translucent on translucent. _Why:_ clarity; a plain
  blur over text read as a muddy smear.
- **D-111-4 · Tests, plus a green E2E and device pass, are required (owner).**
- **D-111-5 · Shared tokens, not one-off tweaks (owner).**
- **D-111-6 · Anything not fixed is deferred with a reason (owner).** See
  [Deferred](#deferred).
- **D-111-7 · "Session" is the word users see, everywhere (owner).** This covers the nav,
  headings, back links, buttons, empty states, messages (the server's included),
  `aria-label`s, the offline shell, sync and account messages, the admin area, the CSV
  column header and the seed titles: "a session", "No session is running", "Join this
  session". Code, API and table names are not renamed (`outing_sessions`, `noteOuting`,
  `outing-team.tsx` stay). The home card's count reads "N visited tonight" and the block
  tab "All units (N)". The README screenshots were retaken under D-38-14. Supersedes
  D-38-7's "outing" vs "session" clause. Refines the quoted wording of D-24-3, D-33-30,
  D-74-36, D-74-56 and D-74-57. _Why:_ the home tab said "Session" while everything
  inside said "outing"; the app should use one word, the nav's. A count of "0 units" read
  as the size of the block.
- **D-111-8 · The text follows the iOS text-size setting (owner).** It uses
  `font: -apple-system-body` on iOS touch devices only. Body text is never below 16px,
  and spacing scales with the text. A real-iPhone check at the default and the largest
  accessibility size is a manual check for the owner. _Why:_ skill §15. Desktop Safari
  resolves the keyword to 13px (R-62).
- **D-111-9 · "End session" stays destructive-styled (owner).** A red outline on the
  Sessions list and the session detail, and a red confirm. _Why:_ it stops every member
  recording until someone reopens it.
- **D-111-10 · Colour and control tokens live in `globals.css`, in light and dark.**
  - `--app-danger` is used for errors, alerts, destructive actions and "Overdue", at
    4.5:1 or better.
  - `--app-border-strong` is the edge of every field and outlined control, at 3:1 or
    better. `--app-border` stays for dividers.
  - `--app-interest-medium-text` is the amber that is legible as text.

  The shared utilities are `btn-primary`, `btn-danger`, `btn-secondary`,
  `btn-danger-outline`, `btn-text`, `field`, `field-error`, `notice-danger` and
  `notice-success`. Implements D-111-5; interest colours stay as D-01-2. _Why:_ errors
  used the Low-interest orange at 3.3:1 and looked like the Low chip. Field edges were
  1.2:1, and WCAG 1.4.11 asks 3:1.

- **D-111-11 · A press shows on touch-down, in CSS.** Anything tappable dims (base
  layer). Filled and outlined controls and cards press in (`press`: scale 0.97,
  brightness 0.92), and list rows tint (`press-row`). The press is instant; the release
  eases back over 160 ms. `PressFeedback` registers one passive, empty `touchstart`
  listener so iOS applies `:active`. Controls get `touch-action: manipulation`, and pinch
  zoom stays. The interest picker fills at once. _Why:_ skill §1; before, nothing showed
  between a tap and the network's answer. _Research:_ R-60.
- **D-111-12 · A block tap answers before the network does.**
  `/blocks/[id]/loading.tsx` commits the navigation on the first frame, and `LinkPending`
  (`useLinkStatus`) tints the card while the route loads. The block-attach sheet loads
  as it opens, and its 200 ms debounce applies only while typing. _Why:_ with 1.5 s of
  added latency, the card showed nothing for 1.7 s. _Research:_ R-66.
- **D-111-13 · Every sheet and confirmation is one `Sheet` component**
  (`src/components/sheet.tsx`, with `SheetActions` and `SheetPresence`), portalled to
  `<body>`. It calls `useModal`, which stays the one modal mechanism; the account message
  (D-85-11) still calls the hook directly. The `z-50` and `z-60` literals live in
  `sheet.tsx`, where `overlay-layers.test.ts` reads them, and D-30-7's order is unchanged.
  `RecordOnBehalfForm` puts its `<form>` inside the panel. Supersedes D-90-1's "no wrapper
  component" clause; refines D-90-10. _Why:_ motion, drag and the portal live in one
  place. Before, an overlay inside a `space-y-*` parent took its margin, and the End
  confirm stopped 20px short of the bottom. _Research:_ R-63.
- **D-111-14 · A closing sheet hands everything back as its exit starts.** In
  `useModal(onClose, initialFocus, active)`, when `active` turns false, focus returns,
  `inert` lifts and scrolling unlocks at once. The leaving copy is `inert` and
  `aria-hidden`, so a second Escape or tap cannot close it twice. `SheetPresence` makes
  each opening a new sheet, so a sheet reopened mid-exit never brings back the saved
  draft. Refines D-90-7, D-90-8 and D-90-9; D-90-2 to D-90-6 are unchanged. _Why:_ never
  lock input during a transition (skill §3).
- **D-111-15 · Motion stays off the first load.** `motion` 14.3.1 is imported only by
  `sheet.tsx`, through `LazyMotion` and `domAnimation` (`strict`, `m` components).
  `domMax` and Motion's own drag are not used. The sync sheet, the only sheet under the
  root layout, is a chunk of its own. It is fetched when the page is idle and again on
  `online`. `src/app/first-load.test.ts` fails if the root layout, sign-in or not-found
  import Motion statically. _Why:_ sign-in is a new phone's first load, often in poor
  signal. Fetching when idle, not on the tap, lets the sheet open offline even with no
  worker in charge. _Research:_ R-64.
- **D-111-16 · Springs use Apple's damping ratio and response,** converted to stiffness
  and damping (`src/lib/sheet-motion.ts`).
  - Open and close: 1.0 / 0.42 s.
  - Settle back after a drag: 1.0 / 0.36 s, or 0.85 after a flick of 500 px/s or more.
  - Dismissing drag: leaves on 1.0 / 0.42 s, starting at the release velocity.

  _Why:_ Motion drops the starting velocity of a spring defined by duration or bounce,
  which broke the handoff. _Research:_ R-61.

- **D-111-17 · Drag to dismiss starts from the grabber and the header only.**
  - The drag starts after 10px, so a tap never interrupts the rise. From then the sheet
    tracks the finger 1:1 from where it was grabbed.
  - Pulled up past its resting place, it rubber-bands.
  - Release velocity is taken over the last 100 ms, measured back from the release.
  - A flick past ±500 px/s decides by its direction. Otherwise the sheet dismisses when
    its projected end (`project()`, 0.998) passes 40% of its height.
  - Grabbed mid-flight, it continues from where it is.

  Confirmations are not draggable. _Why:_ skill §2, §5, §6 and §9. Only the header
  starts a drag, so a sheet's own scroll is untouched, and a confirmation should take a
  deliberate answer.

- **D-111-18 · Reduced motion: a cross-fade, never no feedback.** Sheets cross-fade over
  150 ms with no travel and no springs. A drag settles instantly. Press states drop the
  scale and keep the dim. The global reduce rule stays; the scroll-edge fade is exempt
  because it follows scrolling, not time. The scrim and panel are `transition-none`, so
  only Motion moves them. _Why:_ skill §14. In WebKit, a CSS transition on those layers
  replayed the fade, a one-frame blink.
- **D-111-19 · The glass is one utility, `material-chrome`.**
  - Surface tint at 82% (`color-mix`).
  - `blur(24px) saturate(180%)`, with the `-webkit-` prefix.
  - An SVG `feTurbulence` grain tile on `::before`, at opacity 0.12 in light and 0.08
    in dark.
  - A lit top edge (an inset shadow) instead of a grey border.

  It is used on the nav, on the Save bar only while docked, and on a sheet's
  `SheetActions` over the sheet's own content. Sheets themselves are opaque over the
  scrim. Under reduced transparency it turns solid with no grain. Under more contrast it
  turns solid with an `--app-fg` edge. Implements D-111-3. _Why:_ 82% keeps the labels
  legible where no blur is drawn. The docked bar and the nav read as one slab, never
  glass on glass.

- **D-111-20 · The pinned Save is `DockedActions`.** It is glass only while actually
  pinned, which an `IntersectionObserver` marker detects. It meets the nav edge to edge,
  and the nav, now exactly `--nav-height` tall, drops its lit edge. On the block screen
  and the offline shell, a `DockHost` portals the bar to the end of the screen, and the
  submit button uses `form=`. The account screen keeps its bar in place. Refines D-25-4;
  Save is still pinned above the nav. _Why:_ a 7px strip of form showed between the bar
  and the nav. A sticky bar cannot rise above its parent, so at 200% text it sat under
  the nav. _Research:_ R-63.
- **D-111-21 · The sync bar is pinned only while something is unsent.** As D-33-12
  intended, its row is still held one line high from the first paint. When quiet ("All
  visits sent"), it scrolls away with the page. A scroll-edge fade replaces its
  `border-b`; it is a scroll-driven animation, so where that is unsupported there is no
  edge. Refines D-33-12. _Why:_ at 200% text, the sync bar, Save bar and nav left 40% of
  an iPhone 13's screen for the form, and good news need not stay pinned.
- **D-111-22 · The display settings are honoured through media queries, in both
  schemes.** Under `prefers-contrast: more`:
  - `--app-border`, `--app-border-strong` and `--app-fg-muted` darken (they lighten in
    dark mode);
  - chrome turns solid with a defined edge;
  - text buttons are underlined.

  `prefers-reduced-transparency` makes chrome solid. _Why:_ skill §14. Before, neither
  setting changed anything; borders were 1.23:1 either way.

- **D-111-23 · Type uses the system font, with tracking per size.**
  `system-ui, -apple-system, "Segoe UI", Roboto` replaces Geist, which no earlier
  decision had chosen. Tracking is +0.01em on captions, −0.01em on titles and −0.02em on
  headings. Leading tightens as the size grows. _Why:_ skill §15. SF and Roboto ship
  optical sizes, and it is one less font to download in a dead spot.
- **D-111-24 · `--reader-rem` sets the text size: `clamp(16px, 1rem, 32px)`.** Spacing
  (`--spacing`), the type scale and `--nav-height` are multiples of it. On iOS,
  `html { font: -apple-system-body }` sits inside `@supports (-webkit-touch-callout: none)`
  and `@media (pointer: coarse)`, so the root follows Dynamic Type, at 17px by default.
  - The 16px floor stops iOS zooming on input focus and keeps targets at 44px.
  - The 32px ceiling is the largest size the E2E proves. Above it, a title was crushed
    and a sheet's Save sat under its header.

  Implements D-111-8. _Why:_ the `@supports` check is what keeps desktop Safari and
  Playwright's WebKit out. `pointer: coarse` alone matches both test engines.
  _Research:_ R-62.

- **D-111-25 · Large text reflows instead of overlapping.**
  - The interest picker wraps onto rows (an auto-fit grid).
  - Nav labels never wrap. In a tab narrower than 4.25rem, the label is kept for screen
    readers only.
  - Title rows and sheet headers wrap, with Cancel dropping under the title.
  - The recording screen uses an inline, iOS-style header. Its back label gives way to
    the chevron.

  _Why:_ at 200%, "Medium" overlapped "High", and "Follow-ups" wrapped and pushed its
  icon out of line.

- **D-111-26 · A refused Save says why, beside Save.** It uses one line in D-33-29's
  `role="alert"` slot ("Not saved. Choose an interest level."). Field errors clear as
  soon as the field is fixed, and an empty unit number is flagged on blur. The follow-up
  note's error sits under its field, with `aria-invalid` and `aria-describedby`. Extends
  D-33-29; there is no scroll to the field. _Why:_ with details open, the faulty fields
  were off screen and Save did nothing visible.
- **D-111-27 · Destructive confirmations look destructive.** `ConfirmDialog` takes a
  `tone`, and it is destructive (a red fill) by default, since every use takes something
  away. `ActionSpec.destructive` is true only for ending a session, which shows as a
  danger outline on both the list and the detail. Start and Reopen stay blue. Focus still
  lands on "Keep as it is" (D-90-3). Implements D-111-9. _Why:_ the confirm looked like
  Save, and End looked different on the list and the detail.
- **D-111-28 · Every child screen names itself and has a way back.** `PageHeader` takes
  `back`.
  - The recording screen is titled "Blk 123", with its street.
  - The household's unit is its `h1`.
  - The admin session detail's `h1` is the session's title.
  - Admin and history child pages link back to their list.

  The back labels are "Session", "Sessions", "History", "Follow-ups", or "Back" where
  the link retraces. A retracing link goes back in history only after a client-side push
  from a signed-in screen (`src/lib/screen-trail.ts`); otherwise it goes to its `href`.
  _Why:_ an installed iOS app has no back button, and `history.length` cannot tell an
  in-app screen from sign-in or another site.

- **D-111-29 · There is one date format, from `src/lib/dates.ts`.** It is en-GB, day
  first: "3 Mar 2026" and "19 Oct 2026 at 3:38 pm", in the phone's own time zone. It
  replaces a code comment that kept formatting in components. _Why:_ one household
  showed "15 Jul 2026" beside "3/14/2026", and the sync sheet's format differed between
  engines.
- **D-111-30 · The sync sheet says what the bar says.** It is titled "Waiting to send"
  until a record is held or quarantined, and "Records not sent" after that. With no
  signal, Retry all is a secondary button but stays enabled. _Why:_ specific labels; one
  bar of signal can read as none.
- **D-111-31 · Every sheet is capped at `85dvh`, with its header pinned and its body
  scrolling.** A focused field is scrolled fully into view
  (`scrollIntoView({ block: "nearest" })`, `scroll-pb-24`). Refines D-74-47, which set
  this per sheet. _Why:_ three sheets used `85vh`, which on iOS can be taller than the
  visible area and push Cancel off the screen. _Research:_ R-63.
- **D-111-32 · The E2E adds one describe block, "the phone's display settings",** in
  `record-visit.spec.ts`. It covers:
  - press on touch-down;
  - sheet travel versus fade;
  - more contrast;
  - less transparency (Chromium only);
  - 200% and 53px text;
  - the smallest text.

  There is also a test that the sync sheet opens with no signal and no worker, plus
  assertions in existing specs. Because sheets now live on `<body>`, the keyboard E2E
  checks that the nav has an `inert` ancestor (refines D-90-11). _Why:_ these are the
  layout, stacking and media emulation that jsdom cannot see (D-37-6). _Research:_ R-65.

## Audit

Findings from both halves, ranked by what a member in a stairwell hits first. Where the
two halves found the same thing, they are merged into one row.

| Finding                                                                          | Principle      | Where                                                  | Outcome                                 |
| -------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------ | --------------------------------------- |
| No press state anywhere, so a tap shows nothing until the network answers        | §1, §10        | every control; no `:active` in `globals.css`           | Fixed: D-111-11                         |
| Double-tap zoom can delay quick taps                                             | §1, §10        | no `touch-action` rule                                 | Fixed: D-111-11                         |
| A block tap at 1.5 s latency shows nothing for 1.7 s                             | §1             | `block-card.tsx`; no `loading.tsx`                     | Fixed: D-111-12                         |
| The attach sheet waits 200 ms before its first load                              | §1             | `block-attach-sheet.tsx`                               | Fixed: D-111-12                         |
| A refused Save is silent with details open                                       | §16 feedback   | `record-visit-form.tsx`                                | Fixed: D-111-26                         |
| The recording screen never names its block, and has no way back                  | §16 wayfinding | `blocks/[id]/page.tsx`                                 | Fixed: D-111-28                         |
| Child screens have no way back; the household has no `h1`                        | §16 wayfinding | household, admin session detail and child pages        | Fixed: D-111-28                         |
| A 7px strip of form shows between the Save bar and the nav                       | §12            | `--nav-height` 64px vs a 57px nav                      | Fixed: D-111-20                         |
| The End confirm's scrim stops 20px short                                         | §12            | `session-action-button.tsx` inside `space-y-5`         | Fixed: D-111-13                         |
| Sheets appear and vanish in one frame, with no drag                              | §3–§7, §12     | every sheet, `confirm-dialog.tsx`                      | Fixed: D-111-13 to D-111-18             |
| Chrome is neither solid nor glass, and glass sits on glass                       | §12            | `bottom-nav.tsx`, the Save bars                        | Fixed: D-111-19, D-111-20               |
| Hard 1px dividers on chrome                                                      | §12            | nav `border-t`, sync bar `border-b`                    | Fixed: D-111-19, D-111-21               |
| Reduced transparency changes nothing                                             | §14            | `globals.css`                                          | Fixed: D-111-19, D-111-22               |
| More contrast changes nothing; borders 1.23:1                                    | §14            | `globals.css`                                          | Fixed: D-111-22                         |
| Field edges are about 1.2:1, below 3:1                                           | §14, §16       | inputs using `border-border`                           | Fixed: D-111-10                         |
| Errors use the Low-interest orange at 3.3:1; amber text is 2.47:1                | §16, §7        | form, sign-in, unit list                               | Fixed: D-111-10                         |
| A destructive confirm looks like Save; End is styled two ways                    | §16, §4        | `confirm-dialog.tsx`, `session-action-button.tsx`      | Fixed: D-111-27 (D-111-9)               |
| At 200% text the picker overlaps, nav labels wrap and the title is crushed       | §15, §5        | `interest-picker.tsx`, `bottom-nav.tsx`                | Fixed: D-111-25                         |
| At 200% text the chrome takes about 60% of the screen                            | §5, §16        | sync bar, Save bar, nav                                | Fixed under D-111-1: D-111-21, D-111-24 |
| The follow-up note's error is not tied to its field; errors linger once fixed    | §16 feedback   | `follow-up-sheet.tsx`, `record-visit-form.tsx`         | Fixed: D-111-26                         |
| Three sheets use `85vh`, so Cancel can leave the screen                          | §16, §7        | amend, block-attach, on-behalf                         | Fixed: D-111-31                         |
| Three date formats, which also differ between engines                            | §7, §4         | `follow-ups.ts`, five bare `toLocaleDateString()` uses | Fixed: D-111-29                         |
| Retry all is the loud action with no signal; the bar and the sheet disagree      | §16 labels     | `sync-queue-sheet.tsx`                                 | Fixed: D-111-30                         |
| Geist instead of the system font; no Dynamic Type                                | §15            | `layout.tsx`, `globals.css`                            | Fixed: D-111-23; D-111-24 after D-111-8 |
| The tab says "Session" and everything inside "outing"; "0 units" vs "Units (10)" | §16 labels     | `nav.ts`, `block-card.tsx`, `block-views.tsx`          | Fixed: D-111-7                          |

Already right, left alone: rem spacing, complete light and dark tokens, leading that
tightens with size, 16px body text (so iOS does not zoom on focus), zoom left enabled,
modal scrims, no artificial delay on the record path, confirmations only for actions that
take something away, and specific nav labels.

### Where a recorded decision wins over the skill

- **D-77-14:** `overscroll-behavior: none` stays, so pages do not rubber-band at their
  edges (skill §9).
- **D-33-29:** a refused Save is explained beside Save; nothing scrolls to the field.
- **D-33-12:** the sync bar stays a solid, held row, not glass (skill §12).
- **D-85-4:** the account message stays opaque; nothing may show through it.

### Recorded decisions this PR touches

| Decision                                     | Effect                                                                          | By                 |
| -------------------------------------------- | ------------------------------------------------------------------------------- | ------------------ |
| D-90-1                                       | "No wrapper component" superseded; the hook stays                               | D-111-13           |
| D-90-7, D-90-8, D-90-9                       | Refined: released as the exit starts                                            | D-111-14           |
| D-90-10, D-90-11                             | Refined: roles come from `Sheet`; the E2E checks the nav's `inert` ancestor     | D-111-13, D-111-32 |
| D-90-2 to D-90-6, D-85-4, D-85-11 to D-85-13 | Unchanged; the account message only takes the shared tokens                     | —                  |
| D-25-4                                       | Refined: `DockedActions` and `DockHost`                                         | D-111-20           |
| D-33-12                                      | Refined: pinned only while something is unsent; a fade replaces its rule        | D-111-21           |
| D-33-29                                      | Extended: the same slot explains a refused Save                                 | D-111-26           |
| D-38-7                                       | "Outing" clause superseded                                                      | D-111-7            |
| D-24-3, D-33-30, D-74-36, D-74-56, D-74-57   | Quoted wording now says "session"                                               | D-111-7            |
| D-74-47                                      | Refined: the shared `Sheet` caps height and scrolls the focused field into view | D-111-31           |
| D-77-12                                      | Kept: no nav and `--nav-height: 0` on the shell; Save sits on the bottom edge   | D-111-20           |
| D-30-7, D-74-62, D-37-6, D-38-14, D-01-2     | Kept                                                                            | —                  |

## Deferred

- **Scrolling to the first invalid field on a refused Save.** D-33-29 chose the alert
  beside Save, and D-111-26 puts the reason there.
- **Anchoring sheets to their trigger** (skill §7). These are bottom sheets, and on iOS a
  bottom sheet rises from the bottom edge.
- **Haptics** (skill §13). The audit did not raise them, and iOS has no Vibration API.
- **Showing that each new E2E test fails when broken.** Each break needs a production
  rebuild, so this is left to the verifier. The new Vitest tests were each broken and
  seen to fail.
- **What only a real iPhone shows,** listed for the owner as manual checks:
  - Dynamic Type at the default and the largest accessibility size;
  - the blur and grain (Playwright's WebKit draws no backdrop blur);
  - press states on touch-down (these depend on the `touchstart` listener);
  - how a drag feels, with a flick and with a slow pull;
  - the amend sheet with the keyboard up.

## Relies on

D-01-2, D-25-4, D-28-2, D-30-7, D-30-8, D-32-12, D-32-13, D-33-12, D-33-20, D-33-29,
D-37-6, D-38-14, D-74-47, D-74-62, D-77-12, D-77-14, D-85-4, D-85-11, D-85-12, D-90-2 to
D-90-6.

## Known limits

- Reduced transparency is proven on Chromium only, because WebKit cannot emulate it
  (R-65).
- Where scroll-driven animations are unsupported, sticky chrome shows no edge at all.
- Text larger than 32px is held at 32px (D-111-24).

## Open questions

- **Motion's download.** The chunk holding Motion is 36.9 kB gzip (R-64). It is never
  part of a first load or of sign-in. A signed-in page fetches it once idle (D-111-15),
  and the worker precaches it once per app version. Is that acceptable for a field app
  used in poor signal? The builder recommends accepting it.
- **The 32px text ceiling.** D-111-8 says to follow the iOS setting, but `--reader-rem`
  holds the four largest accessibility sizes (AX2 to AX5, 33px to 53px) at 32px. Accept
  the cap, or prove the screens at larger sizes first?
