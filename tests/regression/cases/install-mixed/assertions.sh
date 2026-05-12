assert_exit_code 0 "$(cat exit_code)"

# Both skills present in canonical and agent dirs.
assert_file_exists ".agents/skills/alpha-skill/SKILL.md"
assert_file_exists ".agents/skills/beta-skill/SKILL.md"
assert_symlink_target ".claude/skills/alpha-skill" "../../.agents/skills/alpha-skill"
assert_symlink_target ".claude/skills/beta-skill" "../../.agents/skills/beta-skill"

# Lockfile must have entries for BOTH (the second install must not have
# overwritten the alpha-skill entry).
assert_contains ".agents/rosie.lock" "alpha-skill fake-org/multi-skills"
assert_contains ".agents/rosie.lock" "beta-skill fake-org/multi-skills"

# Each appears exactly once.
alpha_count=$(grep -c '^alpha-skill ' .agents/rosie.lock || true)
beta_count=$(grep -c '^beta-skill ' .agents/rosie.lock || true)
assert_eq "$alpha_count" "1" "alpha-skill should have exactly 1 lockfile row"
assert_eq "$beta_count" "1" "beta-skill should have exactly 1 lockfile row"
