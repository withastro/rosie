assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "Installed 1 skill"
assert_file_exists ".agents/skills/my-skill/SKILL.md"
assert_symlink_target ".claude/skills/my-skill" "../../.agents/skills/my-skill"

# Lockfile must not have been written.
if [ -f ".agents/rosie.lock" ]; then
    _fail "rosie.lock should not exist when --no-lockfile is set"
fi
