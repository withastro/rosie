# Non-zero exit because the flag combo is invalid.
code="$(cat exit_code)"
if [ "$code" = "0" ]; then
    _fail "expected non-zero exit, got 0"
fi
assert_contains stderr "mutually exclusive"
# No install happened.
if [ -d ".agents/skills/my-skill" ]; then
    _fail "skill was installed despite mutex flag rejection"
fi
