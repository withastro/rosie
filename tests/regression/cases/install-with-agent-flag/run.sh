# install-with-agent-flag: -a claude -a cursor explicitly targets both agents.
# Both must receive a symlink even if other agents (Codex, Cline, ...) would
# also have been detected.

mkdir -p "$HOME/.claude" "$HOME/.cursor" "$HOME/.codex"

"$ROSIE" install -y fake-org/skills -a claude -a cursor > stdout 2> stderr
echo $? > exit_code
