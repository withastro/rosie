# install-local-path: install from a directory in the project tree.
# Exercises local-path detection (no network), canonicalisation, and the
# file:// lockfile source. The canonical entry in .agents/skills/ is itself
# a symlink back to the user's directory.

mkdir -p "$HOME/.claude"

# Stage a local skill under the project tree.
mkdir -p my-local-skill
cat > my-local-skill/SKILL.md <<'EOF'
---
name: my-local-skill
description: A local skill staged for the regression test
---

# my-local-skill

Body.
EOF

"$ROSIE" install -y ./my-local-skill > stdout 2> stderr
echo $? > exit_code
