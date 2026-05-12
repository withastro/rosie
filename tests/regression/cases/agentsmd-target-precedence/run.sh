# agentsmd-target-precedence: when both AGENTS.md and CLAUDE.md exist,
# AGENTS.md should win (it sits first in the detection order).

mkdir -p "$HOME/.claude"

cat > AGENTS.md <<'EOF'
# Agents file

The one rosie should pick.
EOF

cat > CLAUDE.md <<'EOF'
# Claude file

The one rosie should leave alone.
EOF

"$ROSIE" install -y --ref fake-org/skills > stdout 2> stderr
echo $? > exit_code
