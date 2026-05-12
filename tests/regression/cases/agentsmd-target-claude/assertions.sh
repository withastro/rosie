assert_exit_code 0 "$(cat exit_code)"

# CLAUDE.md must have been picked, not AGENTS.md.
if [ -f "AGENTS.md" ]; then
    _fail "AGENTS.md should not exist — CLAUDE.md was the target"
fi
assert_contains "CLAUDE.md" "rosie:references:start"
assert_contains "CLAUDE.md" "Project instructions"  # original content preserved
