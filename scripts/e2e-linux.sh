#!/usr/bin/env bash
# CI's "End-to-end smoke" job, run in a Linux container on this machine (#201).
#
#   npm run test:e2e:linux                             the whole suite, on HEAD
#   npm run test:e2e:linux -- --ref <commit>           on another commit
#   npm run test:e2e:linux -- --platform linux/amd64   on CI's architecture, emulated
#   npm run test:e2e:linux -- -- <playwright args>     e.g. -- e2e/large-text.spec.ts:376
#                                                        --project=mobile-webkit --repeat-each=40
#
# It tests a commit, never the working copy: git archive feeds the container,
# so what passes is what a push sends. The image is the Dockerfile's e2e stage
# (Ubuntu 26.04, Node 24, Playwright's Chromium and WebKit), the database is
# CI's postgres service image, and both sit on a private network, so nothing
# here touches the host's ports or its Postgres. One run at a time per clone:
# a second waits for the first. A whole-suite pass is recorded by tree, which
# lets .githooks/pre-push skip a tree that has already passed.
#
# Reports land in e2e-linux-results/ (npx playwright show-report
# e2e-linux-results/playwright-report).
set -euo pipefail

ref=HEAD
platform=""
pw_args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --ref)
      ref=${2:?--ref needs a commit}
      shift 2
      ;;
    --platform)
      platform=${2:?--platform needs a value, such as linux/amd64}
      shift 2
      ;;
    --)
      shift
      pw_args=("$@")
      break
      ;;
    *)
      echo "e2e-linux: unknown option $1 (Playwright's own go after --)" >&2
      exit 2
      ;;
  esac
done

say() { echo "e2e-linux: $*" >&2; }

root=$(git rev-parse --show-toplevel)
common=$(git rev-parse --path-format=absolute --git-common-dir)
commit=$(git rev-parse --verify --quiet "$ref^{commit}") || {
  say "$ref is not a commit"
  exit 2
}
tree=$(git rev-parse "$commit^{tree}")
short=$(git rev-parse --short "$commit")

if ! docker info >/dev/null 2>&1; then
  say "Docker is not running. Start Docker Desktop and try again."
  exit 3
fi

if [ "$ref" = HEAD ] && [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  say "testing HEAD ($short) as committed; uncommitted changes are not in this run"
fi

# Serialised: two suites at once on one machine slow each other into timeouts
# that CI, one job per runner, would never see. flock(2) on fd 9, which this
# shell keeps open: the kernel lets go when the shell ends, however it ends,
# and once any child still holding fd 9 ends, which is why the long-running
# docker commands below close it.
lock="$common/e2e-linux.flock"
exec 9>>"$lock"
flock9() { perl -MFcntl=:flock -e 'open(my $fh, ">&=", 9) or die "$!\n"; exit(flock($fh, $ARGV[0]) ? 0 : 1)' "$1"; }
if ! flock9 "$(perl -MFcntl=:flock -e 'print LOCK_EX | LOCK_NB')"; then
  say "another run holds $lock; waiting for it"
  flock9 "$(perl -MFcntl=:flock -e 'print LOCK_EX')"
fi

# Whatever a run killed outright left behind in this clone.
label="door-to-door.e2e-linux=$common"
# shellcheck disable=SC2086 # one id per word
{
  stale=$(docker ps -aq --filter "label=$label")
  [ -z "$stale" ] || docker rm -f $stale >/dev/null
  stale=$(docker network ls -q --filter "label=$label")
  [ -z "$stale" ] || docker network rm $stale >/dev/null
}

name="d2d-e2e-$short-$$"
ctx=$(mktemp -d)
cleanup() {
  docker rm -f "$name-run" "$name-db" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
  rm -rf "$ctx"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# The commit's own package files, so its node_modules are the ones it locks.
# Its Dockerfile too, unless it predates the e2e stage: then this script's.
git show "$commit:package.json" >"$ctx/package.json"
git show "$commit:package-lock.json" >"$ctx/package-lock.json"
if git show "$commit:Dockerfile" 2>/dev/null | grep -q ' AS e2e$'; then
  git show "$commit:Dockerfile" >"$ctx/Dockerfile"
else
  cp "$(dirname "$0")/../Dockerfile" "$ctx/Dockerfile"
fi
# CI's service image, read from the workflow rather than repeated here.
pg_image=$(git show "$commit:.github/workflows/ci.yml" | sed -n 's/^ *image: *\(postgres:[^ ]*\) *$/\1/p' | head -n 1)
[ -n "$pg_image" ] || {
  say "found no postgres service image in .github/workflows/ci.yml"
  exit 1
}

platform_args=()
[ -z "$platform" ] || platform_args=(--platform "$platform")
# Tagged, so a rebuild leaves the last image dangling for docker image prune.
image="door-to-door-e2e:$(printf '%s' "${platform:-native}" | tr / -)"

say "building the runner image (cached after the first build)"
docker build ${platform_args[@]+"${platform_args[@]}"} --target e2e -t "$image" "$ctx" >&2 9>&-

docker network create --label "$label" "$name" >/dev/null
docker run -d --name "$name-db" --label "$label" --network "$name" --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres "$pg_image" >/dev/null
# Over TCP: the image's first-boot server listens only on its socket, so this
# answers once the real server is up.
ready=""
for _ in $(seq 1 60); do
  if docker exec "$name-db" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[ -n "$ready" ] || {
  say "postgres did not start"
  docker logs "$name-db" 2>&1 | tail -n 20 >&2
  exit 1
}

out="$root/e2e-linux-results"
rm -rf "$out"
mkdir -p "$out"

say "running on $short ${platform:-natively}${pw_args[*]+ with: ${pw_args[*]}}"
# shellcheck disable=SC2016 # expanded in the container
docker create --init --ipc=host --name "$name-run" --label "$label" \
  ${platform_args[@]+"${platform_args[@]}"} --network "$name" \
  -e E2E_DATABASE_URL="postgresql://postgres:postgres@$name-db:5432/door_to_door_e2e" \
  -v "$out:/out" -w /work "$image" /bin/bash -c '
    font=$(fc-match -f "%{family}" sans-serif)
    if [ "$font" != "DejaVu Sans" ]; then
      echo "e2e-linux: sans-serif is $font, not DejaVu Sans as on CI (R-182)" >&2
      exit 1
    fi
    npm run test:e2e -- --reporter=line,html "$@"
    status=$?
    cp -R playwright-report test-results /out/ 2>/dev/null
    exit $status
  ' e2e-linux ${pw_args[@]+"${pw_args[@]}"} >/dev/null
# Docker unpacks the commit, not tar in the container: under amd64 emulation
# the container's tar cannot create a file (ENOSYS).
git archive --format=tar "$commit" | docker cp - "$name-run:/work"
# In the background, so Ctrl-C reaches this shell's trap at once, and its
# cleanup stops the container, rather than waiting out the suite.
set +e
docker start --attach "$name-run" 9>&- &
wait $!
status=$?
set -e

if [ "$status" -ne 0 ]; then
  say "FAILED on $short. Report: npx playwright show-report e2e-linux-results/playwright-report"
  exit "$status"
fi
if [ ${#pw_args[@]} -eq 0 ]; then
  echo "$tree $commit $(date -u +%Y-%m-%dT%H:%M:%SZ) ${platform:-native}" >>"$common/e2e-linux-passed"
fi
say "passed on $short"
