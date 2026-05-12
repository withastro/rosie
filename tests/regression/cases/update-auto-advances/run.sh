# update-auto-advances: an auto-pinned entry recorded at main (or an older
# tag) should re-resolve to the current latest tag on update.
#
# info/refs advertises v1.0.0 as the highest semver tag, so we pre-stage
# an auto entry at ref=main and expect update to advance it to v1.0.0.

mkdir -p "$HOME/.claude"
mkdir -p .agents/skills/my-skill .claude/skills

cat > .agents/skills/my-skill/SKILL.md <<'EOF'
---
name: my-skill
description: A test skill used by rosie's regression suite
---

# my-skill

Body content for the test skill. Intentionally short.
EOF
ln -s ../../.agents/skills/my-skill .claude/skills/my-skill

cat > .agents/rosie.lock <<'EOF'
# rosie-lock v1
my-skill fake-org/skills main 1111111111111111111111111111111111111111 2025-01-01T00:00:00Z auto skill
EOF

"$ROSIE" update > stdout 2> stderr
echo $? > exit_code
