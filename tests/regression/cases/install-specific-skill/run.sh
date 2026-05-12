# install-specific-skill: positional skill name picks one of multiple skills.
# Only alpha-skill should land; beta-skill must be absent.

mkdir -p "$HOME/.claude"

"$ROSIE" install -y fake-org/multi-skills alpha-skill > stdout 2> stderr
echo $? > exit_code
