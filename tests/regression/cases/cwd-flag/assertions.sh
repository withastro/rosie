assert_exit_code 0 "$(cat exit_code)"

# Install must have landed in sub/project, not in PROJECT_DIR root.
assert_file_exists "sub/project/.agents/skills/my-skill/SKILL.md"
assert_file_exists "sub/project/.agents/rosie.lock"
assert_symlink_target "sub/project/.claude/skills/my-skill" "../../.agents/skills/my-skill"

# Project root must NOT have a .agents/.
if [ -d ".agents" ]; then
    _fail ".agents/ should not exist in PROJECT_DIR — --cwd should have redirected"
fi
