assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "symlink -> 2 agent(s)"
assert_symlink_target ".claude/skills/my-skill" "../../.agents/skills/my-skill"
assert_symlink_target ".cursor/skills/my-skill" "../../.agents/skills/my-skill"

# The codex agent dir was planted in HOME but should NOT receive a symlink
# because -a restricts to claude+cursor.
if [ -e ".codex/skills/my-skill" ]; then
    _fail ".codex/skills/my-skill should not exist when -a restricts to claude+cursor"
fi
