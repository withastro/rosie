# idempotent-rerun: install the same skill twice. The second run should
# detect the existing canonical install, leave it alone, and exit 0.

mkdir -p "$HOME/.claude"

"$ROSIE" install -y fake-org/skills > first.stdout 2> first.stderr
echo $? > first.exit_code

"$ROSIE" install -y fake-org/skills > stdout 2> stderr
echo $? > exit_code
