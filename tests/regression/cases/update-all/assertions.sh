assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "SHA changed"
assert_contains stdout "Update complete: 1 updated"

# Lockfile must now have the refreshed SHA.
assert_contains ".agents/rosie.lock" "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
assert_not_contains ".agents/rosie.lock" "0000000000000000000000000000000000000000"
