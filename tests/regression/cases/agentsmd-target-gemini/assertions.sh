assert_exit_code 0 "$(cat exit_code)"
if [ -f "AGENTS.md" ] || [ -f "CLAUDE.md" ]; then
    _fail "GEMINI.md should be the only references-block target"
fi
assert_contains "GEMINI.md" "rosie:references:start"
assert_contains "GEMINI.md" "Gemini project"
