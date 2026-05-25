# install-from-lockfile-global: `rosie install -g` with no args reinstalls
# from ~/.agents/rosie.lock. Pre-seed the global lockfile with a file://
# entry pointing at a staged source, then run.

mkdir -p "$HOME/.claude"

# Stage the source the lockfile points at.
mkdir -p "$HOME/my-global-skill"
cat > "$HOME/my-global-skill/SKILL.md" <<'EOF'
---
name: my-global-skill
description: A local skill installed globally for the regression test
---

# my-global-skill

Body.
EOF

mkdir -p "$HOME/.agents"
cat > "$HOME/.agents/rosie.lock" <<EOF
# rosie-lock v1
my-global-skill file://$HOME/my-global-skill - - 2025-01-01T00:00:00Z pin skill
EOF

"$ROSIE" install -g -y > stdout 2> stderr
echo $? > exit_code
