assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "Found 1 skill"
assert_contains stdout "alpha-skill"
assert_not_contains stdout "beta-skill"
assert_symlink_target ".claude/skills/alpha-skill" "../../.agents/skills/alpha-skill"

# beta-skill must NOT have been installed.
if [ -e ".agents/skills/beta-skill" ] || [ -L ".claude/skills/beta-skill" ]; then
    _fail "beta-skill should not have been installed"
fi
assert_not_contains ".agents/rosie.lock" "beta-skill"
