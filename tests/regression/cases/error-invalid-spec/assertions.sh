# rosie reports invalid spec via log_error which returns -1 from
# install_package → main's return wraps to exit 255 on Linux. That's the
# current C behavior; lock it in.
assert_exit_code 255 "$(cat exit_code)"

assert_contains stderr "Invalid package spec"
assert_contains stderr "foo"

# Nothing should have been written.
if [ -d ".agents" ]; then
    _fail ".agents/ should not exist after invalid spec"
fi
