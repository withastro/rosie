assert_exit_code 0 "$(cat exit_code)"
if [ -f "AGENTS.md" ] || [ -f "CLAUDE.md" ] || [ -f "GEMINI.md" ]; then
    _fail ".github/copilot-instructions.md should be the only target"
fi
assert_contains ".github/copilot-instructions.md" "rosie:references:start"
assert_contains ".github/copilot-instructions.md" "Copilot instructions"
