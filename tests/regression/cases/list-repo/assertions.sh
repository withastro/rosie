assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "Found 2 skill"
assert_contains stdout "alpha-skill"
assert_contains stdout "beta-skill"

# list must not actually install — no .agents/ should appear.
if [ -d ".agents" ]; then
    _fail ".agents/ should not exist after a list-repo run"
fi
