assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "main -> v1.0.0"
assert_contains stdout "Update complete: 1 updated"

# Lockfile now records the advanced ref + its peeled SHA.
assert_contains ".agents/rosie.lock" "v1.0.0"
assert_contains ".agents/rosie.lock" "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
assert_not_contains ".agents/rosie.lock" " main "  # the old ref column gone
