# agentsmd-block-rewrite: an existing AGENTS.md already has a rosie block
# (perhaps from a previous install that's no longer present). A new
# install --ref should REPLACE the contents of that block, not append a
# second one and not duplicate the user's prose.

mkdir -p "$HOME/.claude"

cat > AGENTS.md <<'EOF'
# Project handbook

User-authored content above the block.

<!-- rosie:references:start -->
<references>
- [stale](./.agents/references/stale/REFERENCE.md)
</references>
<!-- rosie:references:end -->

User-authored content below the block.
EOF

"$ROSIE" install -y --ref fake-org/skills > stdout 2> stderr
echo $? > exit_code
