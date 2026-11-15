# #111 · Align the UI with the Apple design principles

- **Status:** Done (PR #112)
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
D-111-7 to D-111-9 answer the builder's three questions; the owner posted them on the
issue on 2026-10-20. D-111-33 and D-111-34 answer the two open questions; the workflow
relayed them on 2026-10-20, and they are in the PR #112 body, not on the issue thread.
D-111-60 and D-111-61 answer the round-6 open questions; the workflow relayed them for fix
round 8, and they are in the PR #112 body too.

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
  as the size of the block. _Refined by D-111-38 and D-111-39:_ every per-session count
  says "visited", and "in this session". _Wording refined by D-117-49:_ the home card
  reads "visited in this session", not "tonight".
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
  between a tap and the network's answer. _Research:_ R-60. _Refined by D-111-41:_ the
  sheet backdrop takes no press dim. _Refined by D-111-67:_ the brightness comes back at
  once; only the scale and dim ease back.
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
  confirm stopped 20px short of the bottom. _Research:_ R-63. _Refined by D-111-57:_
  `ConfirmDialog` lives in `sheet.tsx`. _Refined by D-119-21:_ `Sheet` resets its body
  to the top on open, after the focus scroll.
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
  worker in charge. _Research:_ R-64. The owner accepted the download (D-111-33).
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
  deliberate answer. _Refined by D-111-42:_ a sheet holding typed work resists and asks.
  _Refined by D-111-45:_ "grabbed mid-flight" covers the rise and the settle, not the
  exit.

- **D-111-18 · Reduced motion: a cross-fade, never no feedback.** Sheets cross-fade over
  150 ms with no travel and no springs. A drag settles instantly. Press states drop the
  scale and keep the dim. The global reduce rule stays; the scroll-edge fade is exempt
  because it follows scrolling, not time. The scrim and panel are `transition-none`, so
  only Motion moves them. _Why:_ skill §14. In WebKit, a CSS transition on those layers
  replayed the fade, a one-frame blink. _Refined by D-111-41:_ the scrim follows a drag
  under reduced motion too.
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
  the nav. _Research:_ R-63. _Refined by D-111-40:_ a stand-in puts Save in the first
  paint, and the marker is offset in CSS, not measured. _Refined by D-111-60:_ the bar is
  80px at every text size. _Refined by D-111-69:_ after a save the form's top is brought
  back clear of it.
- **D-111-21 · The sync bar is pinned only while something is unsent.** As D-33-12
  intended, its row is still held one line high from the first paint. When quiet ("All
  visits sent"), it scrolls away with the page. A scroll-edge fade replaces its
  `border-b`; it is a scroll-driven animation, so where that is unsupported there is no
  edge. Refines D-33-12. _Why:_ at 200% text, the sync bar, Save bar and nav left 40% of
  an iPhone 13's screen for the form, and good news need not stay pinned. _Confirmed by
  D-111-61 (owner)._
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
  (`--spacing`) and the type scale ~~and `--nav-height`~~ are multiples of it. On iOS,
  `html { font: -apple-system-body }` sits inside `@supports (-webkit-touch-callout: none)`
  and `@media (pointer: coarse)`, so the root follows Dynamic Type, at 17px by default.
  - The 16px floor stops iOS zooming on input focus and keeps targets at 44px.
  - The 32px ceiling is the largest size the E2E proves. Above it, a title was crushed
    and a sheet's Save sat under its header. The owner kept it (D-111-34).

  Implements D-111-8. _Why:_ the `@supports` check is what keeps desktop Safari and
  Playwright's WebKit out. `pointer: coarse` alone matches both test engines.
  _Research:_ R-62. _Refined by D-111-48:_ a short screen switches layout in CSS. The
  `--nav-height` clause is _superseded by D-111-60_: the nav is 64px at every size.

- **D-111-25 · Large text reflows instead of overlapping.**
  - The interest picker wraps onto rows (an auto-fit grid).
  - Nav labels never wrap. In a tab narrower than ~~4.25rem~~ 68px (D-111-60), the label
    is kept for screen readers only.
  - Title rows and sheet headers wrap, with Cancel dropping under the title.
  - The recording screen uses an inline, iOS-style header. Its back label gives way to
    the chevron.

  _Why:_ at 200%, "Medium" overlapped "High", and "Follow-ups" wrapped and pushed its
  icon out of line. _Refined by D-111-35 and D-111-36:_ the 12ch rule covers every row,
  and unit numbers never split. _Refined by D-111-54:_ the back column is 44px or the
  chevron, whichever is more. _Refined by D-117-50:_ a sheet title keeps 12ch measured in
  body text, not the title's larger size, before Cancel drops under it. _Refined by
  D-181-6 (owner, 2026-11-15):_ the block screen's stand-in title, shown until the
  session answers, is held to one line and may be cut short.

- **D-111-26 · A refused Save says why, beside Save.** It uses one line in D-33-29's
  `role="alert"` slot ("Not saved. Choose an interest level."). Field errors clear as
  soon as the field is fixed, and an empty unit number is flagged on blur. The follow-up
  note's error sits under its field, with `aria-invalid` and `aria-describedby`. Extends
  D-33-29; ~~there is no scroll to the field~~. _Why:_ with details open, the faulty
  fields were off screen and Save did nothing visible. _Refined by D-119-13 and
  D-119-17:_ when a blank unit number or note is among the reasons, a Not saved pop-up
  lists them too; a missing choice alone keeps to this line. _The scroll clause is
  superseded by D-119-15 (owner, 2026-11-03) for a refusal the pop-up shows:_ its OK
  focuses the field at fault and scrolls it into view. A refusal shown only in this line
  still does not scroll. _Refined by D-119-26, D-119-30 and D-119-32:_ a unit past 32
  characters opens the pop-up too, and this line names it rather than ask for a unit. A
  unit error already showing follows the unit as it is typed.
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
  in-app screen from sign-in or another site. _Refined by D-111-54:_ the back link is at
  least 44×44. _Refined by D-111-63:_ `back` may be an in-page action.

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
  visible area and push Cancel off the screen. _Research:_ R-63. _Refined by D-119-21:_
  a sheet opens at its top, even when the control focused on open is below the view.
  _Refined by D-136-3:_ the body clears the bar as drawn (`scroll-clear-sheet-actions`),
  not `scroll-pb-24`.
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
  _Refined by D-111-37:_ the 32px sweep is a spec file of its own.

- **D-111-33 · Motion's download is accepted (owner).** About 37 kB gzip (R-64), fetched
  once a signed-in page is idle and precached, never on sign-in or a first load
  (D-111-15). _Why:_ it never stands between a new phone and signing in, and downloads
  once per app version.
- **D-111-34 · The 32px text ceiling is kept for now (owner).**
  `--reader-rem: clamp(16px, 1rem, 32px)` stays, so AX2 to AX5 (33 to 53px) are held at
  32px (D-111-24). _Why:_ 32px is what the E2E proves; past it the screens need
  redesigning, not scaling.
- **D-111-35 · What sits beside a title drops under it once the title would get less
  than 12ch.** One rule (`flex-wrap`, the title at `flex-[1_1_12ch]`) for every row with
  an action, date, chip, count, Select, Remove or Retry beside its title, on member and
  admin screens, pickers and sheets. A dropped count, Select, Remove or Retry keeps to the
  right; an action may wrap its own label; team actions stack only when both labels do
  not fit. Page titles break a long word, and "Blk N" never breaks between its words.
  Refines D-111-25. _Why:_ at 28 to 32px the Sessions list squeezed titles to 2 to 20px
  over their End button, "Record for a member" pushed Records 280px sideways, and block
  cards set "Blk" over "123". _Research:_ R-67. _Refined by D-111-51:_ it reaches the
  sync bar's count and a session's own records. _Refined by D-111-64:_ and the admin
  shortcuts and All records' visit count.
- **D-111-36 · A unit number is never split.** `UnitNumber`
  (`src/components/unit-number.tsx`), a no-wrap wrapper, is the one place this is done,
  wherever a unit number shows; `FollowUpDoor` replaces `unitLabel`. Non-breaking hyphens
  were rejected: they change the text, which breaks copying and search. _Why:_ "#06-"
  over "203" reads as two doors. _Refined by D-136-5 and D-136-7:_ U+2011 only in
  hidden generated text, and `WholeWords` keeps the marked-done text's hyphenated words
  whole. `UnitNumber` is now in `src/components/ui/unit-number.tsx` (D-115-1).
- **D-111-37 · `e2e/large-text.spec.ts` sweeps every member and admin screen at the
  32px cap.** A spec file of its own, outside D-111-32's describe block. It flags
  sideways scroll, a control past the edge or into the page margin, text spilling or
  drawn over a control, a split unit number, a column under 12ch cut short or set a word
  a line, chrome over half the screen, and a first control a tap would not reach.
  Refines D-111-32; layout only, so within D-37-6. _Why:_ jsdom lays nothing out, and no
  spec opened every screen at the cap; each fault in D-111-35 passed the existing suite.
  _Refined by D-111-59:_ it also checks every size up to the cap, records waiting and the
  offline shell. _Refined by D-111-65:_ the chrome's own size, and the form after a save.
  _Excepted by D-181-6 (owner, 2026-11-15):_ the block screen's stand-in title may be
  cut under 12ch until the session answers.
- **D-111-38 · Every per-session unit count reads "N visited".** The admin session
  detail's block card and the history card now match the home card; `admin-session.png`
  and `history.png` were retaken (D-38-14). Refines D-111-7. _Why:_ "N units" read as
  the size of the block.
- **D-111-39 · "In this session", and a refused change says why.** "On this session" is
  "in this session" everywhere. A refused start, end or reopen reads "This session is
  already running, so it cannot be started." (or "has not started", "has already
  ended"). Comments beside UI text say session; server, sync and offline comments keep
  "outing" where it tells the domain session from the sign-in session. Refines D-111-7
  and D-74-57's wording. _Why:_ the race message read "A active session cannot be
  started.", and D-28-3 shows it as it comes.
- **D-111-40 · The docked Save is in the first paint.** Until it mounts, which includes
  the server's HTML, `DockHost` draws a `standIn` at its own end, where the bar docks;
  the form's bar then replaces it with no hydration mismatch. The block screen's stand-in
  is `SaveAndNext` naming no form, so ~~a tap before hydration does nothing~~ it cannot
  submit natively. The offline shell has none, as its form appears only after mount.
  Pinned is read from a marker held down by `below-by-nav`, the bar's own CSS offset, not
  by an offset measured at mount. Refines D-111-20, and so D-25-4. _Why:_ at 32px the
  first paint put Save under the nav, and it jumped about 98px on hydration; a native
  submit would reload the page ~~and lose the typed unit~~; a measured offset went stale
  when the text size changed or the phone turned. _Research:_ R-67, R-68, R-73.
  _Corrected:_ ~~React 19 replays a tap made before hydration once the page is live. What
  can be lost is text typed before hydration: the controlled unit input usually comes
  back empty. That predates this PR and is not caused by the stand-in; it is issue #113,
  and the E2E waits it out (D-111-66).~~ _Corrected again by D-113-5:_ React does not
  move a tap on the stand-in to the form's Save, so it saves nothing (R-73). What was
  typed and picked before the page is live is kept (D-113-1, D-113-2). _Refined by
  D-111-55:_ the stand-in is glass while pinned. _Refined by D-156-1:_ the stand-in is
  `SaveNotReady`, a disabled "Getting ready…", not `SaveAndNext` naming no form, and
  `SaveAndNext` now requires `form`.
- **D-111-41 · The scrim follows the sheet.** Its opacity comes from the sheet's offset
  (`scrimOpacity`): it lightens as the sheet is pulled and darkens as it rises or
  settles. Under reduced motion it cross-fades with the panel on open and close, and
  still follows a drag. The backdrop takes no press dim. Refines D-111-18 and D-111-11.
  _Why:_ a scrim fading on its own clock did not answer the finger (skill §2, §12), and a
  press dim lightened it under the finger.
- **D-111-42 · A sheet holding typed work asks before throwing it away.** `Sheet` takes
  `discard`, set only while the follow-up, amend or record-for-a-member sheet holds
  unsaved typed changes. A pull then rubber-bands instead of tracking 1:1. A release that
  would have dismissed, judged on the finger's travel and speed, springs back and asks on
  `ConfirmDialog` (destructive): "Discard this note?", "Discard your changes?" when
  editing, or "Discard this visit?", with Keep editing or Discard. A backdrop tap asks
  too, and focus then returns to the sheet. Refines D-111-17 and D-90-7's backdrop close.
  Only unsaved input is discarded; queued records stay untouchable (D-33-2). _Why:_ a
  flick or a stray tap at a door lost the note, and iOS guards a sheet with unsaved
  changes the same way. _Research:_ R-69.
- **D-111-43 · Cancel and Escape close at once, even over typed work.** Only a drag, a
  flick or a backdrop tap asks. D-90-6 still ignores an Escape that ends an IME
  composition. _Why:_ Cancel and Escape are deliberate answers; the other three can be
  slips.
- **D-111-44 · Only sheets with typed text worth keeping ask.** The team, block-attach
  and sync sheets never do. _Why:_ they hold picks, a search or a short name, all cheap
  to redo, and a confirmation used too often trains people to tap through (skill §16).
- **D-111-45 · A leaving sheet cannot be grabbed back.** Once a close starts, the
  leaving copy is `inert` and `aria-hidden` (D-111-14), so a touch on it does nothing;
  reopening makes a new sheet. Refines D-111-17 and D-90-7. _Why:_ focus, the page and
  scrolling are handed back as the exit starts. Catching the sheet would have to take
  them back from a page the member may already be using, and a live leaving copy could be
  closed twice.
- **D-111-46 · The install banner floats only while it covers little.** It floats above
  the nav and reserves `--banner-bottom` only while it is at most a quarter of the screen
  tall and no docked Save is on screen (`bannerFloats`, `useDockedBarOnScreen`).
  Otherwise it is a card at the end of the page that scrolls with it and reserves
  nothing, so `PwaPrompts` now renders inside `main`. It is measured before paint and
  whenever it resizes, and is no wider in the page than floating, so it cannot flip at
  the limit. Refines D-32-13; D-32-12 is unchanged. _Why:_ at 32px on the iPhone profile
  it was 273px of a 664px screen, so with the nav it covered 60% of each screen, and on
  Account it covered the pinned Save. _Research:_ R-67. _Refined by D-111-58:_ a named
  section, not an aside.
- **D-111-47 · `useReservedSpace` also re-measures on a `ResizeObserver`.** Refines
  D-32-20. _Why:_ a text-size change resizes a banner with no `resize` event.
  _Research:_ R-67.

Fix round 6 (D-111-48 to D-111-59). D-111-50 and D-111-52 were proposed against D-33-12
and D-111-21; the owner rejected both (D-111-61).

- **D-111-48 · Large text on a phone is a short screen, switched in CSS.** A screen
  under 26.5 reader-rems tall above the home indicator is short (`--short-by`): an iPhone
  13 past about 25px of text, a Pixel 5 past about 27px. ~~`--crowded-by` holds when the
  nav, a docked Save and a compact sync row would cover over half the screen.~~ Each
  switch (`control-compact`, `space-under-tabs`~~, `held-row`, `sync-pinned`~~) is a
  `clamp()` against ~~one of them~~ it, so it is right on the first paint and follows a
  text-size change. A phone turned sideways in the browser is short at any text size.
  Refines D-111-24. _Why:_ a media query measures in the browser's initial font size, not
  the reader's, and a script answers only after the first paint. _Research:_ R-70.
  _Refined by D-111-61:_ `--crowded-by`, `held-row` and `sync-pinned`'s switch are gone.
  _Refined by D-111-63:_ `--short-by` also compacts the offline shell's reconnect row.
  _Extended by D-136-8:_ `target-compact`, which `control-compact` now applies.
- **D-111-49 · On a short screen the block's tabs give their height to the form.** They
  take caption text in a control at least 44px tall, so "All units (N)" stays one line,
  with `mb-2` under them instead of `mb-5`. Save is not moved. _Why:_ at 28 to 32px the
  unit field opened under the docked Save. _Research:_ R-71.
- ~~**D-111-50 · Proposed: on a short screen the quiet sync row is not held.** "All
  visits sent" takes no height (`held-row`), though a screen reader still reads it, so
  the waiting bar's arrival pushes the form down. Conflicts with D-33-12 and D-111-21.
  _Why:_ the held row was part of what put the unit field under Save. _Research:_
  R-71.~~ Rejected by the owner: D-33-12 stands (D-111-61).
- **D-111-51 · The 12ch rule reaches the sync bar's count and a session's own records.**
  The count wraps instead of being cut short, with View to its right~~, and is caption
  size on a short screen~~. In Session records and My team, Amend drops under the record.
  Refines D-111-35. _Why:_ at the cap the bar read "2 waiting to se…" and Amend was drawn
  over "#12-1234A". A shorter label ("3 to send") was rejected: wrapping already keeps the
  count whole, and the label matches the sheet's title (D-111-30). _Refined by D-111-62:_
  the count is at the base size.
- ~~**D-111-52 · Proposed: beside a docked Save, the waiting bar is pinned only while
  the chrome leaves half the screen.** That is the nav, the Save bar and the sync bar
  (`--crowded-by`). Otherwise the bar stays at the top of the page and scrolls with it.
  At 32px a Pixel 5 keeps it pinned and an iPhone 13 does not. Conflicts with D-33-12
  and D-111-21. _Why:_ at 32px on an iPhone 13 the nav and Save bar leave 44px under half
  the screen, less than one line of 32px text, so a pinned bar and D-111-37's half-screen
  limit cannot both hold. _Research:_ R-71.~~ Rejected by the owner: D-33-12 stands
  (D-111-61).
- **D-111-53 · The offline shell's status line wraps, and Continue drops under it.** It
  is never cut short and Continue keeps to the right. The row is at least one line high;
  past about 26px it can grow by a line when signal returns. Refines D-77-11's row; its
  one-line hold was a code comment, not a decision. _Why:_ "Offline. Records save on this
  phone." tells a member in a dead stairwell their records are safe. Reserving the
  wrapped height was rejected: it needs a hidden second copy of the text, which breaks
  the tests that find the row by its text. _Refined by D-111-63:_ compact on a short
  screen, with a ring edge. _See D-136-4:_ `hold-text`'s copy is in no text a test
  reads, so it could hold this line; the owner left it unheld for a later change
  (2026-11-15, #136).
- **D-111-54 · The way back is 44px or the chevron's width, whichever is more.** The
  back link is at least 44×44, and the inline header's first column is no longer held at
  2.75 reader-rems. Refines D-111-25 and D-111-28. _Why:_ at 32px that column was 88px
  and wrapped "Record a visit" onto two lines before the session loaded; at 20px the link
  was 35px wide. _See D-181-6:_ in CI's DejaVu Sans the title still wrapped, so the
  stand-in is now held to one line.
- **D-111-55 · The stand-in Save bar is glass while pinned, before any script runs.** A
  view timeline on its marker (`dock-scope`, `dock-marker`, `dock-glass`) shows the glass
  until the marker scrolls into view. Where scroll-driven animations are unsupported it
  stays clear until the page is live. The live bar keeps its observer. Refines D-111-40.
  _Why:_ the stand-in was clear where the bar that replaces it is glass. _Research:_ R-72.
- **D-111-56 · A nav tab can stand for a wider section than the screen it opens.**
  `NavItem.section`: the Admin tab opens Sessions and is current on every `/admin`
  screen. _Why:_ on Team, Records, All records and Needs a return visit, no tab was
  current.
- **D-111-57 · `ConfirmDialog` lives in `sheet.tsx`; `confirm-dialog.tsx` is gone.**
  `src/import-cycles.test.ts` fails on any import cycle in `src`. Refines D-111-13.
  _Why:_ the discard question (D-111-42) made the two files import each other, which
  worked only because each used the other inside render. A second copy of the
  confirmation for that question was rejected, as the two would drift.
- **D-111-58 · The install banner is a named `section`, not an `aside`.** Refines
  D-111-46. _Why:_ in the page it sits inside `main`, where an `aside` is a complementary
  landmark nested in the main one.
- **D-111-59 · `large-text.spec.ts` also checks what a member sees first, at every
  size.** The recording screen unscrolled at 16 to 32px (the unit field uncovered, the
  back link 44×44); records waiting; the offline shell, offline and back online; and a
  running session's own record at a wide unit. The records-waiting test scrolls first,
  since a sticky bar that has not stuck is not seen as chrome, and text cut by
  `overflow: hidden` counts as cut. Refines D-111-37. _Why:_ each fault this round fixed
  had passed the earlier sweep. _Refined by D-111-65._

Fix rounds 8 and 9 (D-111-60 to D-111-69). D-111-60 and D-111-61 are the owner's.

- **D-111-60 · The nav, the docked Save bar and the sync row stop growing with the text
  (owner).** They are drawn at the 16px base at every size, as iOS tab bars and toolbars
  are: `chrome-size` resets `--reader-rem` to `--chrome-rem` (16px) inside them, so their
  text, padding and targets stay at the base. The nav is 64px, the Save bar 80px and the
  sync row 44px, plus the safe-area inset. Nav labels stay 12px and are left to screen
  readers only in a tab under 68px, a px threshold because a container query's rem is the
  reader's. What lines up with the page uses `--page-gutter` (`bleed-x`). Targets stay
  44px or more, and content still follows the text size (D-111-24, D-111-34). Supersedes
  D-111-24's `--nav-height` clause; refines D-111-25 and D-111-20. Answers round 6's
  second open question. _Why:_ at 32px the nav and Save bar alone took 43% of an iPhone
  13's screen and put the unit field under Save. _Research:_ R-74, R-75, R-76.
  _Extended by D-136-1 (owner, 2026-11-15):_ every sheet's `SheetActions`, whose note
  keeps the text size (D-136-2).
- **D-111-61 · D-33-12 stands as it is (owner).** The sync row is held from the first
  paint on every signed-in page at every size, and the waiting bar stays pinned while
  anything is unsent. D-111-50 and D-111-52 are rejected, and `held-row` and
  `--crowded-by` are removed; D-111-21 stands. Answers round 6's first open question.
  _Why:_ a bar appearing mid-form moves the form under a thumb. With D-111-60, pinned
  chrome is 28% of an iPhone 13 at 32px with records waiting, so there is room.
  _Research:_ R-76.
- **D-111-62 · The sync row is chrome, so its count is at the base size.** The quiet row
  and the waiting bar share one box (`chrome-size`, `min-h-11`, `mb-3`); the count fits
  one line and still wraps rather than being cut. Refines D-111-51. _Why:_ of the owner's
  two options, caption sizing inside the held row or base-size text like the nav's, this
  keeps the quiet row and the bar one height at every size.
- **D-111-63 · The offline shell titles itself, and an open block is its title.** The
  "Offline" `PageHeader` moved from `/offline`'s page into `OfflineShell`. With a block
  open, the header is inline: "Blk N", its street, and a way back to the blocks.
  `PageHeader.back` may be an in-page action (`BackButton`), as every shell navigation is
  a cold reload (D-77-12); it still asks first over typed input. The session's name and
  "N records are saved on this phone" show with the block list only; under an open block
  the sync bar counts. The reconnect row is `control-compact` on a short screen, with a
  ring edge so Continue turning up moves nothing. Refines D-77-11, D-77-12, D-77-15,
  D-111-28 and D-111-53. _Why:_ under the page title, that line, the session's name and
  count and a block row, the unit field opened under Save from about 20px on both
  phones.
- **D-111-64 · The 12ch rule reaches the admin shortcuts and All records' visit count.**
  "Needs a return visit" and "All records" stack once either would have under 12ch; the
  count drops under its door, on the right. Refines D-111-35. _Why:_ on CI's Linux fonts
  at 32px, "All records" was set a word a line and "Kumar family" cut to 149px.
- **D-111-65 · `large-text.spec.ts` opens both recording forms at 11 sizes from 16 to
  32px.** On the block screen and the offline shell, with nothing waiting and with two
  records waiting, unscrolled: the unit field is uncovered, pinned chrome is under half
  the screen, the chrome keeps its 16px height, every nav label is whole, and the count
  is whole. After a save at 16, 28 and 32px, the Saved line and next unit are in view,
  and at 16px the page does not move. The jsdom tests asserting no `truncate` class were
  dropped. Refines D-111-59. _Why:_ the owner's requirement for D-111-60 and D-111-61 is
  measured layout, which jsdom cannot see (D-37-6). _Extended by D-136-12:_ a save among
  a dozen listed doors at 32px and 320×568, and the unit still from Sending to Saved on
  this phone.
- **D-111-66 · E2E tests wait for `untilLive` before typing into a block screen loaded by
  address.** It is the hydration marker in `e2e/fixtures.ts`: the docked Save is the
  form's own `type="submit"`, not the stand-in. _Why:_ text typed before hydration is
  cleared (#113), which failed WebKit on CI. #113 is not fixed here. _Refined by
  D-113-9:_ typing before it is kept now, so a test waits for it only before it taps
  Save.
- **D-111-67 · A press's brightness comes back at once.** Only `opacity` and `transform`
  ease back over 160 ms; nothing in the app transitions a `filter`, and
  `src/app/filter-transitions.test.ts` fails on `globals.css` or a component's classes
  doing so (Tailwind's `transition` and `transition-all` included). Refines D-111-11.
  _Why:_ easing the filter crashed WPE WebKit's compositor on CI in 15 of 15 runs, and
  none of 8 without it. Removing the glass or the scroll-driven edges did not stop it,
  so D-111-3 is untouched. _Research:_ R-77.
- **D-111-68 · The cache clear at sign-in and sign-out gives up after 1.5 s as a whole.**
  `CLEAR_WITHIN_MS` bounds `getRegistration` and the page's own delete; past it the clear
  counts as failed, and the delete is not cancelled. D-32-7 stands: the page deletes the
  cache and tells the worker. Extends D-32-21 and D-74-9. _Why:_ a clear that never
  settles must not hold a member on "Signing in…" any more than a failed one may. A
  single owner (the worker clears, the page waits for its answer) was tried in round 8
  and withdrawn: the sign-in hang it targeted was the crash (R-77), and it made sign-in
  wait the full 1.5 s behind an older worker.
- **D-111-69 · After a successful save, the Saved line and the unit field are scrolled
  into view.** `scrollIntoView({ block: "nearest" })`, instant, before paint, with
  margins clearing the pinned sync row and the docked Save (`scroll-clear-chrome`).
  Nothing moves where they are already in view; a refused save does not scroll
  (D-33-29, except after the Not saved pop-up's OK, D-119-15). Refines D-25-5 and
  D-111-20. _Why:_ at large text the member scrolls down to High, and a second tap
  recorded the suggested next unit unseen. Instant, as a sheet's focus scroll is: a
  smooth scroll would carry the field under a moving thumb. `block: "start"` was
  rejected: on WebKit it moved the page 60px at 16px. _Refined by D-117-77:_ only the
  Saved line is scrolled; the unit field sits under it.

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
| At 200% text the chrome takes about 60% of the screen                            | §5, §16        | sync bar, Save bar, nav                                | Fixed under D-111-1: D-111-21, D-111-60 |
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
  _Superseded by D-119-15 (owner) for a refusal the Not saved pop-up shows:_ its OK
  scrolls to the field at fault.
- **D-33-12:** the sync bar stays a solid, held row, not glass (skill §12).
- **D-85-4:** the account message stays opaque; nothing may show through it.

### Recorded decisions this PR touches

| Decision                                     | Effect                                                                          | By                 |
| -------------------------------------------- | ------------------------------------------------------------------------------- | ------------------ |
| D-90-1                                       | "No wrapper component" superseded; the hook stays                               | D-111-13           |
| D-90-7, D-90-8, D-90-9                       | Refined: released as the exit starts                                            | D-111-14           |
| D-90-7                                       | Refined: a backdrop tap over typed work asks; a leaving sheet stays inert       | D-111-42, D-111-45 |
| D-90-10, D-90-11                             | Refined: roles come from `Sheet`; the E2E checks the nav's `inert` ancestor     | D-111-13, D-111-32 |
| D-90-2 to D-90-6, D-85-4, D-85-11 to D-85-13 | Unchanged; the account message only takes the shared tokens                     | —                  |
| D-25-4                                       | Refined: `DockedActions` and `DockHost`; Save is in the first paint             | D-111-20, D-111-40 |
| D-25-5                                       | Refined: after a save, the Saved line and the next unit are scrolled into view  | D-111-69           |
| D-32-13                                      | Refined: the install banner floats only while it covers little                  | D-111-46           |
| D-32-20                                      | Refined: also re-measures on a `ResizeObserver`                                 | D-111-47           |
| D-32-21, D-74-9                              | Extended: the whole clear gives up after 1.5 s; D-32-7 is kept                  | D-111-68           |
| D-33-12                                      | Refined: pinned only while something is unsent; a fade replaces its rule        | D-111-21           |
| D-33-12                                      | Kept (owner): held at every size, pinned while anything is unsent               | D-111-61           |
| D-77-11                                      | Refined: the reconnect row wraps, Continue drops under it; compact when short   | D-111-53, D-111-63 |
| D-33-29                                      | Extended: the same slot explains a refused Save                                 | D-111-26           |
| D-38-7                                       | "Outing" clause superseded                                                      | D-111-7            |
| D-24-3, D-33-30, D-74-36, D-74-56, D-74-57   | Quoted wording now says "session"                                               | D-111-7            |
| D-74-57                                      | Wording: "in this session"                                                      | D-111-39           |
| D-74-47                                      | Refined: the shared `Sheet` caps height and scrolls the focused field into view | D-111-31           |
| D-77-12                                      | Kept: no nav and `--nav-height: 0` on the shell; Save sits on the bottom edge   | D-111-20           |
| D-77-12, D-77-15                             | Refined: an open block titles the shell; the count shows with the block list    | D-111-63           |
| D-30-7, D-74-62, D-37-6, D-38-14, D-01-2     | Kept                                                                            | —                  |
| D-32-12, D-33-2, D-90-6, D-28-3              | Kept                                                                            | —                  |

## Deferred

- **Scrolling to the first invalid field on a refused Save.** D-33-29 chose the alert
  beside Save, and D-111-26 puts the reason there. _Done by D-119-15 (owner) for a
  refusal the Not saved pop-up shows._
- **Anchoring sheets to their trigger** (skill §7). These are bottom sheets, and on iOS a
  bottom sheet rises from the bottom edge.
- **Haptics** (skill §13). The audit did not raise them, and iOS has no Vibration API.
- **Showing that each new E2E test fails when broken.** Each break needs a production
  rebuild, so this is left to the verifier. The new Vitest tests were each broken and
  seen to fail. From fix round 4, the builder showed each new E2E test failing on both
  engines against a build with its fix reverted.
- **What only a real iPhone shows,** listed for the owner as manual checks:
  - Dynamic Type at the default and the largest accessibility size;
  - the blur and grain (Playwright's WebKit draws no backdrop blur);
  - press states on touch-down (these depend on the `touchstart` listener);
  - how a drag feels, with a flick and with a slow pull;
  - the amend sheet with the keyboard up;
  - at AX1 and above: the household, Sessions and Records screens fit, unit numbers stay
    whole, and the install banner (Safari, not installed) sits at the end of the page and
    never covers Account's Save;
  - a typed follow-up note, flicked: the sheet gives, springs back and asks, and the
    scrim lightens during a slow pull;
  - a slow first load of a block screen at AX1: Save is above the nav from the first
    frame and does not jump;
  - a text-size change from Control Centre with a long form open: the docked Save turns
    to glass when it pins;
  - at AX1 and above: a block's unit field is above Save as the screen opens, the tabs
    are on one line, and with records waiting the count is whole;
  - at AX1 and above, the offline shell's line wraps whole, with Continue under it;
  - on a slow load on iOS 26 or later, the stand-in Save bar is frosted while pinned;
  - at AX1 and above: the nav, the Save bar and "N waiting to send" keep their default
    size, and their labels read whole;
  - at AX1 and above, in the offline shell: a picked block opens under its "Blk N" title,
    with its unit field above Save;
  - at AX1 and above, Save and next from low on the form: the Saved line and the next unit
    are back in view, under the waiting bar when anything is waiting;
  - a press and release on a filled button and a card: the brightness snaps back while
    the scale eases, and should still read as one motion.

## Relies on

D-01-2, D-25-4, D-25-5, D-28-2, D-28-3, D-30-7, D-30-8, D-32-7, D-32-12, D-32-13,
D-32-20, D-32-21, D-33-2, D-33-12, D-33-20, D-33-29, D-37-6, D-38-14, D-74-9, D-74-47,
D-74-62, D-77-11, D-77-12, D-77-14, D-77-15, D-85-4, D-85-11, D-85-12, D-90-2 to D-90-6.

## Known limits

- Reduced transparency is proven on Chromium only, because WebKit cannot emulate it
  (R-65).
- Where scroll-driven animations are unsupported, sticky chrome shows no edge at all.
- Text larger than 32px is held at 32px (D-111-24, kept by D-111-34).
- A sheet that is sliding away cannot be caught (D-111-45).
- The nav's labels stay 12px at every text size (D-111-60), and the web has no large
  content viewer to enlarge them on a long press, as iOS does (R-74).
- ~~Text typed into a block screen before it is live is cleared as React takes over the
  unit field. It predates this PR and is issue #113 (D-111-40, D-111-66).~~ Fixed by
  #113 (D-113-1 to D-113-4, D-113-7).
- A phone turned sideways in the browser takes the short-screen layout at any text size
  (D-111-48). The E2E covers portrait only.
- CI's Linux WebKit crashes when a `filter` is eased (R-77); D-111-67 avoids it and its
  test guards it, but the engine fault remains.

## Open questions

None. Motion's download and the 32px ceiling were answered as D-111-33 and D-111-34, and
round 6's two questions, on D-33-12 and on the chrome growing with the text, as D-111-61
and D-111-60.
