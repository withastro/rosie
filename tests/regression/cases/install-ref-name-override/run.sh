# install-ref-name-override: --ref --name <custom> picks the install name
# instead of the default <owner>-<repo>[-skill]. The reference dir, lockfile
# row, and AGENTS.md link should all use "custom-name".

mkdir -p "$HOME/.claude"

"$ROSIE" install -y --ref --name custom-name fake-org/skills > stdout 2> stderr
echo $? > exit_code
