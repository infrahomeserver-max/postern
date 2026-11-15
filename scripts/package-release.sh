#!/usr/bin/env bash
# Builds dist/postern-<version>.tar.gz (+ .sha256): prebuilt UI, server, installer.
set -euo pipefail
cd "$(dirname "$0")/.."
V=$(node -p "require('./package.json').version")
npm ci --no-audit --no-fund
npx vite build web
S=$(mktemp -d); R="$S/postern-$V"; mkdir -p "$R" dist
cp -a server desktop package.json package-lock.json README.md CHANGELOG.md LICENSE SECURITY.md deploy docs "$R/"
mkdir -p "$R/web"; cp -a web/dist "$R/web/dist"
echo "$V" > "$R/VERSION"
tar -C "$S" -czf "dist/postern-$V.tar.gz" "postern-$V"
(cd dist && sha256sum "postern-$V.tar.gz" > "postern-$V.tar.gz.sha256")
rm -rf "$S"; ls -la dist
