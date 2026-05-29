#!/usr/bin/env bash
# Integration tests for rosie-skills as consumed by wrangler.
#
# Wrangler (cloudflare/workers-sdk) uses rosie-skills as an external (unbundled)
# library: on `wrangler setup --install-skills` it calls rosie.agents() then
# rosie.install("cloudflare/skills", { global, agent, lockfile: false }). These
# tests verify that seam keeps working against the locally built package.
#
# Two levels:
#   Level 1 (contract)  hermetic. Imports the built rosie-skills by bare
#                       specifier and replicates wrangler's exact glue.
#   Level 2 (e2e)       installs the real `wrangler` from npm with rosie-skills
#                       overridden to the local build, then runs the real
#                       `wrangler setup --install-skills` binary.
#
# Both drive rosie at the mock GitHub server used by the regression suite
# (tests/regression/lib/mock_server.py), so no real github.com traffic. Level 2
# does need npm registry access to install wrangler.
#
# Usage:
#   ./run.sh                       # both levels
#   ./run.sh --no-e2e              # contract only (fully offline)
#   ./run.sh --wrangler-version X  # pin the wrangler version (default: latest)
#   ./run.sh --port 8788           # mock server port
#   ./run.sh --keep-tmp            # keep scratch dirs for inspection
#
# Env equivalents: SKIP_E2E=1, WRANGLER_VERSION=X, PORT=N, KEEP_TMP=1.

set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
PKG="$REPO_ROOT/npm/rosie-skills"

PORT="${PORT:-8788}"
WRANGLER_VERSION="${WRANGLER_VERSION:-latest}"
SKIP_E2E="${SKIP_E2E:-0}"
KEEP_TMP="${KEEP_TMP:-0}"

while [ $# -gt 0 ]; do
    case "$1" in
        --no-e2e) SKIP_E2E=1; shift ;;
        --wrangler-version) WRANGLER_VERSION="$2"; shift 2 ;;
        --port) PORT="$2"; shift 2 ;;
        --keep-tmp) KEEP_TMP=1; shift ;;
        -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
        *) echo "unknown flag: $1" >&2; exit 2 ;;
    esac
done

PASS=0
FAIL=0
TMPDIRS=()

note()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
pass()  { printf '  \033[32mPASS\033[0m  %s\n' "$*"; PASS=$((PASS+1)); }
fail()  { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; FAIL=$((FAIL+1)); }
skip()  { printf '  \033[33mSKIP\033[0m  %s\n' "$*"; }

mktmp() { local d; d=$(mktemp -d); TMPDIRS+=("$d"); printf '%s' "$d"; }

# ---- prerequisites ---------------------------------------------------------

# Build the rosie-skills dist if missing (Level 1 imports it; Level 2 file:-installs it).
if [ ! -f "$PKG/dist/index.js" ]; then
    note "Building rosie-skills dist"
    (cd "$PKG" && npm install --silent && npm run build) || { echo "rosie-skills build failed" >&2; exit 2; }
fi

# Build the mock-server fixtures if the cloudflare/skills tarball is missing.
FIXTURE_ROOT="$REPO_ROOT/tests/regression/fixtures/repos"
if [ ! -f "$FIXTURE_ROOT/cloudflare/skills/archive/refs/heads/main.tar.gz" ]; then
    note "Building test fixtures"
    "$REPO_ROOT/tests/regression/fixtures/build.sh" >/dev/null || { echo "fixture build failed" >&2; exit 2; }
fi

# ---- mock server -----------------------------------------------------------

MOCK_LOG="$(mktemp)"
python3 "$REPO_ROOT/tests/regression/lib/mock_server.py" \
    --port "$PORT" --root "$FIXTURE_ROOT" >"$MOCK_LOG" 2>&1 &
MOCK_PID=$!

cleanup() {
    [ -n "${MOCK_PID:-}" ] && { kill "$MOCK_PID" 2>/dev/null || true; wait "$MOCK_PID" 2>/dev/null || true; }
    if [ "$KEEP_TMP" = "1" ]; then
        [ "${#TMPDIRS[@]}" -gt 0 ] && printf 'kept tmpdir: %s\n' "${TMPDIRS[@]}"
    else
        [ "${#TMPDIRS[@]}" -gt 0 ] && rm -rf "${TMPDIRS[@]}"
    fi
    rm -f "$MOCK_LOG"
}
trap cleanup EXIT INT TERM

# Wait for the mock server to accept connections.
code=000
for _ in $(seq 1 50); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null) || code=000
    [ "$code" != "000" ] && [ "$code" -lt 500 ] && break
    sleep 0.1
done
if [ "$code" = "000" ] || [ "$code" -ge 500 ]; then
    echo "mock server did not start (http_code=$code); log:" >&2
    cat "$MOCK_LOG" >&2
    exit 2
fi

BASE_URL="http://127.0.0.1:$PORT"

# ---- Level 1: contract -----------------------------------------------------

