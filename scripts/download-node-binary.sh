#!/usr/bin/env bash
# Downloads a Node.js 24 LTS binary for the current Rust target triple
# and places it at src-tauri/binaries/node-<triple>
#
# Node 24 is required to match the NODE_MODULE_VERSION of better-sqlite3
# compiled by the host toolchain (NMV 137 = Node 24).
#
# Run: npm run build:node-binary

set -e

NODE_VERSION="24.14.1"
BINARIES_DIR="$(dirname "$0")/../src-tauri/binaries"
mkdir -p "$BINARIES_DIR"

# Detect Rust target triple
TRIPLE=$(rustc -vV 2>/dev/null | sed -n 's/^host: //p')
if [ -z "$TRIPLE" ]; then
  echo "Error: rustc not found. Install Rust from https://rustup.rs" >&2
  exit 1
fi

OUTPUT="$BINARIES_DIR/node-$TRIPLE"

# If already present, skip
if [ -f "$OUTPUT" ]; then
  echo "Node binary already exists: $OUTPUT"
  exit 0
fi

echo "Downloading Node.js $NODE_VERSION for $TRIPLE..."

# Map Rust triple → Node.js platform/arch
case "$TRIPLE" in
  aarch64-apple-darwin)      PLATFORM="darwin"; ARCH="arm64";  EXT="tar.gz" ;;
  x86_64-apple-darwin)       PLATFORM="darwin"; ARCH="x64";    EXT="tar.gz" ;;
  x86_64-pc-windows-msvc)    PLATFORM="win";    ARCH="x64";    EXT="zip"    ;;
  i686-pc-windows-msvc)      PLATFORM="win";    ARCH="x86";    EXT="zip"    ;;
  aarch64-pc-windows-msvc)   PLATFORM="win";    ARCH="arm64";  EXT="zip"    ;;
  x86_64-unknown-linux-gnu)  PLATFORM="linux";  ARCH="x64";    EXT="tar.gz" ;;
  aarch64-unknown-linux-gnu) PLATFORM="linux";  ARCH="arm64";  EXT="tar.gz" ;;
  *)
    echo "Error: Unsupported Rust target triple: $TRIPLE" >&2
    exit 1
    ;;
esac

BASENAME="node-v${NODE_VERSION}-${PLATFORM}-${ARCH}"
URL="https://nodejs.org/dist/v${NODE_VERSION}/${BASENAME}.${EXT}"
TMPDIR=$(mktemp -d)

echo "  URL: $URL"

if [ "$EXT" = "tar.gz" ]; then
  curl -fL "$URL" | tar -xz -C "$TMPDIR"
  NODE_BINARY="$TMPDIR/$BASENAME/bin/node"
else
  # Windows ZIP
  ZIPFILE="$TMPDIR/node.zip"
  curl -fL -o "$ZIPFILE" "$URL"
  unzip -q "$ZIPFILE" -d "$TMPDIR"
  NODE_BINARY="$TMPDIR/$BASENAME/node.exe"
  OUTPUT="${OUTPUT}.exe"
fi

cp "$NODE_BINARY" "$OUTPUT"
chmod +x "$OUTPUT"
rm -rf "$TMPDIR"

echo "Node binary saved to: $OUTPUT"
