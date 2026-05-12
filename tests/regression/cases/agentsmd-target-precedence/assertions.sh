assert_exit_code 0 "$(cat exit_code)"

# AGENTS.md must have gained the block.
assert_contains "AGENTS.md" "rosie:references:start"
assert_contains "AGENTS.md" "fake-org-skills/REFERENCE.md"

# CLAUDE.md must be untouched.
assert_not_contains "CLAUDE.md" "rosie:references:start"
assert_contains "CLAUDE.md" "leave alone"
