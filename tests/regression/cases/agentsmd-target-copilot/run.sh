# agentsmd-target-copilot: .github/copilot-instructions.md is the fourth
# fallback after AGENTS.md, CLAUDE.md, GEMINI.md.

mkdir -p "$HOME/.claude"

mkdir -p .github
cat > .github/copilot-instructions.md <<'EOF'
# Copilot instructions

Existing rules.
EOF

"$ROSIE" install -y --ref fake-org/skills > stdout 2> stderr
echo $? > exit_code
