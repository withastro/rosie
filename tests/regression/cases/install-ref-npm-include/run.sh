# install-ref-npm-include: --include <path> overrides the default README +
# docs/ scope and picks just the listed paths.

mkdir -p "$HOME/.claude"

# Stage a package with README + docs/ + extras. We'll include only README.
mkdir -p node_modules/zod/docs
cat > node_modules/zod/package.json <<'EOF'
{ "name": "zod", "version": "3.22.0" }
EOF
cat > node_modules/zod/README.md <<'EOF'
# Zod

TypeScript-first schema validation.
EOF
cat > node_modules/zod/docs/api.md <<'EOF'
# Zod API

Reference documentation.
EOF

"$ROSIE" install -y --ref --npm zod --include README.md > stdout 2> stderr
echo $? > exit_code
