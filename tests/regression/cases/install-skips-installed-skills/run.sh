# install-skips-installed-skills: a repo whose tree contains both a real
# `skills/genuine/SKILL.md` and a consumer-side `.claude/skills/installed-
# thirdparty/SKILL.md` (i.e. a third-party skill some consumer project had
# rosie install and then committed). When this repo is itself installed,
# rosie should only see the genuine author-shipped skill, not the
# installed-thirdparty one.

mkdir -p "$HOME/.claude"

"$ROSIE" install -y fake-org/contaminated > stdout 2> stderr
echo $? > exit_code
