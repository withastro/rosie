assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "Installed 1 npm reference"

# Only README was --include'd; docs/api.md must NOT have been installed.
assert_file_exists ".agents/references/zod-readme/REFERENCE.md"
if [ -e ".agents/references/zod-docs-api" ]; then
    _fail "zod-docs-api should not exist when --include only README.md"
fi
assert_not_contains ".agents/rosie.lock" "docs/api.md"
