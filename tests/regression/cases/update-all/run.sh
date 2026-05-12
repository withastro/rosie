# update-all: pre-stage a lockfile with an outdated SHA for a pinned entry,
# then run rosie update. For a pinned ref, update keeps the same ref and
# refreshes the SHA to whatever info/refs advertises (bbbb... for v1.0.0).

mkdir -p "$HOME/.claude"
mkdir -p .agents/skills/my-skill .claude/skills

# Pretend a previous install left the canonical dir + agent symlink in place.
cat > .agents/skills/my-skill/SKILL.md <<'EOF'
---
name: my-skill
description: A test skill used by rosie's regression suite
---

# my-skill

Body content for the test skill. Intentionally short.
EOF
ln -s ../../.agents/skills/my-skill .claude/skills/my-skill

# Lockfile records a stale SHA. update should rewrite it.
cat > .agents/rosie.lock <<'EOF'
# rosie-lock v1
my-skill fake-org/skills v1.0.0 0000000000000000000000000000000000000000 2025-01-01T00:00:00Z pin skill
EOF

"$ROSIE" update > stdout 2> stderr
echo $? > exit_code
