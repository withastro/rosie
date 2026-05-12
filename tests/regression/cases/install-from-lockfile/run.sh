# install-from-lockfile: rosie install with no args reinstalls everything
# listed in .agents/rosie.lock. We pre-seed the lockfile, then run.

mkdir -p "$HOME/.claude"
mkdir -p .agents
cat > .agents/rosie.lock <<'EOF'
# rosie-lock v1
my-skill fake-org/skills main - 2025-01-01T00:00:00Z auto skill
EOF

"$ROSIE" install -y > stdout 2> stderr
echo $? > exit_code