note "Level 1: contract (bare-specifier import + wrangler glue)"
scratch="$(mktmp)"
mkdir -p "$scratch/node_modules" "$scratch/home/.claude"
ln -s "$PKG" "$scratch/node_modules/rosie-skills"
cp "$HERE/contract.mjs" "$scratch/contract.mjs"

if HOME="$scratch/home" PORT="$PORT" node "$scratch/contract.mjs"; then
    : # contract.mjs prints its own PASS line
    PASS=$((PASS+1))
else
    fail "contract"
fi

# ---- Level 2: real wrangler end-to-end -------------------------------------

if [ "$SKIP_E2E" = "1" ]; then
    note "Level 2: e2e (skipped: --no-e2e / SKIP_E2E=1)"
    skip "e2e"
else
    note "Level 2: e2e (wrangler@$WRANGLER_VERSION + local rosie-skills)"
    e2e="$(mktmp)"
    mkdir -p "$e2e/home/.claude" "$e2e/project"

    # Force every rosie-skills in the tree to the local build via overrides,
    # so wrangler's `^x.y.z` requirement can't pull the published package.
    cat > "$e2e/package.json" <<JSON
{
  "name": "rosie-wrangler-e2e",
  "private": true,
  "version": "0.0.0",
  "dependencies": {
    "wrangler": "$WRANGLER_VERSION"
  },
  "overrides": {
    "rosie-skills": "file:$PKG"
  }
}
JSON

    note "Installing wrangler (npm)"
    if ! (cd "$e2e" && npm install --no-audit --no-fund --silent >"$e2e/npm-install.log" 2>&1); then
        echo "--- npm install log (tail) ---" >&2
        tail -20 "$e2e/npm-install.log" >&2
        fail "e2e: npm install failed (use --no-e2e to run offline)"
    else
        WBIN="$e2e/node_modules/wrangler/bin/wrangler.js"
        # Confirm the override took: the only rosie-skills in the tree must be
        # our local build. Its version (0.0.0) is the sentinel — the published
        # package is ^0.7.6 — and `overrides` hoists it to the top level with no
        # nested copy under wrangler, so wrangler's ESM import resolves to it.
        # (Read package.json by file path; the package's `exports` map has no
        # `./package.json` entry, so a bare `require.resolve` would be blocked.)
        RS_PKGJSON="$e2e/node_modules/rosie-skills/package.json"
        RS_VERSION="$(node -e 'try{process.stdout.write(String(require(process.argv[1]).version||""))}catch{}' "$RS_PKGJSON" 2>/dev/null)"
        NESTED="$(find "$e2e/node_modules" -mindepth 2 -type d -name rosie-skills 2>/dev/null | head -1)"
        if [ ! -f "$WBIN" ]; then
            fail "e2e: wrangler bin not found at $WBIN"
        elif [ "$RS_VERSION" != "0.0.0" ]; then
            fail "e2e: top-level rosie-skills is not the local build (version=${RS_VERSION:-none}, expected 0.0.0)"
        elif [ -n "$NESTED" ]; then
            fail "e2e: a nested rosie-skills copy exists, override did not dedupe ($NESTED)"
        else
            note "Running: wrangler setup --install-skills --dry-run --yes"
            OUT="$e2e/wrangler.log"
            # Skills install runs in the command wrapper before the command body,
            # so assert on disk regardless of setup's own exit code. CI=1 +
            # metrics off keep wrangler non-interactive and off the network.
            ( cd "$e2e/project" && \
              HOME="$e2e/home" \
              ROSIE_GITHUB_BASE_URL="$BASE_URL" \
              WRANGLER_SEND_METRICS="false" \
              CI="1" \
              timeout 180 node "$WBIN" setup --install-skills --dry-run --yes ) \
              >"$OUT" 2>&1 || true

            ok=1
            for skill in cloudflare-workers cloudflare-pages; do
                if [ ! -f "$e2e/home/.claude/skills/$skill/SKILL.md" ]; then
                    ok=0
                    echo "      missing: $e2e/home/.claude/skills/$skill/SKILL.md" >&2
                fi
            done

            if [ "$ok" = "1" ]; then
                pass "e2e: wrangler setup --install-skills installed cloudflare/skills"
                if grep -q "Successfully installed Cloudflare skills" "$OUT"; then
                    pass "e2e: wrangler reported success"
                else
                    skip "e2e: success line not found (skills present on disk; see $OUT)"
                fi
            else
                echo "--- wrangler output (tail) ---" >&2
                tail -30 "$OUT" >&2
                fail "e2e: skills not installed to sandbox HOME"
            fi
        fi
    fi
fi

# ---- summary ---------------------------------------------------------------

echo
if [ "$FAIL" -eq 0 ]; then
    printf '\033[32mAll checks passed (%d).\033[0m\n' "$PASS"
    exit 0
else
    printf '\033[31m%d failure(s), %d passed.\033[0m\n' "$FAIL" "$PASS"
    exit 1
fi
