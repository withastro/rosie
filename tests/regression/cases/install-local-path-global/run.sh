# install-local-path-global: install a local-path skill with --global.
# The source can live anywhere (outside the project tree), agent symlinks
# point directly at the absolute source path (no canonical .agents/skills
# hop), and the lockfile is written to ~/.agents/rosie.lock.

mkdir -p "$HOME/.claude"

# Stage a local skill OUTSIDE the project tree so we exercise the
# global-only path-canonicalisation (no "outside the project" rejection).
mkdir -p "$HOME/my-global-skill"
cat > "$HOME/my-global-skill/SKILL.md" <<'EOF'
---
name: my-global-skill
description: A local skill installed globally for the regression test
---

# my-global-skill

Body.
EOF

"$ROSIE" install -g -y "$HOME/my-global-skill" > stdout 2> stderr
echo $? > exit_code
