assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "Removed reference 'fake-org-skills'"

# Reference dir for the entry must be gone (parent .agents/references/ may persist).
if [ -e ".agents/references/fake-org-skills" ]; then
    _fail ".agents/references/fake-org-skills should be gone after remove"
fi

# Lockfile entry gone.
assert_not_contains ".agents/rosie.lock" "fake-org-skills"

# AGENTS.md should no longer reference the removed entry.
if [ -f "AGENTS.md" ]; then
    assert_not_contains "AGENTS.md" "fake-org-skills/REFERENCE.md"
fi
