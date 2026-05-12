# install-ref-npm: --npm pulls reference markdown files from node_modules/<pkg>/.
# No network call. Default scope: README.md at root + recursive *.md under docs/.
# Each file becomes its own reference under .agents/references/<name>/REFERENCE.md
# as a SYMLINK back into node_modules (unlike --ref alone, which copies).

mkdir -p "$HOME/.claude"

# Stage a fake react package.
mkdir -p node_modules/react/docs
cat > node_modules/react/package.json <<'EOF'
{
  "name": "react",
  "version": "18.0.0"
}
EOF
cat > node_modules/react/README.md <<'EOF'
# React

A JavaScript library for building user interfaces.
EOF
cat > node_modules/react/docs/hooks.md <<'EOF'
# Hooks

Hooks let you use state from function components.
EOF

"$ROSIE" install -y --ref --npm react > stdout 2> stderr
echo $? > exit_code
