# update-one: rosie update <skill-name> should only refresh that entry.
# Pre-stage two entries (my-skill + alpha-skill), both with stale SHAs.
# Update only my-skill — alpha-skill row must remain untouched.

mkdir -p "$HOME/.claude"
mkdir -p .agents/skills/my-skill .agents/skills/alpha-skill .claude/skills

# Plant both canonical dirs + symlinks so they look pre-installed.
cat > .agents/skills/my-skill/SKILL.md <<'EOF'
---
name: my-skill
description: A test skill used by rosie's regression suite
---

# my-skill

Body content for the test skill. Intentionally short.
EOF

cat > .agents/skills/alpha-skill/SKILL.md <<'EOF'
---
name: alpha-skill
description: First skill in the multi-skills test fixture
---

# alpha-skill

Body.
EOF

ln -s ../../.agents/skills/my-skill .claude/skills/my-skill
ln -s ../../.agents/skills/alpha-skill .claude/skills/alpha-skill

cat > .agents/rosie.lock <<'EOF'
# rosie-lock v1
alpha-skill fake-org/multi-skills main 9999999999999999999999999999999999999999 2025-01-01T00:00:00Z auto skill
my-skill fake-org/skills v1.0.0 0000000000000000000000000000000000000000 2025-01-01T00:00:00Z pin skill
EOF

"$ROSIE" update my-skill > stdout 2> stderr
echo $? > exit_code
