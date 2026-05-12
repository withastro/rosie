assert_exit_code 255 "$(cat exit_code)"
assert_contains stderr "not found as branch or tag"
assert_contains stderr "Failed to download package"

# No project state should be left behind.
if [ -d ".agents" ]; then
    _fail ".agents/ should not exist after failed download"
fi
