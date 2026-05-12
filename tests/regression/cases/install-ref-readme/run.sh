# install-ref-readme: rosie install --ref with no --skill installs the repo's
# README.md as a reference under .agents/references/<name>/REFERENCE.md and
# adds an entry to the project's AGENTS.md instructions file.

mkdir -p "$HOME/.claude"

"$ROSIE" install -y --ref fake-org/skills > stdout 2> stderr
echo $? > exit_code
