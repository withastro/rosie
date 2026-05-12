# Extra assertions for install-basic.

# Exit code and stdout substring checks. Filesystem state is handled by the
# tree diff against expected/.

assert_exit_code 0 "$(cat exit_code)"

# Skill should be reported as installed in stdout.
assert_contains stdout "my-skill"

# Agent symlink target should be the relative path back to the canonical dir.
assert_symlink_target ".claude/skills/my-skill" "../../.agents/skills/my-skill"
