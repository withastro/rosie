# list-repo: rosie list <owner/repo> downloads the remote and lists the
# skills it discovers, without installing anything.

mkdir -p "$HOME/.claude"

"$ROSIE" list fake-org/multi-skills > stdout 2> stderr
echo $? > exit_code
