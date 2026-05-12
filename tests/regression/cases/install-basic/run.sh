# install-basic: install a single-skill repo, default branch, no agents flag.
#
# Setup: fake $HOME with .claude/ so Claude agent is detected.
# Action: rosie install fake-org/skills
# Expect: canonical .agents/skills/my-skill/ + symlink in .claude/skills/

mkdir -p "$HOME/.claude"

"$ROSIE" install -y fake-org/skills > stdout 2> stderr
echo $? > exit_code
