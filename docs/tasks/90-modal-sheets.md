# #90 · Make sheets and confirm dialogs real modals

- **Status:** In review (PR #97)
- **Phase:** 7 - Hardening
- **Depends on:** #30, #35, #74

## Task

Sheets and the confirm dialog said `aria-modal="true"` but behaved as boxes drawn over the
page: no focus move, no trap, no Escape, no focus return, background still tabbable. One
shared primitive fixes every one of them.

## Decisions

- **D-90-1 · One hook, `src/lib/use-modal.ts`, for every sheet and `ConfirmDialog`.**
  Returns `overlay` and `panel` refs; no wrapper component. _Why:_ the sheets differ in
  markup (one panel is a `<form>`), and a hook in `src/lib` carries the 100% threshold.
- **D-90-2 · Focus goes to the panel (`tabIndex={-1}`) on open, not the first control.**
  _Why:_ a screen reader announces the label first, and a phone does not raise the
  keyboard into a field nobody tapped.
- **D-90-3 · `ConfirmDialog` focuses "Keep as it is", never the destructive button.**
  _Why:_ Enter on open must not take something away.
- **D-90-4 · Tab is moved by hand inside the panel and wraps at both ends; the backdrop
  button is outside the trap.** _Why:_ wrap does not depend on browser `inert` support,
  and a keyboard user closes with Escape or Cancel.
- **D-90-5 · Open modals form a module-level stack; only the top handles keys.** A confirm
  raised from a sheet traps focus, and Escape closes only it. _Why:_ issue scope; a
  sheet and its confirm each register independently.
- **D-90-6 · Escape that ends an IME composition is ignored, detected by `isComposing` or
  `keyCode` 229.** WebKit sends the composition-ending keydown with `isComposing` false
  and only `keyCode` 229. `keyCode` is read through `Reflect.get` on purpose, because
  `no-deprecated` rejects it and nothing else carries this signal; removing it brings
  back text loss on iOS. _Why:_ the Escape belongs to the text field, and closing would
  lose typed text.
- **D-90-7 · Background isolation is `inert` on the siblings of each ancestor of the top
  overlay, up to `body`; elements already inert are left alone and stay inert on close.**
  The overlay stays live so the backdrop tap still closes (unchanged behaviour). _Why:_
  `inert` removes the page from both Tab and the accessibility tree, and leaving prior
  `inert` alone avoids waking something another part of the app hid. Banners (D-32-13)
  and the nav go inert too while a modal is open.
- **D-90-8 · Body scroll is locked while any modal is open and the previous `overflow`
  value is restored when the last closes.** _Why:_ nested modals must not unlock early.
- **D-90-9 · On close, focus returns to the element focused at open, only if it is still
  in the page, with `preventScroll`.** _Why:_ a row the save removed or re-rendered must
  not throw or jump the list.
- **D-90-10 · `RecordOnBehalfForm` gains `role="dialog" aria-modal="true"`.** _Why:_ it was
  the one sheet without them, so it was not announced as a dialog.
- **D-90-11 · One keyboard E2E, on the amend sheet, in `record-visit.spec.ts`.** Every other
  sheet gets one modal component test. _Why:_ keeps E2E thin (D-37-6); jsdom does not
  enforce `inert`, so the E2E is what proves it in a real browser.

Unchanged by design: backdrop behaviour, explicit buttons on destructive confirms,
`role="alert"` errors, and `z-50` sheet / `z-60` confirm layering.

## Relies on

D-30-7, D-74-47, D-25-4, D-32-13, D-37-4, D-37-6.

## Open questions

None.
