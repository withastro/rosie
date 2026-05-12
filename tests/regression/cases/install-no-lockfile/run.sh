# install-no-lockfile: --no-lockfile installs files but leaves rosie.lock
# untouched (not created when absent, not modified when present).

mkdir -p "$HOME/.claude"

"$ROSIE" install -y --no-lockfile fake-org/skills > stdout 2> stderr
echo $? > exit_code
