# #36 · Close coverage gaps

- **Status:** Open
- **Phase:** 7 - Hardening

## Task

Sweep after features land. Thresholds have been met on every PR so far, so this is
mainly about test quality: no test exists only to touch a line.

## Decisions

None yet.

## Relies on

D-04-2, D-12-5.

## Candidate

Integration tests report "No test files found" without `TEST_DATABASE_URL` (was `DATABASE_URL`, D-75-13), which misleads
locally. Consider failing with the D-06-3 message instead.
