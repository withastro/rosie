assert_exit_code 0 "$(cat exit_code)"

# Output should be a single line that looks like a semver. We don't pin the
# exact number — bumps shouldn't break this case — but it must look right.
ver=$(tr -d '\n' < stdout)
case "$ver" in
    [0-9]*.[0-9]*.[0-9]*) ;;
    *) _fail "stdout does not look like a semver: '$ver'" ;;
esac
