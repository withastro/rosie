assert_exit_code 0 "$(cat exit_code)"
skill=".agents/skills/my-hostile-skill/SKILL.md"
assert_file_exists "$skill"

# Skill authors keep their comments — comment-stripping does not apply.
assert_contains "$skill" "skill authors keep their comments"

# Invisible Unicode is stripped from skill content (sanitize_skill).
if grep -q $'\xe2\x80\x8d' "$skill"; then
    _fail "U+200D (ZWJ) still present in $skill"
fi
if grep -q $'\xe2\x80\xae' "$skill"; then
    _fail "U+202E (RLO bidi override) still present in $skill"
fi
