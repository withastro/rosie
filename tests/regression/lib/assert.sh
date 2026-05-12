# Assertion helpers for regression tests.
#
# Sourced by run.sh and by each case's assertions.sh. Each assertion logs the
# failure with context, increments a counter, and continues — we want to see
# all failures in a case, not just the first.

# Reset per-case. The outer runner zeroes these before invoking each case.
: "${CASE_FAILURES:=0}"
: "${CASE_NAME:=unknown}"

_fail() {
    CASE_FAILURES=$((CASE_FAILURES + 1))
    printf '  \e[31mFAIL\e[0m %s: %s\n' "$CASE_NAME" "$*" >&2
}

assert_eq() {
    # assert_eq <actual> <expected> <message>
    if [ "$1" != "$2" ]; then
        _fail "$3 (expected '$2', got '$1')"
    fi
}

assert_exit_code() {
    # assert_exit_code <expected> <actual>
    if [ "$2" != "$1" ]; then
        _fail "exit code: expected $1, got $2"
    fi
}

assert_file_exists() {
    if [ ! -f "$1" ]; then
        _fail "expected file does not exist: $1"
    fi
}

assert_dir_exists() {
    if [ ! -d "$1" ]; then
        _fail "expected directory does not exist: $1"
    fi
}

assert_symlink_exists() {
    if [ ! -L "$1" ]; then
        _fail "expected symlink does not exist: $1"
    fi
}

assert_symlink_target() {
    # assert_symlink_target <link> <expected_target>
    if [ ! -L "$1" ]; then
        _fail "$1 is not a symlink"
        return
    fi
    actual=$(readlink "$1")
    if [ "$actual" != "$2" ]; then
        _fail "symlink $1: expected target '$2', got '$actual'"
    fi
}

assert_contains() {
    # assert_contains <file> <needle>
    if ! grep -q -F -- "$2" "$1"; then
        _fail "$1 does not contain: $2"
    fi
}

assert_not_contains() {
    if grep -q -F -- "$2" "$1"; then
        _fail "$1 should not contain: $2"
    fi
}
