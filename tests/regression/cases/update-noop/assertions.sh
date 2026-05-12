assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "up to date"
assert_contains stdout "0 updated, 1 unchanged"

# Lockfile must be byte-identical to the pre-staged version (no rewrite).
assert_contains ".agents/rosie.lock" "2025-01-01T00:00:00Z"
