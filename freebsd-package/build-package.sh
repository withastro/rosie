#!/bin/sh
# Builds a FreeBSD .pkg from an already-built rosie binary.
# Run from the repo root inside a FreeBSD environment, after
# `cargo build --release && cp target/release/rosie .`.
set -e

VERSION=$1
[ -z "$VERSION" ] && { echo "Usage: $0 <version>" >&2; exit 1; }
[ -f rosie ] || { echo "rosie binary not found; run 'cargo build --release && cp target/release/rosie .' first" >&2; exit 1; }

STAGING=$(mktemp -d)
trap "rm -rf $STAGING" EXIT

mkdir -p "$STAGING/usr/local/bin"
install -m 755 rosie "$STAGING/usr/local/bin/rosie"

sed "s/\${VERSION}/$VERSION/g" freebsd-package/pkg-manifest.ucl > "$STAGING/+MANIFEST"
cp freebsd-package/pkg-plist "$STAGING/plist"

pkg create -M "$STAGING/+MANIFEST" -r "$STAGING" -p "$STAGING/plist" -o .

echo "Created: rosie-$VERSION.pkg"
