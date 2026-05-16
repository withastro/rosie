# sanitize-ref-strips-comments-and-invisible: --ref install must strip both
# markdown comments (outside fences) and invisible Unicode from the source
# README before writing .agents/references/<name>/REFERENCE.md.

mkdir -p "$HOME/.claude"
"$ROSIE" install -y --ref fake-org/hostile > stdout 2> stderr
echo $? > exit_code
