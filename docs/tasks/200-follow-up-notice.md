# #200 · Follow-up session at the largest text: the unit field drops 170px when the session answers

- **Status:** In progress (PR #217, branch `fix/196-200-largest-text`, with #196). Built
  in a0470ad. The PR closes #196 only: #200 stays open until the owner rules on D-200-3
  and the 320×568 overlap (owner, ruling 3, 2026-11-18; Open questions).
- **Phase:** 7 - Hardening
- **Depends on:** #117, #181

## Task

At the 32px root in a follow-up session, the block screen drew "Follow-up session · Only
units on the list can be recorded." above the tabs, and only once the session answered.
The unit field dropped 170px (y 320 to 490) and ended half under the docked Save. This is
D-181-7's mechanism with a bigger shift. Client and E2E only: no contract or schema
change.

## Decisions

- **D-200-1 · The follow-up session notice is drawn under the unit field, before the
  chips it explains, in the Record view only.**
  - It has the same copy and the same `notice-info`, on the block screen and in the
    offline shell.
  - It moved from `block-views.tsx` to `record-visit-form.tsx`, so the All units tab no
    longer shows it.

  As the session answers, the field now stays at y 320 on both engines, for a member and
  an admin. Main moved it to 490, or 522 for an admin. Since D-196-18 the unit's history
  line sits between the field and the notice; the field still moves 0px (verifier
  fix-r1). _Why:_ the notice arrives with the session's answer, and nothing above the
  unit field may arrive late (D-181-7).
  _Rejected:_
  - holding room for it, which is a 170px gap at 32px in every door-to-door block,
    against D-111-65 and `:904`;
  - drawing it from the kind another screen heard (`knownSessionKind`, D-117-19), since a
    reload would still move it;
  - reading the kind on the server, which is a database read on every block page.

- **D-200-2 · `:904` ("the recording form holds still as the block's name arrives") is
  extended to a follow-up session. The follow-up sweep checks that the unit field is in
  view, unscrolled, once the session answers.**
  - `:904`'s follow-up pass runs at 320×568 and 32px. It holds the session's answer and
    the unit's history, each on its own route (D-196-14).
  - The unit field must not move as the notice arrives, and Medium and Add details must
    not move as the history lands (D-196-4).
  - The sweep calls `expectInView` before `expectFits`, which scrolls.

  Extends D-181-8. _Why:_ `expectFits` scrolls each control to the centre first, so it
  missed this, and the issue asks for `:904` to be extended rather than a spec added.
  With the notice back above the tabs, `:904` saw the field move from y 338 to 540, and
  the sweep found it covered, on both projects.

- **D-200-3 · No room is held for the notice, so on a cold load what is below the unit
  field still moves (scope cut).** When the session answers, the notice and the chips
  land above the interest picker and Add details and push them down. This happens at
  every size, including 16px. It also happens at 32px on a 390×844 screen, where the
  first tiles are on screen above the docked Save. So the issue's first criterion ("the
  recording form does not move under a tap when a follow-up session answers") is met for
  the unit field only. _Why:_ holding room was rejected (D-200-1). Main moved the same
  controls by the same amount, and the field with them.

### How existing decisions are handled

| Decision           | Effect                                                    | By      |
| ------------------ | --------------------------------------------------------- | ------- |
| D-181-7            | Applied: nothing above the unit field arrives late        | D-200-1 |
| D-181 limit (#200) | Resolved for the unit field; below it, see D-200-3        | D-200-1 |
| D-181-8            | Extended: a follow-up pass, with the history held too     | D-200-2 |
| D-117-30           | Kept: the same `notice-info`                              | D-200-1 |
| D-117-19           | Kept: the chips, which the notice now sits directly above | D-200-1 |
| D-111-65           | Kept: no gap held in door-to-door blocks                  | D-200-1 |
| D-117-58           | Kept: its notice stays above the form                     | D-200-3 |

## Known limits

- **On a cold load, what is below the unit field still moves** (D-200-3). This is the
  D-181-7 mechanism, below the field.
- **D-117-58's "Nothing in this block is on this session's list."** still sits above the
  form, as that decision places it, and it arrives with the answer.
- **At 320×568 and 32px, the unit field's foot is about 6px under the docked Save's
  glass**, before and after the answer (y 338 to 434, with Save at 436; verifier r0 to
  r2). It does not move. Main had it at y 540, wholly under. This is short of the
  second criterion at that size. D-136-10 already allows only Back to the list in view
  there after a save.

## Relies on

D-37-4, D-111-5, D-111-10, D-111-65, D-117-19, D-117-30, D-117-58, D-181-6, D-181-7,
D-181-8, D-196-4, D-196-14.

## Open questions

No ruling yet on either (owner, 2026-11-18). Until there is, #200 stays open and PR #217
says `Closes #196` only.

- **#200's first criterion (D-200-3).** It is met for the unit field only: on a cold
  load the notice and the chips still push the interest picker and Add details down.
  Accept that knowingly, or keep #200 open for what is below the field. Either way, the
  PR body should not tick that criterion without saying so.
- **The 320×568 overlap at 32px (Known limits).** The unit field's foot is about 6px
  under the docked Save's glass, short of the second criterion at that size.
