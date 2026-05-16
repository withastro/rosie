# Update may succeed (rosie applies the new SHA) or fail at the install step
# depending on download; the important thing is the finding gets emitted.
assert_contains stdout "=== rosie audit ==="
assert_contains stdout "\"kind\":\"tag_rewritten\""
assert_contains stdout "\"severity\":\"high\""
assert_contains stdout "dddddddddddddddddddddddddddddddddddddddd"
assert_contains stdout "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
