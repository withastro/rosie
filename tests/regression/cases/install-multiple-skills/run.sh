# install-multiple-skills: a repo with two SKILL.md trees. With no skill
# filter, rosie should install both.

mkdir -p "$HOME/.claude"

"$ROSIE" install -y fake-org/multi-skills > stdout 2> stderr
echo $? > exit_code
