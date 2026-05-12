# Tree comparison helpers.
#
# Each case has an `expected/` directory describing the filesystem state the
# case's project tree should be in after run.sh finishes. We compare against
# `actual/` (the project tmpdir).
#
# Comparison rules:
#   - regular files: byte-identical, after normalizing the lockfile timestamps
#   - symlinks: target must match (compared via readlink)
#   - directories: must exist; recursion handles contents
#   - presence: every file in `expected/` must exist in actual; no extras
#     allowed under .agents/ (other paths may exist because tmpdir state)
#
# The lockfile's `installed_at` ISO 8601 timestamp is replaced with the
# placeholder "TIMESTAMP" before diffing.

# Replace ISO 8601 timestamps in a file with "TIMESTAMP" in-place.
normalize_lockfile_timestamps() {
    if [ -f "$1" ]; then
        # ISO 8601: YYYY-MM-DDTHH:MM:SSZ
        sed -i 's/[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}T[0-9]\{2\}:[0-9]\{2\}:[0-9]\{2\}Z/TIMESTAMP/g' "$1"
    fi
}

# Compare two trees. Walks `expected_root`, asserts each entry exists in
# `actual_root` with matching content / symlink target. Then walks
# actual_root/.agents/ to flag unexpected files.
compare_trees() {
    # compare_trees <expected_root> <actual_root>
    local expected="$1"
    local actual="$2"

    if [ ! -d "$expected" ]; then
        _fail "expected/ root not found: $expected"
        return
    fi

    # Walk expected, check each entry against actual.
    while IFS= read -r -d '' rel; do
        rel="${rel#$expected/}"
        local exp_path="$expected/$rel"
        local act_path="$actual/$rel"

        if [ -L "$exp_path" ]; then
            if [ ! -L "$act_path" ]; then
                _fail "expected symlink, missing or wrong type: $rel"
                continue
            fi
            local exp_target act_target
            exp_target=$(readlink "$exp_path")
            act_target=$(readlink "$act_path")
            if [ "$exp_target" != "$act_target" ]; then
                _fail "symlink target $rel: expected '$exp_target', got '$act_target'"
            fi
        elif [ -d "$exp_path" ]; then
            if [ ! -d "$act_path" ]; then
                _fail "expected directory missing: $rel"
            fi
        elif [ -f "$exp_path" ]; then
            if [ ! -f "$act_path" ]; then
                _fail "expected file missing: $rel"
                continue
            fi
            # Normalize lockfile timestamps before diff. Use a tmp copy of the
            # actual file so we don't mutate the test artifact.
            local cmp_actual="$act_path"
            if [ "$(basename "$rel")" = "rosie.lock" ]; then
                cmp_actual="$(mktemp)"
                cp "$act_path" "$cmp_actual"
                normalize_lockfile_timestamps "$cmp_actual"
            fi
            if ! diff -q "$exp_path" "$cmp_actual" >/dev/null 2>&1; then
                _fail "file content mismatch: $rel"
                diff -u "$exp_path" "$cmp_actual" | head -20 >&2 || true
            fi
            if [ "$cmp_actual" != "$act_path" ]; then
                rm -f "$cmp_actual"
            fi
        fi
    done < <(find "$expected" -mindepth 1 -print0)

    # Flag unexpected entries under .agents/ in actual that aren't in expected.
    if [ -d "$actual/.agents" ]; then
        while IFS= read -r -d '' rel; do
            rel="${rel#$actual/}"
            if [ ! -e "$expected/$rel" ] && [ ! -L "$expected/$rel" ]; then
                _fail "unexpected entry under .agents/: $rel"
            fi
        done < <(find "$actual/.agents" -mindepth 1 -print0)
    fi
}
