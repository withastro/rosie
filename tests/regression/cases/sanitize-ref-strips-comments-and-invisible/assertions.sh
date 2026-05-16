assert_exit_code 0 "$(cat exit_code)"
ref=".agents/references/fake-org-hostile/REFERENCE.md"
assert_file_exists "$ref"

# HTML comment outside any fence: stripped.
assert_not_contains "$ref" "ROSIE_TEST_HOSTILE_HTML_COMMENT"
assert_not_contains "$ref" "<!-- ROSIE_TEST_HOSTILE_HTML_COMMENT"

# Link-form comment: stripped.
assert_not_contains "$ref" "ROSIE_TEST_LINK_FORM_COMMENT"

# Comment inside a fenced code block: preserved.
assert_contains "$ref" "ROSIE_TEST_FENCED_PRESERVED"

# Invisible Unicode codepoints: absent. Grep the raw UTF-8 bytes.
if grep -q $'\xe2\x80\x8b' "$ref"; then
    _fail "U+200B (zero-width space) still present in $ref"
fi
