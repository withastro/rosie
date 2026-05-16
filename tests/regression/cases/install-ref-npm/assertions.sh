assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "npm references for react@18.0.0"
assert_contains stdout "Installed 2 npm reference"

# REFERENCE.md files are copies (not symlinks) so rosie can sanitize them
# on install and so upstream changes land via `rosie update`, not silently
# via the next `npm install`. See docs/security.
assert_regular_file ".agents/references/react-readme/REFERENCE.md"
assert_regular_file ".agents/references/react-docs-hooks/REFERENCE.md"

# Lockfile source must use the npm:<pkg>#<rel-path> form and record the
# package version in the sha column.
assert_contains ".agents/rosie.lock" "npm:react#README.md"
assert_contains ".agents/rosie.lock" "npm:react#docs/hooks.md"
assert_contains ".agents/rosie.lock" "18.0.0"

# AGENTS.md link text comes from each file's H1, not the package name.
assert_contains "AGENTS.md" "[React]"
assert_contains "AGENTS.md" "[Hooks]"
