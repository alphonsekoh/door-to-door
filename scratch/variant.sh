#!/usr/bin/env bash
# Scratch only (draft PR, never merged): sets up the code one matrix job
# tests. "sha:<commit>" checks that commit out whole, keeping only this
# folder and the E2E diag fixture, so an older build runs on today's runner.
set -euo pipefail
case "$1" in
  base) ;;
  sha:*)
    sha="${1#sha:}"
    keep="$RUNNER_TEMP/keep"
    mkdir -p "$keep"
    cp -r scratch "$keep/"
    cp e2e/fixtures.ts "$keep/fixtures.ts"
    git checkout -q --detach "$sha"
    cp -r "$keep/scratch" .
    cp "$keep/fixtures.ts" e2e/fixtures.ts
    git log --oneline -1
    ;;
  noglass)
    sed -i '/^  -webkit-backdrop-filter: blur(24px) saturate(180%);$/d; /^  backdrop-filter: blur(24px) saturate(180%);$/d' src/app/globals.css
    ;;
  *) echo "unknown variant $1"; exit 1 ;;
esac
git status --short
if [ "$1" != base ] && [ -z "$(git status --porcelain)" ] && [[ "$1" != sha:* ]]; then
  echo "variant $1 changed nothing"
  exit 1
fi
