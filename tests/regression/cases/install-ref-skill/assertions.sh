assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "Created AGENTS.md"
assert_contains stdout "fake-org-skills-my-skill"

# Reference body must be the SKILL.md with frontmatter stripped (no YAML).
assert_file_exists ".agents/references/fake-org-skills-my-skill/REFERENCE.md"
assert_not_contains ".agents/references/fake-org-skills-my-skill/REFERENCE.md" "description:"

# AGENTS.md link text uses the skill's H1, not the repo path.
assert_contains "AGENTS.md" "[my-skill]"

# Lockfile source carries the #skill suffix.
assert_contains ".agents/rosie.lock" "fake-org/skills#my-skill"
