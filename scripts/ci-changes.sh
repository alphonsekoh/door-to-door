#!/usr/bin/env bash
# Decides whether a pull request changes anything CI's tests and build could
# catch (#248). Reads the changed paths, one per line, and prints code=true or
# code=false for $GITHUB_OUTPUT.
#
# Docs are docs/, .claude/ and top-level *.md files, as in .githooks/pre-push,
# except README.md: src/dev-stack.test.ts and src/stage-stack.test.ts hold its
# sections to the stacks. It fails closed: any other path, or none, is code.
set -euo pipefail

docs='^(docs|\.claude)/|^[^/]+\.md$'

code=false
seen=false
while IFS= read -r path || [ -n "$path" ]; do
  [ -n "$path" ] || continue
  seen=true
  if [ "$path" = README.md ] || ! [[ $path =~ $docs ]]; then
    code=true
  fi
done
[ "$seen" = true ] || code=true

echo "code=$code"
