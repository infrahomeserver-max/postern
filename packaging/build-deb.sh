#!/usr/bin/env bash
# Build postern-lite_<version>-1_<arch>.deb with its own Node.js runtime (never touches the system Node).
# usage: packaging/build-deb.sh [path/to/node] [outdir] [amd64|arm64]    (web/dist must already be built)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="${1:-$(command -v node)}"; OUT="${2:-$HERE/dist}"; ARCH="${3:-$(dpkg --print-architecture)}"
[ -x "$NODE" ] || { echo "node binary not found: $NODE" >&2; exit 1; }
[ -f "$HERE/web/dist/index.html" ] || { echo "build the UI first: npx vite build web" >&2; exit 1; }
VER="$(node -p "require('$HERE/package.json').version")"
ROOT="$(mktemp -d)"; trap 'rm -rf "$ROOT"' EXIT; chmod 0755 "$ROOT"
APP="$ROOT/opt/postern"; mkdir -p "$APP/bin" "$OUT"
cp -a "$HERE/server" "$HERE/desktop" "$APP/"
mkdir -p "$APP/web"; cp -a "$HERE/web/dist" "$APP/web/dist"
cp "$HERE/package.json" "$HERE/package-lock.json" "$APP/"; echo "$VER" > "$APP/VERSION"
install -m0755 "$NODE" "$APP/bin/node"
(cd "$APP" && npm ci --omit=dev --no-audit --no-fund --ignore-scripts >/dev/null)
find "$APP" -name '*.md' -path '*/node_modules/*' -delete 2>/dev/null || true
install -Dm0755 /dev/stdin "$ROOT/usr/bin/postern" <<'L'
#!/bin/sh
exec /opt/postern/bin/node /opt/postern/desktop/launch.mjs "$@"
L
for z in 192 512; do install -Dm0644 "$HERE/web/dist/icon-$z.png" "$ROOT/usr/share/icons/hicolor/${z}x${z}/apps/postern.png"; done
install -Dm0644 "$HERE/web/public/icon.svg" "$ROOT/usr/share/icons/hicolor/scalable/apps/postern.svg"
install -Dm0644 "$HERE/packaging/postern.desktop" "$ROOT/usr/share/applications/postern.desktop"
D="$ROOT/usr/share/doc/postern"
install -Dm0644 "$HERE/README.md" "$D/README.md"; gzip -9n "$D/README.md"
install -Dm0644 "$HERE/CHANGELOG.md" "$D/changelog"; gzip -9n "$D/changelog"
{ printf 'Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/\nUpstream-Name: postern\n\nFiles: *\nCopyright: 2026 Infra Server\nLicense: MIT\n\nBundled Node.js (MIT) and npm dependencies keep their own licences.\n\nLicense: MIT\n'
  sed 's/^/ /;s/^ $/ ./' "$HERE/LICENSE"; } > "$D/copyright"
mkdir -p "$ROOT/DEBIAN"
SIZE=$(du -sk "$ROOT/opt" "$ROOT/usr" | awk '{s+=$1} END{print s}')
cat > "$ROOT/DEBIAN/control" <<C
Package: postern-lite
Conflicts: postern
Replaces: postern
Version: $VER-1
Section: devel
Priority: optional
Architecture: $ARCH
Depends: libc6 (>= 2.31), libstdc++6
Recommends: chromium | chromium-browser | google-chrome-stable
Installed-Size: $SIZE
Maintainer: Postern contributors <noreply@example.com>
Description: API, SOAP and SFTP workspace
 REST and SOAP/WSDL API tester with collections, environments and mock
 servers, plus an SFTP client with a site manager and file transfer.
 Opens as an app window on a free local port and stops when closed.
 Ships its own Node.js runtime; the system Node.js is not used or changed.
C
cat > "$ROOT/DEBIAN/preinst" <<'C'
#!/bin/sh
# Clean out an older tarball/installer-based Postern (/opt/devhub) so the package starts from a clean state. User data is kept.
set -e
if [ -d /opt/devhub ] || [ -f /etc/systemd/system/devhub.service ]; then
  systemctl disable --now devhub >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/devhub.service; systemctl daemon-reload >/dev/null 2>&1 || true
  rm -rf /opt/devhub
  rm -f /usr/local/bin/postern
fi
exit 0
C
chmod 0755 "$ROOT/DEBIAN/preinst"
for s in postinst postrm; do cat > "$ROOT/DEBIAN/$s" <<'C'
#!/bin/sh
set -e
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache  >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
exit 0
C
chmod 0755 "$ROOT/DEBIAN/$s"; done
DEB="$OUT/postern-lite_${VER}-1_${ARCH}.deb"
dpkg-deb --root-owner-group -Zxz --build "$ROOT" "$DEB" >/dev/null
echo "$DEB"
