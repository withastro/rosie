# error-invalid-spec: "foo" with no slash isn't a valid owner/repo spec.
# Rosie should exit non-zero and explain the format. No .agents/ should be
# created.

mkdir -p "$HOME/.claude"

"$ROSIE" install -y foo > stdout 2> stderr
echo $? > exit_code
