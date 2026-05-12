#!/usr/bin/env bash
# Regression test runner for rosie.
#
# For each case under cases/, runs the case's run.sh in an isolated tmpdir
# (controlled HOME, mock server as github.com), then compares the resulting
# project tree against the case's expected/ directory and runs the case's
# optional assertions.sh for extra checks.
#
# Usage:
#   ./run.sh                              # native: target/release/rosie
#   ./run.sh --mode wasm                  # wasm: bin.js + ROSIE_FORCE_WASM=1
#   ./run.sh install-basic                # run only matching cases
#   ./run.sh --binary /path/to/rosie      # use a custom rosie binary
#   ./run.sh --port 9876                  # mock server port (default 8765)
#   ./run.sh --keep-tmp                   # keep tmpdirs for inspection

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"

# Defaults
ROSIE_BINARY="$REPO_ROOT/target/release/rosie"
MODE="native"
MOCK_PORT=8765
KEEP_TMP=0
CASE_FILTER=""

while [ $# -gt 0 ]; do
    case "$1" in
        --binary) ROSIE_BINARY="$2"; MODE="custom"; shift 2 ;;
        --mode)   MODE="$2"; shift 2 ;;
        --port)   MOCK_PORT="$2"; shift 2 ;;
        --keep-tmp) KEEP_TMP=1; shift ;;
        -h|--help)
            sed -n '2,17p' "$0"; exit 0 ;;
        --) shift; break ;;
        -*) echo "unknown flag: $1" >&2; exit 2 ;;
        *) CASE_FILTER="$1"; shift ;;
    esac
done

# --mode wasm: drive the wasm CLI through the npm package's bin.js.
if [ "$MODE" = "wasm" ]; then
    ROSIE_BINARY="$HERE/lib/rosie-wasm"
fi

if [ ! -x "$ROSIE_BINARY" ]; then
    echo "rosie binary not found or not executable: $ROSIE_BINARY" >&2
    case "$MODE" in
        native|custom) echo "build first: (cd $REPO_ROOT && cargo build --release)" >&2 ;;
        wasm)          echo "build first: (cd $REPO_ROOT/wasm && ./build.sh) && (cd $REPO_ROOT/npm/rosie-skills && npm install && npm run build)" >&2 ;;
    esac
    exit 2
fi
# Canonicalize so per-case scripts running in a tmpdir still find the binary.
ROSIE_BINARY="$(cd "$(dirname "$ROSIE_BINARY")" && pwd)/$(basename "$ROSIE_BINARY")"

# Load assertion + tree-diff helpers.
# shellcheck source=lib/assert.sh
. "$HERE/lib/assert.sh"
# shellcheck source=lib/diff_tree.sh
. "$HERE/lib/diff_tree.sh"

# --- mock server lifecycle ----------------------------------------------------

FIXTURE_ROOT="$HERE/fixtures/repos"
# The tarball fixtures are generated, not checked in. Build them if any are
# missing — first run on CI / a fresh clone won't have them.
if [ ! -f "$FIXTURE_ROOT/fake-org/skills/archive/refs/heads/main.tar.gz" ]; then
    "$HERE/fixtures/build.sh" >/dev/null
fi
mkdir -p "$FIXTURE_ROOT"

MOCK_LOG="/tmp/rosie-mock-server.log"
: > "$MOCK_LOG"
python3 "$HERE/lib/mock_server.py" \
    --port "$MOCK_PORT" \
    --root "$FIXTURE_ROOT" \
    >"$MOCK_LOG" 2>&1 &
MOCK_PID=$!

cleanup() {
    if [ -n "${MOCK_PID:-}" ]; then
        kill "$MOCK_PID" 2>/dev/null || true
        wait "$MOCK_PID" 2>/dev/null || true
    fi
    # Keep MOCK_LOG so test failures can be diagnosed.
}
trap cleanup EXIT INT TERM

# Wait for the server to come up. curl writes "000" via -w on connect failure
# (and exits 7); we just retry until we see anything else.
code=000
for _ in $(seq 1 50); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$MOCK_PORT/" 2>/dev/null) \
        || code=000
    if [ "$code" != "000" ] && [ "$code" -lt 500 ]; then
        break
    fi
    sleep 0.1
