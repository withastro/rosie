#!/usr/bin/env python3
# Build a git smart-HTTP info/refs response from a simple spec file.
#
# Input format (one ref per non-empty, non-# line, whitespace-separated):
#   <ref-name>   <40-char-sha>
#
# Example:
#   HEAD                  0000000000000000000000000000000000000001
#   refs/heads/main       0000000000000000000000000000000000000001
#   refs/tags/v1.0.0      aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
#   refs/tags/v1.0.0^{}   bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
#
# Output is the pkt-line stream rosie's resolve.c parser expects:
#   - service header pkt-line ("# service=git-upload-pack\n")
#   - flush ("0000")
#   - first ref: "<sha> <ref>\0<capabilities>\n" pkt-line
#   - subsequent refs: "<sha> <ref>\n" pkt-lines
#   - final flush ("0000")
#
# Usage:
#   make_info_refs.py <input-spec> <output-binary>

import sys


def pkt_line(payload: bytes) -> bytes:
    length = len(payload) + 4
    return f"{length:04x}".encode("ascii") + payload


def main():
    if len(sys.argv) != 3:
        print("usage: make_info_refs.py <input> <output>", file=sys.stderr)
        sys.exit(2)
    inp, out = sys.argv[1], sys.argv[2]

    refs = []
    with open(inp, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) != 2:
                print(f"bad line: {line!r}", file=sys.stderr)
                sys.exit(1)
            name, sha = parts
            if len(sha) != 40:
                print(f"sha must be 40 hex chars: {sha}", file=sys.stderr)
                sys.exit(1)
            refs.append((name, sha))

    out_buf = bytearray()
    out_buf += pkt_line(b"# service=git-upload-pack\n")
    out_buf += b"0000"

    caps = b"multi_ack thin-pack side-band side-band-64k ofs-delta shallow no-progress include-tag"
    for i, (name, sha) in enumerate(refs):
        if i == 0:
            line = f"{sha} {name}".encode("ascii") + b"\x00" + caps + b"\n"
        else:
            line = f"{sha} {name}\n".encode("ascii")
        out_buf += pkt_line(line)
    out_buf += b"0000"

    with open(out, "wb") as f:
        f.write(out_buf)


if __name__ == "__main__":
    main()
