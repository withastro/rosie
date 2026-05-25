assert_exit_code 0 "$(cat exit_code)"
assert_contains stdout "Reinstalling 1 skill(s) from lockfile"
# file:// entries count as `ok` but not `fresh`, so reinstall reports the
# "already installed" wording even though the symlink is freshly created.
assert_contains stdout "Linking local skill: my-global-skill"

# Reinstall recreates the per-agent symlink pointing at the absolute source.
assert_symlink_target "$HOME/.claude/skills/my-global-skill" "$HOME/my-global-skill"

# Lockfile must remain at ~/.agents/rosie.lock (no project lockfile created).
assert_file_exists "$HOME/.agents/rosie.lock"
if [ -d ".agents" ]; then
    _fail ".agents/ should not exist for a --global reinstall"
fi
