assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "Linking local skill"
assert_contains stdout "my-local-skill"

# Both link layers must exist and resolve through to the staged dir.
assert_symlink_target ".agents/skills/my-local-skill" "../../my-local-skill"
assert_symlink_target ".claude/skills/my-local-skill" "../../.agents/skills/my-local-skill"

# Source must be the file:// form, not owner/repo.
assert_contains ".agents/rosie.lock" "file://"
