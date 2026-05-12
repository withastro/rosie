# agentsmd-target-claude: CLAUDE.md exists but no AGENTS.md. Rosie should
# pick CLAUDE.md as the references-block target.

mkdir -p "$HOME/.claude"

cat > CLAUDE.md <<'EOF'
# Project instructions

This is a Claude-using project.
EOF

"$ROSIE" install -y --ref fake-org/skills > stdout 2> stderr
echo $? > exit_code
