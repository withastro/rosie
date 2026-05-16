assert_exit_code 0 "$(cat exit_code)"
assert_not_contains stdout "=== rosie audit ==="
assert_not_contains stdout "schemaVersion"
