assert_exit_code 0 "$(cat exit_code)"

# Both planted agents should appear in the "Detected agents:" section.
assert_contains stdout "Detected agents:"
assert_contains stdout "Claude Code"
assert_contains stdout "Cursor"

# And the full supported list should be present.
assert_contains stdout "Supported agents:"
