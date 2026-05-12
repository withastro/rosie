# install-pinned-tag: rosie install with @<tag>.
#
# Rosie's tarball downloader tries refs/heads first then falls back to
# refs/tags on 404. We only ship the tag fixture, so the heads URL 404s,
# the tag URL hits, and the lockfile pinned=pin.

mkdir -p "$HOME/.claude"

"$ROSIE" install -y fake-org/skills@v1.0.0 > stdout 2> stderr
echo $? > exit_code
