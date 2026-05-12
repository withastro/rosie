# install-ref-npm-scoped: @scope/pkg packages live under node_modules/@scope/pkg/.
# The default ref name slugifies the scope: @tanstack/react-query -> tanstack-react-query.

mkdir -p "$HOME/.claude"

mkdir -p "node_modules/@tanstack/react-query"
cat > "node_modules/@tanstack/react-query/package.json" <<'EOF'
{ "name": "@tanstack/react-query", "version": "5.0.0" }
EOF
cat > "node_modules/@tanstack/react-query/README.md" <<'EOF'
# TanStack Query

Powerful asynchronous state management.
EOF

"$ROSIE" install -y --ref --npm @tanstack/react-query > stdout 2> stderr
echo $? > exit_code
