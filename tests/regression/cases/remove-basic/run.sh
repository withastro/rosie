# remove-basic: install then remove. After remove, both symlink layers and
# the canonical dir should be gone, and the lockfile entry should be removed.

mkdir -p "$HOME/.claude"

"$ROSIE" install -y fake-org/skills > install.stdout 2> install.stderr
"$ROSIE" remove -y my-skill > stdout 2> stderr
echo $? > exit_code
