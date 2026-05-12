# list-installed: install a skill, then rosie list (no args) should print it.

mkdir -p "$HOME/.claude"
"$ROSIE" install -y fake-org/skills > /dev/null 2>&1

"$ROSIE" list > stdout 2> stderr
echo $? > exit_code
