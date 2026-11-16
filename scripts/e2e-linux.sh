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
# (Ubuntu 24.04, Node 24, Playwright's Chromium and WebKit), the database is
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
# that CI, one job per runner, would never see.
lock="$common/e2e-linux.lock"
waiting=""
until mkdir "$lock" 2>/dev/null; do
  holder=$(cat "$lock/pid" 2>/dev/null || true)
  if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
    rm -rf "$lock"
    continue
  fi
  [ -n "$waiting" ] || say "another run holds $lock (pid ${holder:-starting}); waiting for it"
  waiting=1
  sleep 10
done
echo $$ >"$lock/pid"

name="d2d-e2e-$short-$$"
ctx=$(mktemp -d)
cleanup() {
  docker rm -f "$name-run" "$name-db" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
  rm -rf "$ctx" "$lock"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# The commit's own package files, so its node_modules are the ones it locks.
# Its Dockerfile too, unless it predates the e2e stage.
git show "$commit:package.json" >"$ctx/package.json"
git show "$commit:package-lock.json" >"$ctx/package-lock.json"
if git show "$commit:Dockerfile" 2>/dev/null | grep -q ' AS e2e$'; then
  git show "$commit:Dockerfile" >"$ctx/Dockerfile"
else
  cp "$root/Dockerfile" "$ctx/Dockerfile"
fi
# CI's service image, read from the workflow rather than repeated here.
pg_image=$(git show "$commit:.github/workflows/ci.yml" | sed -n 's/^ *image: *\(postgres:[^ ]*\) *$/\1/p' | head -n 1)
[ -n "$pg_image" ] || {
  say "found no postgres service image in .github/workflows/ci.yml"
  exit 1
}

platform_args=()
[ -z "$platform" ] || platform_args=(--platform "$platform")

say "building the runner image (cached after the first build)"
docker build ${platform_args[@]+"${platform_args[@]}"} --target e2e --iidfile "$ctx/iid" "$ctx" >&2
image=$(cat "$ctx/iid")

docker network create "$name" >/dev/null
docker run -d --name "$name-db" --network "$name" --tmpfs /var/lib/postgresql/data \
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
set +e
# shellcheck disable=SC2016 # expanded in the container
git archive --format=tar "$commit" | docker run --rm -i --init --ipc=host --name "$name-run" \
  ${platform_args[@]+"${platform_args[@]}"} --network "$name" \
  -e E2E_DATABASE_URL="postgresql://postgres:postgres@$name-db:5432/door_to_door_e2e" \
  -v "$out:/out" "$image" /bin/bash -c '
    tar -xf - -C /work && cd /work || exit 1
    echo "e2e-linux: sans-serif is $(fc-match -f "%{family}" sans-serif), as on CI (R-182)" >&2
    npm run test:e2e -- --reporter=line,html "$@"
    status=$?
    cp -R playwright-report test-results /out/ 2>/dev/null
    exit $status
  ' e2e-linux ${pw_args[@]+"${pw_args[@]}"}
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
