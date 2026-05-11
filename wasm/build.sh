#!/bin/bash
# WASM build script for rosie.
# Designed to be run inside the emscripten/emsdk container (where emcc,
# emconfigure, emmake are on PATH). Invoke via `make wasm` from the repo root.
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

BUILD=build/wasm
OUT=npm/rosie-skills/wasm
LA_VERSION=3.7.7

mkdir -p "$BUILD" "$OUT"

# -- 1. Cross-compile libarchive (cached) ---------------------------------
if [ ! -f "$BUILD/libarchive/lib/libarchive.a" ]; then
  echo ">>> Fetching libarchive $LA_VERSION"
  rm -rf "$BUILD/libarchive-src"
  curl -sL "https://github.com/libarchive/libarchive/releases/download/v$LA_VERSION/libarchive-$LA_VERSION.tar.gz" \
    | tar -xz -C "$BUILD"
  mv "$BUILD/libarchive-$LA_VERSION" "$BUILD/libarchive-src"

  echo ">>> Configuring libarchive for WASM"
  cd "$BUILD/libarchive-src"
  # USE_ZLIB=1 surfaces emscripten's bundled zlib to autoconf so libarchive
  # detects it and links its built-in gzip codec — otherwise libarchive falls
  # back to spawning /bin/gzip at runtime, which doesn't exist in WASM.
  CFLAGS="-sUSE_ZLIB=1" LDFLAGS="-sUSE_ZLIB=1" \
  emconfigure ./configure \
    --prefix="$REPO_ROOT/$BUILD/libarchive" \
    --enable-static --disable-shared \
    --with-zlib \
    --without-iconv --without-xml2 --without-expat \
    --without-bz2lib --without-lzma --without-zstd --without-lz4 \
    --without-openssl --without-mbedtls --without-cng \
    --without-nettle \
    --disable-bsdtar --disable-bsdcpio --disable-bsdcat \
    --disable-acl --disable-xattr
  echo ">>> Building libarchive"
  EMCC_CFLAGS="-sUSE_ZLIB=1" emmake make -j"$(nproc)"
  emmake make install
  cd "$REPO_ROOT"
fi

# -- 2. Compile + link rosie.wasm -----------------------------------------
# download.c and resolve.c contain `#ifndef __EMSCRIPTEN__` guards around
# their curl-using code; emcc defines __EMSCRIPTEN__ automatically, so those
# blocks drop out. wasm/http-stub.c supplies the missing HTTP entry points.
SRCS=(
  src/agent.c src/agentsmd.c src/archive.c src/download.c
  src/install.c src/lockfile.c src/main.c src/npm.c src/resolve.c
  src/skill.c src/util.c
  wasm/http-stub.c
)

echo ">>> Compiling rosie.wasm"
emcc "${SRCS[@]}" \
  -O2 \
  -Wall -Wextra \
  -std=c99 \
  -D_POSIX_C_SOURCE=200809L -D_DEFAULT_SOURCE \
  -I"$BUILD/libarchive/include" \
  "$BUILD/libarchive/lib/libarchive.a" \
  -sUSE_ZLIB=1 \
  -sASYNCIFY=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=33554432 \
  -sMODULARIZE=1 \
  -sEXPORT_NAME=createRosie \
  -sENVIRONMENT=node \
  -sNODERAWFS=1 \
  -sEXIT_RUNTIME=1 \
  --js-library wasm/http-lib.js \
  -o "$OUT/rosie.js"

echo ">>> Build complete:"
ls -la "$OUT/"
