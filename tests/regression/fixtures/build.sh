#!/usr/bin/env bash
# Build tarball fixtures from sources/ into repos/.
#
# For each sources/<owner>/<repo>/<ref>/ tree, produces:
#   repos/<owner>/<repo>/archive/refs/heads/<ref>.tar.gz
#
# Tags vs branches: if <ref> looks like a semver tag (starts with "v" followed
# by a digit), also installs to refs/tags/. Otherwise refs/heads/.
#
# GitHub's tarball convention puts a single top-level directory named
# "<repo>-<ref>" — we replicate that here so archive.c's get_archive_root_dir
# resolves the way the install logic expects.
#
# Tarballs are produced deterministically: mtime, uid/gid, and ordering are
# normalized so the tarball bytes are reproducible across machines.

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SOURCES="$HERE/sources"
REPOS="$HERE/repos"

rm -rf "$REPOS"
mkdir -p "$REPOS"

# Walk sources/<owner>/<repo>/<ref>/ directories.
find "$SOURCES" -mindepth 3 -maxdepth 3 -type d | while read -r ref_dir; do
    ref=$(basename "$ref_dir")
    repo=$(basename "$(dirname "$ref_dir")")
    owner=$(basename "$(dirname "$(dirname "$ref_dir")")")

    # Decide branch vs tag from the ref name.
    case "$ref" in
        v[0-9]*) kind=tags ;;
        *)       kind=heads ;;
    esac

    out_dir="$REPOS/$owner/$repo/archive/refs/$kind"
    mkdir -p "$out_dir"
    out_tar="$out_dir/$ref.tar.gz"

    # Stage a temp dir with the "<repo>-<ref>/" wrapping that GitHub adds.
    stage=$(mktemp -d)
    cp -R "$ref_dir" "$stage/$repo-$ref"

    # Deterministic tar: sorted file order, fixed mtime/uid/gid/numeric.
    # GNU tar flags. (BSD tar — on macOS — would need a different incantation;
    # tests are expected to run on Linux primarily.)
    tar --sort=name \
        --mtime='2025-01-01T00:00:00Z' \
        --owner=0 --group=0 --numeric-owner \
        -C "$stage" -czf "$out_tar" "$repo-$ref"

    rm -rf "$stage"
    echo "built $out_tar"
done

# info/refs fixtures: sources/<owner>/<repo>/info-refs.txt is a human-editable
# spec — one "ref<TAB>sha" line per ref. We compile it into the pkt-line
# binary blob rosie's resolver consumes.
find "$SOURCES" -mindepth 3 -maxdepth 3 -type f -name "info-refs.txt" | while read -r spec; do
    repo=$(basename "$(dirname "$spec")")
    owner=$(basename "$(dirname "$(dirname "$spec")")")
    out_dir="$REPOS/$owner/$repo/info"
    mkdir -p "$out_dir"
    python3 "$HERE/make_info_refs.py" "$spec" "$out_dir/refs"
    echo "built $out_dir/refs"
done
