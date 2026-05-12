# Behavior: rosie just re-installs on rerun (no early-out detection). Both
# runs must succeed, and the final state should be a single lockfile entry,
# not a duplicate.
assert_exit_code 0 "$(cat first.exit_code)"
assert_exit_code 0 "$(cat exit_code)"

assert_contains stdout "Installed 1 skill"
assert_symlink_target ".claude/skills/my-skill" "../../.agents/skills/my-skill"

# Lockfile must have exactly one my-skill row (count the data lines).
count=$(grep -c '^my-skill ' .agents/rosie.lock || true)
assert_eq "$count" "1" "lockfile should have exactly 1 my-skill entry"
