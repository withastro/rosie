assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "Created AGENTS.md"
assert_contains stdout "REFERENCE.md"

# Lockfile must mark this as a reference (kind=ref), not a skill.
assert_contains ".agents/rosie.lock" " ref"

# References path must exist and contain the README body.
assert_file_exists ".agents/references/fake-org-skills/REFERENCE.md"
assert_contains ".agents/references/fake-org-skills/REFERENCE.md" "fake-org/skills"

# AGENTS.md should carry the rosie-managed block.
assert_file_exists "AGENTS.md"
assert_contains "AGENTS.md" "rosie:references:start"
assert_contains "AGENTS.md" "fake-org-skills/REFERENCE.md"

# No skill copy should appear (--ref doesn't install as a skill).
if [ -e ".agents/skills/fake-org-skills" ]; then
    _fail ".agents/skills/fake-org-skills should not exist for --ref install"
fi
