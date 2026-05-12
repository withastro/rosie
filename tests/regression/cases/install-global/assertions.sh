assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "Installed 1 skill(s) to 1 agent(s)"

# Global install places real files (not symlinks) under HOME.
assert_file_exists "$HOME/.claude/skills/my-skill/SKILL.md"
if [ -L "$HOME/.claude/skills/my-skill" ]; then
    _fail "$HOME/.claude/skills/my-skill should be a directory, not a symlink"
fi

# Project dir must be untouched (no .agents/ created).
if [ -d ".agents" ]; then
    _fail ".agents/ should not exist for a global install"
fi
