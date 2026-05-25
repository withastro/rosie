# list-global: install a local skill with -g, then `rosie list -g`
# should print it from ~/.agents/rosie.lock.

mkdir -p "$HOME/.claude"

mkdir -p "$HOME/my-global-skill"
cat > "$HOME/my-global-skill/SKILL.md" <<'EOF'
---
name: my-global-skill
description: A local skill installed globally for the regression test
---

# my-global-skill

Body.
EOF

"$ROSIE" install -g -y "$HOME/my-global-skill" > /dev/null 2>&1

"$ROSIE" list -g > stdout 2> stderr
echo $? > exit_code
