#!/usr/bin/env bash
# Decides whether CI's E2E job runs (#248): into stage or main always, and
# elsewhere only with the e2e label. Reads the pull request's base, then each
# label, one per line, as the API returns them while the run's first job runs,
# and prints e2e=true or e2e=false for $GITHUB_OUTPUT. Names compare ignoring
# case, as GitHub's expressions do. It fails closed: no base is e2e=true.
set -euo pipefail
shopt -s nocasematch

base=
IFS= read -r base || true

e2e=false
case $base in
  stage | main | "") e2e=true ;;
esac
while IFS= read -r label || [ -n "$label" ]; do
  if [[ $label == e2e ]]; then
    e2e=true
  fi
done

echo "e2e=$e2e"
