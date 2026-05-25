assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "Linking local skill"
assert_contains stdout "my-global-skill"

# rosie stores the canonicalized source path (std::fs::canonicalize), and on
# macOS that resolves /var -> /private/var. Match against the realpath form.
REAL_HOME="$(cd "$HOME" && pwd -P)"

# No canonical hop globally: the agent symlink points straight at the source.
assert_symlink_target "$HOME/.claude/skills/my-global-skill" "$REAL_HOME/my-global-skill"

# Global install must not create a project canonical store.
if [ -d ".agents" ]; then
    _fail ".agents/ should not exist for a --global local install"
fi

# Lockfile lives at ~/.agents/rosie.lock with a file:// source.
assert_file_exists "$HOME/.agents/rosie.lock"
assert_contains "$HOME/.agents/rosie.lock" "file://$REAL_HOME/my-global-skill"
