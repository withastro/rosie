# audit-emits-via-opencode-env: OPENCODE_CLIENT is the env var opencode
# sets when running, per @vercel/detect-agent. Setting it should trigger
# the audit emission the same way ROSIE_AGENT_CONTEXT=1 does.

mkdir -p "$HOME/.claude"
OPENCODE_CLIENT=1 "$ROSIE" install -y fake-org/skills > stdout 2> stderr
echo $? > exit_code
