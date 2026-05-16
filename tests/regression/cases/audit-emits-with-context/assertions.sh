assert_exit_code 0 "$(cat exit_code)"
# Wrapped output: header, the json envelope, footer.
assert_contains stdout "=== rosie audit ==="
assert_contains stdout "=== end rosie audit ==="
assert_contains stdout "\"schemaVersion\":1"
assert_contains stdout "\"command\":\"install\""
# Per-skill change is present.
assert_contains stdout "\"name\":\"my-skill\""
