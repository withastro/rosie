assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "Installed global skills"
assert_contains stdout "my-global-skill"
assert_contains stdout "[skill]"
assert_contains stdout "(linked)"

# The header should point at the global lockfile, not the project one.
assert_contains stdout ".agents/rosie.lock"
assert_not_contains stdout "this project"
