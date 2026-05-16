# sanitize-skill-invisible-only: a skill install must strip invisible chars
# from each .md but preserve comments (skill authors chose markdown-as-prompt,
# their comments are intentional). The fixture's SKILL.md has both.

mkdir -p "$HOME/.claude"
"$ROSIE" install -y fake-org/hostile my-hostile-skill > stdout 2> stderr
echo $? > exit_code
