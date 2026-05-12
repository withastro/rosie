assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "Removed 'my-skill'"

# The agent-side symlink must be gone.
if [ -e ".claude/skills/my-skill" ] || [ -L ".claude/skills/my-skill" ]; then
    _fail ".claude/skills/my-skill still exists after remove"
fi

# Lockfile must no longer reference my-skill.
assert_not_contains ".agents/rosie.lock" "my-skill"
