# flag-audit-mutex-rejected: --audit and --no-audit set opposing intents, so
# the CLI must reject the combination with a non-zero exit before doing any
# real work.

mkdir -p "$HOME/.claude"
"$ROSIE" install -y --audit --no-audit fake-org/skills > stdout 2> stderr
echo $? > exit_code
