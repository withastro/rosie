assert_exit_code 0 "$(cat exit_code)"

# Block should have been REPLACED in place.
assert_contains "AGENTS.md" "fake-org-skills/REFERENCE.md"

# The stale entry the user had inside the previous block must be gone.
assert_not_contains "AGENTS.md" "stale"

# User-authored content on both sides of the block must be preserved.
assert_contains "AGENTS.md" "User-authored content above the block"
assert_contains "AGENTS.md" "User-authored content below the block"
assert_contains "AGENTS.md" "Project handbook"

# Exactly one block — not two.
start_count=$(grep -c 'rosie:references:start' AGENTS.md || true)
assert_eq "$start_count" "1" "AGENTS.md should have exactly one rosie block"
