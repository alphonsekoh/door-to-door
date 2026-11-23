# #273 · PDPA privacy policy page and footer

- **Status:** In progress (draft PR into `dev`; not to merge until the erasure PR is ready)
- **Phase:** Cross-cutting
- **Depends on:** the erasure issue (not yet filed), which must merge to `dev` with this PR

## Task

A public `/privacy` page that tells householders and members what the app records and why,
how to see, correct or erase it, how long it is kept and where it is processed, and a footer
link to it. The text promises erasure and retention that nothing enforces until the erasure
PR, which is why this PR is held for it.

## Decisions

Owner rulings of 2026-11-23:

- **D-273-1 · Householder consent is deemed consent by conduct.** The householder chooses to
  tell the member, who says what is recorded and why. The policy never claims the app records
  consent, and says religion is sensitive and recorded only if the person chose to tell us.
  A printed notice or QR card is a separate issue, not in this PR. _Why:_ the app has no
  consent step, and the policy must not claim one (issue #273).
- **D-273-2 · Calls and messages need the person's agreement first, and the app records none.**
  The app itself never calls or messages anyone. The team contacts a recorded contact, to
  arrange a visit or to send an invitation, only after asking and getting agreement, which the
  person can withdraw at any time. _Why:_ invitations may be marketing messages under the Do
  Not Call provisions. **Compliance-review item:** whether consent to messages must be kept in
  a form that can be evidenced. _Research:_ R-259.
- **D-273-3 · The PR is a draft, held for the erasure PR.** Both merge to `dev` together, then
  `dev` goes to `stage` and `main` as a whole. _Why:_ retention and erasure are promised in the
  text and enforced by nothing here.
- **D-273-4 · Retention: any follow-up activity restarts a household's 24-month clock; no
  hold for an open follow-up.** The text reads "24 months after the last visit or follow-up
  activity at that household". No schema change here; deriving the clock and the expiry job
  belong to the erasure issue. Other periods as the issue decided: accounts 12 months after the
  member leaves, sign-in records 30 days.
- **D-273-5 · Transfers named:** Neon (Singapore, ap-southeast-1), Vercel functions
  (Singapore; a US company whose network and logs may process requests elsewhere), and Google
  sign-in. _Research:_ R-260.
- **D-273-6 · `RESTORE_WINDOW_DAYS` (`src/lib/privacy/policy.ts`) is an unverified
  placeholder of 1.** Neon's restore window is being confirmed by the owner; it is one named
  constant, tested to be a positive integer, quoted as "up to". **Must be confirmed before
  merge.** _Research:_ R-260.
- **D-273-7 · The operator is a private individual, who is also the DPO and the compliance
  reviewer.** The config keys are `privacy.organisation` (the operator's name, a person's or a
  body's) and `privacy.dpoEmail`, but policy text and config errors say "operator" or "we",
  never "organisation". No real name or email in the repo: fixtures, `config.example.yaml`
  and E2E use placeholders. The owner sets the real values in production `CONFIG_YAML`.

Builder's decisions:

- **D-273-8 · Footer on `/sign-in`, `/waiting` and Account only, not on every screen.**
  _Why:_ a footer on each signed-in screen would compete with the bottom nav and docked Save
  (#238, #240); Account is one reachable entry for members, and the other two are where a
  person has not yet agreed to anything. Issue #273 asked for this choice and its reason. The
  link has no prefetch (a background auth request beside the CSRF cookie, #150, #151).
- **D-273-9 · `/privacy` is public, in `PUBLIC_PATHS` but not `PWA_PATHS`.** Extends D-16-1.
  _Why:_ it is owed before sign-in, yet it is not a PWA file: the proxy still runs `auth()`
  and marks it `no-store`, and it renders per request (`connection()`) because the operator
  comes from config, which `next build` never reads (D-13-4).
- **D-273-10 · `privacy` is a required config section, with no default and custom
  messages.** Extends D-75-4 and D-75-5. _Why:_ a default would ship a policy naming nobody;
  the messages name the key, never a value. A build without #273 refuses the key as unknown,
  so the block must reach production `CONFIG_YAML` in the same sitting as the promotion that
  brings #273 to `main` (README).
- **D-273-11 · Erasure supersedes D-117-4 and D-117-33 for personal data, on a request or at
  expiry, and is the exception to D-07-1 and D-07-2.** Effective with the erasure PR; the
  soft-delete rules and the never-overwritten history stand until then and for everything not
  erased. _Why:_ owner decision in #273: a soft-deleted row still holding a name, contact or
  religion does not meet the PDPA. _Supersedes D-117-4 and D-117-33 in part._
- **D-273-12 · An unapproved account is never sent to `/waiting` from a public path.**
  `AccountGate` skips every public path (`/sign-in` and the PWA paths too, not only
  `/privacy`). Extends D-249-22 and D-249-36; D-249-10's "one screen it may use" now includes
  `/privacy`; a refinement of D-249-11. _Why:_ a waiting account must be able to read the
  policy.
- **D-273-13 · `SyncProvider` treats `/privacy` as public yet not a sign-out
  (`isPrivacyPath`).** Refines D-33-1's sign-out rule, and refines the plan, which had the
  queue idle on `/privacy`. The queue keeps running and the confirmed member stays. _Why:_ a
  member reads the policy mid-session; leaving the page is not signing out (D-32-8's public
  paths are unaffected).
- **D-273-14 · The policy's figures live in `src/lib/privacy/policy.ts`** (date, sections,
  periods, response times, restore window), so a compliance review changes a number once.
  _Why:_ the prose and its tests then cannot drift.
- **D-273-15 · The policy states only what the code does.** Sign-in records and logs 30 days
  after last use, rate-limit counts in memory for minutes, phone copies as D-33 and D-129 keep
  them (unsent records stay until sent; signing out does not drop them). _Why:_ the
  reviewers found claims the code did not meet (eaf34e2, 2f28b6b).

## Relies on

D-07-1, D-07-2, D-13-4, D-16-1, D-16-2, D-32-8, D-33-1, D-75-4, D-75-5, D-117-4, D-117-33,
D-249-10, D-249-11, D-249-22, D-249-36.

## Open questions

- **Conflicts the owner has not yet agreed to supersede.** The policy and erasure text
  contradict, and D-273-11 does not cover:
  - D-29-3, "deactivated users excluded unless asked for, never deleted", against the policy
    deleting an account 12 months after the member leaves.
  - D-33-2, "nothing unsent is ever dropped", against erasure "covering copies on phones".
  - D-123-6's premise, "nothing deletes a visit", against erasure deleting visits.
    If both stand the erasure PR breaks these; each needs a `Supersedes` from the owner, or a
    carve-out stated in D-273-11. They are not struck yet.
- The builder's list of decisions 1 to 9 was not supplied to this step; D-273-8 to D-273-15
  are taken from the three commits. The builder should check them.
- Neon's restore window (D-273-6) and the DNC evidence question (D-273-2).
- Where the real operator name and DPO email go: the owner's production `CONFIG_YAML`.
