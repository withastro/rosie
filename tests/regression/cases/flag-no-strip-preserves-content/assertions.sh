assert_exit_code 0 "$(cat exit_code)"
ref=".agents/references/fake-org-hostile/REFERENCE.md"
assert_file_exists "$ref"
# With --no-strip the hostile tokens that the default install would scrub
# must survive verbatim.
assert_contains "$ref" "ROSIE_TEST_HOSTILE_HTML_COMMENT"
assert_contains "$ref" "ROSIE_TEST_LINK_FORM_COMMENT"
# Zero-width must also be preserved.
if ! grep -q $'\xe2\x80\x8b' "$ref"; then
    _fail "U+200B was stripped despite --no-strip"
fi
