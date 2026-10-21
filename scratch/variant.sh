#!/usr/bin/env bash
# Scratch only (draft PR, never merged): applies one candidate revert on top of
# the branch head before the build, so each matrix job tests one cause.
set -euo pipefail
case "$1" in
  base) ;;
  nobalance) sed -i 's/text-balance break-words/break-words/g' src/components/page-header.tsx ;;
  nobreak) sed -i 's/text-balance break-words/text-balance/g' src/components/page-header.tsx ;;
  nolargetext) git rm -q e2e/large-text.spec.ts ;;
  noscrim) sed -i 's/scrimOpacity(offset, panel.current?.offsetHeight ?? 0)/scrimOpacity(offset, 600)/' src/components/sheet.tsx ;;
  *) echo "unknown variant $1"; exit 1 ;;
esac
git status --short
if [ "$1" != base ] && [ -z "$(git status --porcelain -- src e2e)" ]; then
  echo "variant $1 changed nothing"
  exit 1
fi
git diff --stat HEAD -- src e2e
