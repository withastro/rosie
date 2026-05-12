# error-missing-repo: ghost-org/ghost-repo has no fixture. The mock server
# 404s both branch and tag URLs, so rosie's download fails.

mkdir -p "$HOME/.claude"

"$ROSIE" install -y ghost-org/ghost-repo > stdout 2> stderr
echo $? > exit_code
