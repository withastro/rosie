assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "custom-name"

# Default name fake-org-skills must NOT have been used.
if [ -d ".agents/references/fake-org-skills" ]; then
    _fail "default reference name fake-org-skills should not exist"
fi
assert_not_contains ".agents/rosie.lock" "fake-org-skills "
assert_file_exists ".agents/references/custom-name/REFERENCE.md"
