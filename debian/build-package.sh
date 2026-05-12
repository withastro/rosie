#!/usr/bin/env bash
# Builds a .deb from an already-built rosie binary.
# Run from repo root after `cargo build --release && cp target/release/rosie rosie`.
#
# Usage: ./debian/build-package.sh <version> <codename>
#   e.g. ./debian/build-package.sh 0.6.0 noble
#
# The Rust binary has no runtime dependencies (rustls is statically linked),
# so there's no Depends line in debian/control any more.
set -euo pipefail

VERSION=${1:?usage: $0 <version> <codename>}
CODENAME=${2:?usage: $0 <version> <codename>}

[ -f rosie ] || { echo "rosie binary not found; run 'cargo build --release && cp target/release/rosie .' first" >&2; exit 1; }

# ~codename1 suffix lets both jammy and noble builds coexist in the same pool
# while sorting before the next upstream version.
DEB_VERSION="${VERSION}~${CODENAME}1"
PKG_DIR="rosie_${DEB_VERSION}_amd64"

rm -rf "$PKG_DIR"
mkdir -p "$PKG_DIR/usr/bin" "$PKG_DIR/DEBIAN"
install -m 755 rosie "$PKG_DIR/usr/bin/rosie"

sed -e "s/\${VERSION}/$DEB_VERSION/g" debian/control > "$PKG_DIR/DEBIAN/control"

dpkg-deb --build "$PKG_DIR"
echo "Created: ${PKG_DIR}.deb"
