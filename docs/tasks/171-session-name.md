# #171 · A session name typed as New session's answers land

- **Status:** In progress, with #181 on one branch (`fix/171-181-e2e-flakes`)
- **Phase:** 7 - Hardening
- **Depends on:** #155

## Task

On WebKit, `e2e/session-lifecycle.spec.ts:25` once found "Name this session" empty at
Create draft, and the form said "Give the session a name." Find what empties the name
and fix it in the app, with no waits. Built with #181 in commit 7315667.

## Decisions

- **D-171-1 · The cause is D-155-1's, on New session.** Two answers were set urgently,
  and WebKit could run either inside the name field's `input` event during `fill`. One is
  the follow-up list (`loadList`, `create-session-form.tsx`). The other is the sessions
  list (`load`, `admin-sessions.tsx`), which draws the form again because the parent
  holds the list. Either drew the form with the name still empty, over what was typed.
  _Why:_ CI's trace shows the follow-up list answered inside `fill`, and the probe
  (Evidence) lost the name whenever either answer was urgent. _Research:_ R-151.
- **D-171-2 · Both answers, ready or failed, are set in `startTransition`.** This extends
  D-155-2's list. `loadList` checks its generation (D-28-7) before the transition, so a
  superseded answer is still dropped. _Why:_ a transition is drawn after the event, so
  the typed name is read first.
- **D-171-3 · The admin notices stay urgent.** `ReviewCountCard` and `OverdueFollowUps`
  each draw only themselves, not the form. _Why:_ with the notices left urgent, the
  probe kept the name in every run (builder 4 of 4 each, verifier 12 of 12).
- **D-171-4 · The form's own save continuations stay urgent (pending the owner).** These
  are `setFailure`, `setSaving(false)`, and `loadList`'s `setListed({ load: "loading" })`
  when a `not_on_follow_up_list` refusal reads the list again. A name typed as one lands
  can still be lost. _Why:_ each follows the admin's own Create draft, like the block
  screen's `save()` continuations. The owner accepted those as limits on 2026-11-12
  (D-155 Known limits), but that ruling covered the block screen only (Open questions).
- **D-171-5 · The guards are two more `landWhileTyping` jsdom tests, one per answer.**
  Ten tests now use the helper (D-155-4 counted eight). _Why:_ as in #155, a pass count
  on `:25` cannot tell fixed from broken. The in-engine probe stays outside `e2e/`, as
  D-155-4's does.

## Evidence

- **In-engine probe** (production build; not in the repo). Each answer is held in the
  page and released inside the name field's `input` event during `fill`. With both
  transitions undone, the name was lost 32 of 32 times (both answers, both engines, 8
  runs each). With only the follow-up list undone, it was lost 12 of 12. At the branch
  head it was kept 48 of 48 (verifier) and 16 of 16 (builder).
- **jsdom.** Each new test fails, and only it, when its `startTransition` is made
  synchronous (reviewer, verifier).
- **Not proof of the fix:** `:25` passed 100 of 100 on WebKit under load (builder) and 40
  of 40 beside a coverage run (verifier). That meets the issue's 40-of-40 criterion.

## Known limits

- The urgent save continuations in D-171-4.
- As D-155-6 says for the unit field, a real keystroke or paste has not been tried on a
  device. Still to try on a real iPhone: type or paste a name the moment New session
  opens, on slow signal.
- No E2E spec holds an answer inside `input`. #176 owns that probe for the block screen,
  and could cover New session too.

### How existing decisions are handled

| Decision          | Effect                                                                    | By      |
| ----------------- | ------------------------------------------------------------------------- | ------- |
| D-155-1           | Same cause, found on New session                                          | D-171-1 |
| D-155-2           | Extended: New session's follow-up list and the sessions list              | D-171-2 |
| D-28-7            | Kept: the newest answer wins; its generation is checked before the change | D-171-2 |
| D-155 Known limit | Applied to New session's save; the owner's ruling is asked                | D-171-4 |
| D-155-4           | Extended: ten tests use `landWhileTyping`                                 | D-171-5 |
| D-37-4            | Kept: no waits or retries in the spec                                     | D-171-2 |

## Relies on

D-28-7, D-37-4, D-155-1, D-155-2, D-155-4, D-155-6, D-117-39.

## Open questions

- **D-171-4 needs the owner.** Should New session's save continuations stay urgent as
  recorded limits, as the owner ruled for the block screen's `save()` on 2026-11-12?
  These are the failure message, the end of saving, and the list's reload after a
  `not_on_follow_up_list` refusal.
