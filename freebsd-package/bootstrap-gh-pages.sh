#!/usr/bin/env bash
# One-time bootstrap: create an empty `gh-pages` branch with a .nojekyll
# marker, so the FreeBSD release workflow has somewhere to push pkg repo
# files. After this runs, enable GitHub Pages in repo Settings → Pages
# (source: gh-pages branch, folder: /).
#
# Usage: ./freebsd-package/bootstrap-gh-pages.sh

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

# --- safety checks ---
ORIGINAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "==> Current branch: $ORIGINAL_BRANCH"

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "!! Uncommitted changes present. Commit or stash before running."
    exit 1
fi

if git show-ref --quiet refs/heads/gh-pages; then
    echo "!! Local gh-pages branch already exists. Aborting."
    exit 1
fi

if git ls-remote --exit-code --heads origin gh-pages >/dev/null 2>&1; then
    echo "!! Remote gh-pages branch already exists. Aborting."
    exit 1
fi

# Restore original branch + clean up worktree on any exit
trap 'git checkout "$ORIGINAL_BRANCH" >/dev/null 2>&1 || true' EXIT

# --- create the orphan branch ---
echo "==> Creating orphan gh-pages branch"
git checkout --orphan gh-pages
git rm -rf . >/dev/null

touch .nojekyll
git add .nojekyll
git commit -m "Bootstrap gh-pages for FreeBSD pkg repo"

echo
echo "==> Ready to push. Branch contents:"
git --no-pager log --stat -1
echo
read -r -p "==> Push gh-pages to origin? [y/N] " ans
if [[ "$ans" =~ ^[Yy]$ ]]; then
    git push -u origin gh-pages
    echo
    echo "==> Done. Next: enable GitHub Pages at"
    echo "    https://github.com/withastro/rosie/settings/pages"
    echo "    Source: 'Deploy from a branch'"
    echo "    Branch: gh-pages, folder: / (root)"
else
    echo "==> Skipped push. Local gh-pages branch left in place; delete with:"
    echo "    git branch -D gh-pages"
fi
