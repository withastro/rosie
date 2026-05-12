assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "npm references for react@18.0.0"
assert_contains stdout "Installed 2 npm reference"

# REFERENCE.md files must be SYMLINKS back into node_modules, not copies.
assert_symlink_target ".agents/references/react-readme/REFERENCE.md" \
    "../../../node_modules/react/README.md"
assert_symlink_target ".agents/references/react-docs-hooks/REFERENCE.md" \
    "../../../node_modules/react/docs/hooks.md"

# Lockfile source must use the npm:<pkg>#<rel-path> form and record the
# package version in the sha column.
assert_contains ".agents/rosie.lock" "npm:react#README.md"
assert_contains ".agents/rosie.lock" "npm:react#docs/hooks.md"
assert_contains ".agents/rosie.lock" "18.0.0"

# AGENTS.md link text comes from each file's H1, not the package name.
assert_contains "AGENTS.md" "[React]"
assert_contains "AGENTS.md" "[Hooks]"
