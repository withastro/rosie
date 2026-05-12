assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "Update complete: 1 updated"

# Only my-skill was named, so alpha-skill must still carry its stale 9999 SHA.
assert_contains ".agents/rosie.lock" "9999999999999999999999999999999999999999"
# And my-skill's stale 0000 SHA must be gone.
assert_not_contains ".agents/rosie.lock" "0000000000000000000000000000000000000000"
assert_contains ".agents/rosie.lock" "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
