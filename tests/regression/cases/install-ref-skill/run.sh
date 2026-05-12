# install-ref-skill: --ref --skill <name> installs the named SKILL.md as a
# reference, not the repo's README. The body (frontmatter stripped) lands at
# .agents/references/<owner>-<repo>-<skill>/REFERENCE.md.

mkdir -p "$HOME/.claude"

"$ROSIE" install -y --ref --skill my-skill fake-org/skills > stdout 2> stderr
echo $? > exit_code
