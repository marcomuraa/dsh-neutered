#!/bin/bash
# dsh-neutered: install the pinned llama.cpp server build from a local tarball.
#
# Usage: install.sh <path-to-llama-<tag>-bin-macos-arm64.tar.gz>
#
# This script never touches the network. Download the release asset named in
# VERSION on a connected machine (README.md gives the URL), copy it here, then
# run this script. It refuses a tarball whose SHA-256 differs from VERSION,
# unpacks only llama-server and the libraries it links into bin/, and checks
# every unpacked file against SHA256SUMS. Exit 0 on success, 1 on a hash or
# layout mismatch, 2 on a usage error.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tarball="${1:-}"
if [ -z "$tarball" ] || [ ! -f "$tarball" ]; then
  echo "usage: install.sh <llama-<tag>-bin-macos-arm64.tar.gz>" >&2
  exit 2
fi

tag="$(sed -n 's/^tag=//p' "$here/VERSION")"
asset="$(sed -n 's/^asset=//p' "$here/VERSION")"
want="$(sed -n 's/^sha256=//p' "$here/VERSION")"
if [ -z "$tag" ] || [ -z "$asset" ] || [ -z "$want" ]; then
  echo "install: $here/VERSION is incomplete (needs tag=, asset=, sha256=)" >&2
  exit 1
fi

got="$(shasum -a 256 "$tarball" | awk '{print $1}')"
if [ "$got" != "$want" ]; then
  echo "install: tarball SHA-256 mismatch for $tarball" >&2
  echo "  expected $want ($asset)" >&2
  echo "  got      $got" >&2
  exit 1
fi

# Only the members listed in SHA256SUMS are unpacked; the tarball's other tools
# (llama-cli, llama-bench, ggml-rpc-server, ...) stay out of the artifact.
members=()
while IFS= read -r name; do
  [ -n "$name" ] && members+=("llama-$tag/$name")
done < <(awk '{print $2}' "$here/SHA256SUMS")

bin="$here/bin"
rm -rf "$bin"
mkdir -p "$bin"
tar -xzf "$tarball" -C "$bin" --strip-components 1 "${members[@]}"
chmod 755 "$bin"/llama-server "$bin"/*.dylib
xattr -d com.apple.quarantine "$bin"/* 2>/dev/null || true

if ! (cd "$bin" && shasum -a 256 -c "$here/SHA256SUMS" --status); then
  echo "install: unpacked files do not match $here/SHA256SUMS" >&2
  exit 1
fi

"$bin/llama-server" --version 2>&1 | head -1
echo "install: llama-server $tag installed in $bin"
