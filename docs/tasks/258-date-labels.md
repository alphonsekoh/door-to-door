# #258 · All records: the From and To labels are visible

- **Status:** In progress (branch `fix/258-date-labels`, stacked on `fix/257-records-filters`)
- **Phase:** 7 - Hardening
- **Depends on:** #245, #257

## Task

On All records (`/admin/history`) the From and To labels were `sr-only`. iOS shows no
placeholder in an empty date input, so two empty fields looked like identical blank boxes
(the open question left by #245). UI only; no contract, schema, filter or address change.

## Decisions

- **D-258-1 · The labels are visible: "From" and "To", above each input, in the follow-up
  sheet's label style `mb-1 block text-body font-medium`.** Those are the tokens of
  `globals.css` (D-111-5). _Why:_ the label sits above, so it takes its half cell's full
  width; one word fits at 32px. Closes #245's open question.
- **D-258-2 · The inputs keep the accessible names "Recorded from" and "Recorded to" through
  `aria-label`; `htmlFor` stays.** `aria-label` now supplies the name, so the `<label>` only
  gives tap-to-focus. _Why:_ the announced names are unchanged. Chromium's accessibility
  tree gives the input the same name before and after, and adds no stop. WCAG 2.5.3 (Label
  in Name) is met because the name contains the visible word. _Precedent:_ D-249-24, an
  `aria-label` that differs from the visible text. _Rejected:_ an `aria-hidden` "From"
  beside an `sr-only` "Recorded from" inside the label; `getByLabelText` and a screen
  reader read "FromRecorded from". _Trade-off:_ the name does not start with the visible
  word, the recommended form, so a Voice Control user saying "tap From" may not match. See
  Open questions.
- **D-258-3 · The follow-up sheet's date is unchanged.** It already has a visible label
  ("Go back by (optional)" or "Due (optional)") and is the app's only other date input.
- **D-258-4 · The test is the existing phone-layout E2E "admin filters are at least 44px
  tall", extended; no new spec (D-37-6; extends D-245-4).** It requires each label
  visible, at least 16px tall and wider than 8px, and wholly above its input. _Why:_ an
  `sr-only` label is a 1x1 box that `toBeVisible` accepts, so the size check is what fails.
  A Vitest test checks the `for`/`id` tie, the text and that `sr-only` is gone.
  `large-text.spec.ts`'s All records check (32px) is unchanged and still checks the page
  fits.
- **D-258-5 · D-245-1's `field` appearance rule is kept.**

## Relies on

D-37-6, D-111-5, D-245-1, D-245-4, D-249-24.

## Open questions

- **Names that start with the visible word?** With D-258-2 a Voice Control user saying "tap
  From" may not hit the field. The owner may prefer names "From" and "To", or "From date"
  and "To date", at the cost of changing what a screen reader announces. VoiceOver and Voice
  Control were not driven (Chromium only); check on an iPhone.
