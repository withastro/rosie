# install-global: -g installs skill files directly into ~/.<agent>/skills/
# instead of the project's .agents/skills/. No symlinks; the agent dir
# contains a real copy of the skill.

mkdir -p "$HOME/.claude"

"$ROSIE" install -g -y fake-org/skills > stdout 2> stderr
echo $? > exit_code
