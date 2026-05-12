# update-noop: lockfile already records the SHA that info/refs advertises.
# rosie update should detect this and report "0 updated, 1 unchanged".

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

# bbbb...bbbb is the peeled SHA for v1.0.0 in our info/refs fixture.
cat > .agents/rosie.lock <<'EOF'
# rosie-lock v1
my-skill fake-org/skills v1.0.0 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2025-01-01T00:00:00Z pin skill
EOF

"$ROSIE" update > stdout 2> stderr
echo $? > exit_code
