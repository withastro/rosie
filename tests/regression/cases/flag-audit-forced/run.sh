# flag-audit-forced: --audit forces the audit envelope onto stdout even when
# no agent-context env var is set. The runner clears those env vars for every
# case, so this exercises only the flag.

mkdir -p "$HOME/.claude"
"$ROSIE" install -y --audit fake-org/skills > stdout 2> stderr
echo $? > exit_code
