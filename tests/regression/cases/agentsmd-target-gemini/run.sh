# agentsmd-target-gemini: GEMINI.md exists (no AGENTS.md, no CLAUDE.md).
# Rosie should pick GEMINI.md as the target.

mkdir -p "$HOME/.claude"

cat > GEMINI.md <<'EOF'
# Gemini project

Existing content.
EOF

"$ROSIE" install -y --ref fake-org/skills > stdout 2> stderr
echo $? > exit_code
