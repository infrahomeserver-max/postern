#!/usr/bin/env bash
# Build postern-<version>-<os>-<arch>.{tar.gz|zip}: app + that platform's official Node.js + installer.
# usage: packaging/build-portable.sh <linux|macos|windows> <x64|arm64> [outdir]      (web/dist must be built)
# env:   NODE_VERSION (default 22.23.4 line, newest 22.x if unset), NODE_DIST_DIR (use a pre-extracted Node folder, offline)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OS="${1:?os}"; ARCH="${2:?arch}"; OUT="${3:-$HERE/dist}"
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"   # absolute: the zip/tar steps run from another directory
case "$OS" in linux) NP=linux; EXT=tar.xz;; macos) NP=darwin; EXT=tar.xz;; windows) NP=win; EXT=zip;; *) echo "bad os" >&2; exit 2;; esac
[ -f "$HERE/web/dist/index.html" ] || { echo "build the UI first: npx vite build web" >&2; exit 1; }
VER="$(node -p "require('$HERE/package.json').version")"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
B="$W/postern-$VER-$OS-$ARCH"; mkdir -p "$B/app/web" "$B/runtime" "$B/icons" "$OUT"

# --- Node.js runtime: official build, checksum-verified
if [ -n "${NODE_DIST_DIR:-}" ]; then ND="$NODE_DIST_DIR"
else
  NV="${NODE_VERSION:-$(curl -fsSL https://nodejs.org/dist/index.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).find(x=>x.version.startsWith("v22.")).version.slice(1)))')}"
  F="node-v$NV-$NP-$ARCH.$EXT"; BASE="https://nodejs.org/dist/v$NV"
  curl -fsSL -o "$W/$F" "$BASE/$F"; curl -fsSL -o "$W/SHASUMS256.txt" "$BASE/SHASUMS256.txt"
  (cd "$W" && grep " $F\$" SHASUMS256.txt | sha256sum -c -) || { echo "Node.js checksum mismatch" >&2; exit 1; }
  mkdir "$W/n"; if [ $EXT = zip ]; then unzip -q "$W/$F" -d "$W/n"; else tar -xJf "$W/$F" -C "$W/n"; fi
  ND="$(echo "$W"/n/node-v*)"
fi
if [ "$OS" = windows ]; then cp "$ND/node.exe" "$B/runtime/"; else install -m0755 "$ND/bin/node" "$B/runtime/node"; fi
[ -f "$ND/LICENSE" ] && cp "$ND/LICENSE" "$B/runtime/LICENSE-node"

# --- app (pure JavaScript: identical on every platform)
cp -a "$HERE/server" "$HERE/desktop" "$B/app/"; cp -a "$HERE/web/dist" "$B/app/web/dist"
cp "$HERE/package.json" "$HERE/package-lock.json" "$B/app/"; echo "$VER" > "$B/app/VERSION"
(cd "$B/app" && npm ci --omit=dev --no-audit --no-fund --ignore-scripts >/dev/null)
cp "$HERE/web/dist/icon-192.png" "$HERE/web/dist/icon-512.png" "$HERE/web/public/icon.svg" "$B/icons/"
cp "$HERE/LICENSE" "$HERE/README.md" "$HERE/CHANGELOG.md" "$B/"
case "$OS" in
  windows) cp "$HERE/packaging/portable/install.ps1" "$HERE/packaging/portable/uninstall.ps1" "$HERE/packaging/postern.ico" "$B/"
           cat > "$B/install.cmd" <<'L'
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
L
           (cd "$W" && zip -qr "$OUT/postern-$VER-$OS-$ARCH.zip" "postern-$VER-$OS-$ARCH"); R="$OUT/postern-$VER-$OS-$ARCH.zip";;
  *)       cp "$HERE/packaging/portable/install.sh" "$HERE/packaging/portable/uninstall.sh" "$HERE/packaging/postern.desktop" "$B/"
           tar -C "$W" -czf "$OUT/postern-$VER-$OS-$ARCH.tar.gz" "postern-$VER-$OS-$ARCH"; R="$OUT/postern-$VER-$OS-$ARCH.tar.gz";;
esac
echo "$R"
