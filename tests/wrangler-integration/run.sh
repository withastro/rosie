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
#   Level 2 (e2e)       builds the real `wrangler` from the workers-sdk source
#                       with rosie-skills overridden to this checkout's build,
#                       so OUR rosie is bundled into wrangler-dist/cli.js, then
#                       runs the real `wrangler setup --install-skills` binary.
#
# Why a source build: wrangler no longer keeps rosie-skills as a runtime
# dependency. It bundles rosie into wrangler-dist/cli.js with esbuild at its
# own build time (rosie-skills is a devDependency). So a published wrangler
# carries a frozen rosie snapshot, and an `overrides` against an installed
# wrangler can't reach it. To exercise THIS branch's rosie end to end we have
# to reproduce wrangler's build with a pnpm override pointing at our build.
# See design/wrangler-integration-testing.md.
#
# Both drive rosie at the mock GitHub server used by the regression suite
# (tests/regression/lib/mock_server.py), so no real github.com traffic. Level 2
# needs git + npm-registry access (clone workers-sdk, pnpm install its tree).
#
# Usage:
#   ./run.sh                        # both levels
#   ./run.sh --no-e2e               # contract only (fully offline)
#   ./run.sh --workers-sdk-ref X    # clone ref/branch/tag (default: main)
#   ./run.sh --port 8788            # mock server port
#   ./run.sh --keep-tmp             # keep scratch dirs for inspection
#
# Env equivalents: SKIP_E2E=1, WORKERS_SDK_REF=X, PORT=N, KEEP_TMP=1.

set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
PKG="$REPO_ROOT/npm/rosie-skills"

PORT="${PORT:-8788}"
WORKERS_SDK_REF="${WORKERS_SDK_REF:-main}"
SKIP_E2E="${SKIP_E2E:-0}"
KEEP_TMP="${KEEP_TMP:-0}"

while [ $# -gt 0 ]; do
    case "$1" in
        --no-e2e) SKIP_E2E=1; shift ;;
        --workers-sdk-ref) WORKERS_SDK_REF="$2"; shift 2 ;;
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
    note "Level 2: e2e (build wrangler@$WORKERS_SDK_REF from source + local rosie-skills)"
    e2e="$(mktmp)"
    ws="$(mktmp)"
    mkdir -p "$e2e/home/.claude" "$e2e/project"

    # Clone the workers-sdk monorepo. Blobless + shallow keeps it lean; we only
    # build the wrangler package and its workspace deps.
    note "Cloning workers-sdk ($WORKERS_SDK_REF)"
    if ! git clone --filter=blob:none --depth 1 --branch "$WORKERS_SDK_REF" \
            https://github.com/cloudflare/workers-sdk.git "$ws" \
            >"$e2e/clone.log" 2>&1; then
        echo "--- git clone log (tail) ---" >&2
        tail -20 "$e2e/clone.log" >&2
        fail "e2e: git clone workers-sdk failed (use --no-e2e to run offline)"
    else
        # Pin rosie-skills to this checkout's build via a pnpm override on the
        # monorepo root. Wrangler bundles rosie at build time, so this is what
        # gets baked into wrangler-dist/cli.js.
        node -e '
          const fs = require("fs");
          const [pkgPath, pkgDir] = process.argv.slice(1);
          const p = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
          p.pnpm = p.pnpm || {};
          p.pnpm.overrides = Object.assign({}, p.pnpm.overrides, { "rosie-skills": "file:" + pkgDir });
          fs.writeFileSync(pkgPath, JSON.stringify(p, null, 2));
        ' "$ws/package.json" "$PKG"

        # Put a corepack-managed `pnpm` on PATH. turbo shells out to the package
        # manager binary to run each build task, and wrangler's build script
        # calls `pnpm` directly; both need a resolvable `pnpm`. CI has no global
        # one (only corepack's on-demand shim), so materialise it here.
        PNPM_SHIM_DIR="$(mktmp)"
        corepack enable --install-directory "$PNPM_SHIM_DIR" pnpm >/dev/null 2>&1 || true
        export PATH="$PNPM_SHIM_DIR:$PATH"

        # corepack runs the pnpm version pinned in workers-sdk's packageManager
        # field. Skip browser downloads pulled in by transitive workspace deps.
        # --no-frozen-lockfile: pnpm defaults to a frozen lockfile under CI=1,
        # but our injected `overrides` intentionally diverges from the committed
        # lockfile, so let pnpm reconcile it.
        note "Installing wrangler deps (pnpm; this is large)"
        if ! ( cd "$ws" && \
               PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=1 \
               corepack pnpm install --filter wrangler... --no-frozen-lockfile --config.confirmModulesPurge=false \
             ) >"$e2e/install.log" 2>&1; then
            echo "--- pnpm install log (tail) ---" >&2
            tail -20 "$e2e/install.log" >&2
            fail "e2e: pnpm install failed (use --no-e2e to run offline)"
        else
            # turbo builds wrangler's workspace deps then wrangler itself. The
            # DTS (type-declaration) step can fail on an unrelated undici type
            # mismatch, but the CJS bundle still builds, so tolerate the exit
            # code and assert on the artifact instead.
            note "Building wrangler (turbo; DTS step may fail harmlessly)"
            ( cd "$ws" && SOURCEMAPS=false corepack pnpm turbo build --filter=wrangler ) \
                >"$e2e/build.log" 2>&1 || true

            WDIST="$ws/packages/wrangler/wrangler-dist"
            WBIN="$WDIST/cli.js"
            META="$WDIST/metafile-cjs.json"
            if [ ! -f "$WBIN" ]; then
                echo "--- build log (tail) ---" >&2
                tail -30 "$e2e/build.log" >&2
                fail "e2e: wrangler bundle not produced ($WBIN)"
            elif ! grep -q "rosie-skills@file" "$META" 2>/dev/null; then
                # The bundled rosie must trace back to our file: override, not a
                # registry copy. esbuild records its inputs in the metafile.
                fail "e2e: bundled rosie-skills is not the local build (override did not take)"
            else
                note "Running: wrangler setup --install-skills --dry-run --yes"
                OUT="$e2e/wrangler.log"
                # Skills install runs in the command wrapper before the command
                # body, so assert on disk regardless of setup's own exit code.
                # CI=1 + metrics off keep wrangler non-interactive and off the
                # network.
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
                    pass "e2e: source-built wrangler installed cloudflare/skills"
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
