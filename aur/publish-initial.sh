#!/usr/bin/env bash
# One-time bootstrap: create the AUR repo for `rosie` and push the initial PKGBUILD.
# After this runs, future releases are handled automatically by the GitHub Actions workflow.
#
# Usage: ./aur/publish-initial.sh [version]
#   version defaults to the latest git tag (without leading 'v')

set -euo pipefail

PKGNAME="rosie"
REPO="matthewp/rosie"
TEMPLATE="$(cd "$(dirname "$0")" && pwd)/PKGBUILD"

# --- resolve version ---
if [[ $# -ge 1 ]]; then
    VERSION="${1#v}"
else
    LATEST_TAG=$(git -C "$(dirname "$TEMPLATE")/.." describe --tags --abbrev=0)
    VERSION="${LATEST_TAG#v}"
fi
echo "==> Version: $VERSION"

# --- sanity checks ---
for cmd in makepkg curl sha256sum git ssh; do
    command -v "$cmd" >/dev/null || { echo "missing: $cmd"; exit 1; }
done

[[ -f "$TEMPLATE" ]] || { echo "PKGBUILD template not found at $TEMPLATE"; exit 1; }

# --- check AUR ssh access ---
echo "==> Checking AUR SSH access..."
if ! ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new aur@aur.archlinux.org help >/dev/null 2>&1; then
    echo "AUR SSH access failed. Add your public key at https://aur.archlinux.org/account/"
    exit 1
fi

# --- compute source tarball SHA256 ---
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
TARBALL_URL="https://github.com/${REPO}/archive/refs/tags/v${VERSION}.tar.gz"
echo "==> Downloading $TARBALL_URL"
curl -fsSL "$TARBALL_URL" -o "$WORK/source.tar.gz"
SHA256=$(sha256sum "$WORK/source.tar.gz" | cut -d' ' -f1)
echo "==> SHA256: $SHA256"

# --- generate PKGBUILD ---
sed -e "s/\${VERSION}/$VERSION/g" -e "s/\${SHA256}/$SHA256/g" "$TEMPLATE" > "$WORK/PKGBUILD"
echo "==> Generated PKGBUILD:"
echo "----"
cat "$WORK/PKGBUILD"
echo "----"

# --- clone the AUR repo (empty if it doesn't exist yet) ---
echo "==> Cloning aur:${PKGNAME}.git"
cd "$WORK"
git clone "ssh://aur@aur.archlinux.org/${PKGNAME}.git" repo
cd repo
# AUR uses `master`; ensure local branch matches regardless of init.defaultBranch
git checkout -B master

if [[ -f PKGBUILD ]]; then
    echo "!! AUR repo already has a PKGBUILD — this is meant for initial bootstrap."
    echo "!! Inspect $WORK/repo manually if you want to proceed."
    exit 1
fi

cp ../PKGBUILD .

# --- generate .SRCINFO (required by AUR web view) ---
echo "==> Generating .SRCINFO"
makepkg --printsrcinfo > .SRCINFO
cat .SRCINFO

# --- optional: verify the package builds before publishing ---
read -r -p "==> Run 'makepkg -s' locally to verify the build? [y/N] " ans
if [[ "$ans" =~ ^[Yy]$ ]]; then
    makepkg -sf --noconfirm
fi

# --- commit ---
git add PKGBUILD .SRCINFO
git -c user.name="Matthew Phillips" -c user.email="matthew@matthewphillips.info" \
    commit -m "Initial import (v${VERSION})"

echo
echo "==> Ready to push. Review:"
git --no-pager log --stat -1
echo
read -r -p "==> Push to AUR? [y/N] " ans
if [[ "$ans" =~ ^[Yy]$ ]]; then
    git push origin HEAD:master
    echo "==> Done. Package live at https://aur.archlinux.org/packages/${PKGNAME}"
else
    echo "==> Skipped push. Working tree at: $WORK/repo"
    trap - EXIT  # keep the temp dir so the user can finish manually
fi
