# audit-silent-without-context: a plain shell (no agent env vars) gets a
# normal install with no audit envelope on stdout. The agent-context env
# is unset in the test harness; we just need to assert silence here.

mkdir -p "$HOME/.claude"
"$ROSIE" install -y fake-org/skills > stdout 2> stderr
echo $? > exit_code
