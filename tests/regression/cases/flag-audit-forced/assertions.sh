assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "=== rosie audit ==="
assert_contains stdout "\"schemaVersion\":1"
