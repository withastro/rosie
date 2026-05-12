# agents: detection with two agent dirs in HOME.

mkdir -p "$HOME/.claude" "$HOME/.cursor"

"$ROSIE" agents > stdout 2> stderr
echo $? > exit_code
