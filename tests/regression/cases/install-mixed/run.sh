# install-mixed: install one skill from a repo, then another from the same
# repo. Lockfile should grow to two entries, not replace the first.

mkdir -p "$HOME/.claude"

"$ROSIE" install -y fake-org/multi-skills alpha-skill > alpha.stdout 2> alpha.stderr
"$ROSIE" install -y fake-org/multi-skills beta-skill > stdout 2> stderr
echo $? > exit_code
