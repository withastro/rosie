assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "my-skill"
assert_symlink_target ".claude/skills/my-skill" "../../.agents/skills/my-skill"

# Lockfile must record pin (not auto) for an @ref install.
assert_contains ".agents/rosie.lock" " pin skill"
