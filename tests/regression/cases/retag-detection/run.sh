# retag-detection: when a pinned tag's resolved SHA differs from the lockfile,
# rosie raises a `tag_rewritten` finding in the audit. We stage a lockfile
# whose v1.0.0 SHA disagrees with the mock server's info/refs response.

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

# Lockfile records SHA dddd...dddd for v1.0.0; the mock server's info/refs
# returns bbbb...bbbb (the peeled tag SHA). On `rosie update`, this mismatch
# should produce a `tag_rewritten` finding.
cat > .agents/rosie.lock <<'EOF'
# rosie-lock v1
my-skill fake-org/skills v1.0.0 dddddddddddddddddddddddddddddddddddddddd 2025-01-01T00:00:00Z pin skill
EOF

ROSIE_AGENT_CONTEXT=1 "$ROSIE" update > stdout 2> stderr
echo $? > exit_code
