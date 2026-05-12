# remove-reference: install --ref, then remove. Reference dir, lockfile row,
# and AGENTS.md block entry should all be gone.

mkdir -p "$HOME/.claude"

"$ROSIE" install -y --ref fake-org/skills > install.stdout 2> install.stderr
"$ROSIE" remove -y fake-org-skills > stdout 2> stderr
echo $? > exit_code
