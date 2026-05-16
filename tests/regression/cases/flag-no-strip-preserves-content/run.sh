# flag-no-strip-preserves-content: --no-strip disables both comment and
# invisible-char stripping on the reference install path. The hostile fixture
# README would normally get sanitized; with this flag the original content
# (including comments and invisible chars) should land on disk verbatim.

mkdir -p "$HOME/.claude"
"$ROSIE" install -y --ref --no-strip fake-org/hostile > stdout 2> stderr
echo $? > exit_code
