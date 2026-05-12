assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "Reinstalling 1 skill(s) from lockfile"
assert_contains stdout "Reinstalled 1 skill(s)"
assert_symlink_target ".claude/skills/my-skill" "../../.agents/skills/my-skill"
