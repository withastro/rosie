assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "@tanstack/react-query@5.0.0"

# Slug must flatten the scope's @ and /.
assert_dir_exists ".agents/references/tanstack-react-query-readme"

# Source field keeps the original @scope/pkg form (slugification is for the
# install name only, not the source identifier).
assert_contains ".agents/rosie.lock" "npm:@tanstack/react-query"
