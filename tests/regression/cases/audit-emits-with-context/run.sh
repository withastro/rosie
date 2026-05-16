# audit-emits-with-context: when ROSIE_AGENT_CONTEXT=1 is set, every install
# writes the wrapped audit JSON to stdout so the agent can review it.

mkdir -p "$HOME/.claude"
ROSIE_AGENT_CONTEXT=1 "$ROSIE" install -y fake-org/skills > stdout 2> stderr
echo $? > exit_code
