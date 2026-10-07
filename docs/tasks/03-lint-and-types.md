# #3 · ESLint, Prettier and strict TypeScript

- **Status:** Done (PR #40)
- **Phase:** 0 - Foundation

## Task

Strict lint and type gates before any feature code, so nothing is written under looser
rules and retrofitted.

## Decisions

- **D-03-1 · `strictTypeChecked` + `stylisticTypeChecked`**, type-aware via
  `projectService`; `no-explicit-any` and `no-floating-promises` are errors.
- **D-03-2 · `type` over `interface`.** _Why:_ codegen emits type aliases; interfaces
  permit declaration merging that can silently widen a contract type.
- **D-03-3 · Compiler beyond `strict`:** `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`,
  `verbatimModuleSyntax`, and others. _Why:_ catch at compile time what tests would miss.
- **D-03-4 · Generated code is excluded from lint and format.** _Why:_ an edit there
  should stand out.