done
if [ "$code" = "000" ] || [ "$code" -ge 500 ]; then
    echo "mock server did not start (http_code=$code); log:" >&2
    cat "$MOCK_LOG" >&2
    exit 2
fi

# --- case discovery + execution ----------------------------------------------

TOTAL_CASES=0
TOTAL_FAILURES=0
FAILED_CASES=()

for case_dir in "$HERE/cases"/*/; do
    case_name="$(basename "$case_dir")"
    if [ -n "$CASE_FILTER" ] && ! printf '%s' "$case_name" | grep -q -F -- "$CASE_FILTER"; then
        continue
    fi
    if [ ! -f "$case_dir/run.sh" ]; then
        continue
    fi

    TOTAL_CASES=$((TOTAL_CASES + 1))

    # Per-case state (read by lib/assert.sh)
    CASE_NAME="$case_name"
    CASE_FAILURES=0

    # Isolated tmpdir: $tmp/home (HOME) and $tmp/project (cwd for the case).
    tmp=$(mktemp -d)
    mkdir -p "$tmp/home" "$tmp/project"

    # Common env every case gets. The case's run.sh may set up further state
    # (e.g. fake agent dirs under HOME, .agents/rosie.lock to drive reinstall).
    export ROSIE="$ROSIE_BINARY"
    export ROSIE_GITHUB_BASE_URL="http://127.0.0.1:$MOCK_PORT"
    export HOME="$tmp/home"
    export FIXTURE_ROOT
    export CASE_DIR="$case_dir"
    export PROJECT_DIR="$tmp/project"

    (
        # Subshells inherit the parent's EXIT trap; without clearing it here,
        # the trap fires when this subshell exits and tears down the mock
        # server before the next case runs.
        trap - EXIT INT TERM
        cd "$tmp/project"
        # The case's run.sh writes:
        #   stdout, stderr, exit_code     — captured by run.sh itself
        # so its assertions.sh can inspect them.
        # shellcheck source=/dev/null
        . "$case_dir/run.sh"
    )

    # Run extra assertions if the case defines them.
    if [ -f "$case_dir/assertions.sh" ]; then
        # shellcheck source=/dev/null
        (
            trap - EXIT INT TERM
            cd "$tmp/project" && . "$HERE/lib/assert.sh" && . "$case_dir/assertions.sh"
        )
        # The subshell can't mutate CASE_FAILURES in our process; we read its
        # exit code instead. assertions.sh should `exit 1` after any _fail.
        sub_rc=$?
        if [ "$sub_rc" -ne 0 ]; then
            CASE_FAILURES=$((CASE_FAILURES + 1))
        fi
    fi

    # Tree diff against expected/.
    if [ -d "$case_dir/expected" ]; then
        compare_trees "$case_dir/expected" "$tmp/project"
    fi

    if [ "$CASE_FAILURES" -eq 0 ]; then
        printf '  \e[32mPASS\e[0m %s\n' "$case_name"
    else
        printf '  \e[31mFAIL\e[0m %s (%d failure(s))\n' "$case_name" "$CASE_FAILURES"
        TOTAL_FAILURES=$((TOTAL_FAILURES + CASE_FAILURES))
        FAILED_CASES+=("$case_name")
        # Dump captured rosie output to help diagnose CI failures. Per-case
        # run.sh scripts write to stdout/stderr/exit_code in $tmp/project.
        for f in stdout stderr exit_code; do
            if [ -s "$tmp/project/$f" ]; then
                printf '    ===== %s =====\n' "$f"
                sed 's/^/    /' "$tmp/project/$f"
            fi
        done
    fi

    if [ "$KEEP_TMP" -eq 1 ]; then
        echo "    tmpdir: $tmp"
    else
        rm -rf "$tmp"
    fi
done

echo
if [ "$TOTAL_FAILURES" -eq 0 ]; then
    printf '\e[32mAll %d case(s) passed.\e[0m\n' "$TOTAL_CASES"
    exit 0
else
    printf '\e[31m%d failure(s) across %d case(s):\e[0m\n' "$TOTAL_FAILURES" "${#FAILED_CASES[@]}"
    for c in "${FAILED_CASES[@]}"; do printf '  - %s\n' "$c"; done
    exit 1
fi
