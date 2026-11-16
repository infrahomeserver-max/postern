#!/usr/bin/env bash
# Build the Linux desktop .deb ourselves from electron-builder's unpacked app folder.
# (electron-builder's own .deb output was sometimes corrupt on CI runners: stray bytes or a damaged xz stream.)
#   bash packaging/build-desktop-deb.sh <unpacked-dir> <amd64|arm64> <out-dir>
# The result is verified end to end (ar layout, control data, and a full decompression of the file tree).
set -euo pipefail
SRC="$1"; ARCH="$2"; OUT="$3"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$HERE")"
VER="$(node -p "require('$ROOT/package.json').version")"
[ -x "$SRC/postern" ] || { echo "no app in $SRC"; exit 1; }
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
install -d "$STAGE/opt/Postern" "$STAGE/DEBIAN" "$STAGE/usr/share/applications" "$STAGE/usr/share/doc/postern" "$STAGE/usr/share/icons/hicolor/512x512/apps"
cp -a "$SRC/." "$STAGE/opt/Postern/"
install -m 0644 "$HERE/deb/apparmor-profile" "$STAGE/opt/Postern/resources/apparmor-profile"
chmod 0755 "$STAGE/opt/Postern/postern" "$STAGE/opt/Postern/chrome-sandbox"
install -m 0644 "$ROOT/packaging/electron/icon.png" "$STAGE/usr/share/icons/hicolor/512x512/apps/postern.png"
cat > "$STAGE/usr/share/applications/postern.desktop" <<'DESK'
[Desktop Entry]
Name=Postern
Exec=/opt/Postern/postern %U
Terminal=false
Type=Application
Icon=postern
StartupWMClass=postern
Comment=Self-hosted API tester + SFTP client
Categories=Development;
DESK
chmod 0644 "$STAGE/usr/share/applications/postern.desktop"
printf 'postern (%s) unstable; urgency=low\n\n  * Release %s\n\n -- Postern contributors <noreply@example.com>  %s\n' "$VER" "$VER" "$(date -R)" | gzip -9n > "$STAGE/usr/share/doc/postern/changelog.gz"
install -m 0755 "$HERE/deb/postinst" "$STAGE/DEBIAN/postinst"; install -m 0755 "$HERE/deb/postrm" "$STAGE/DEBIAN/postrm"
SIZE="$(du -sk "$STAGE" | cut -f1)"
cat > "$STAGE/DEBIAN/control" <<CTL
Package: postern
Version: $VER
License: MIT
Vendor: Postern contributors <noreply@example.com>
Architecture: $ARCH
Maintainer: Postern contributors <noreply@example.com>
Installed-Size: $SIZE
Depends: libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libuuid1, libsecret-1-0
Recommends: libappindicator3-1
Conflicts: postern-lite
Replaces: postern-lite
Section: devel
Priority: optional
Homepage: https://github.com/infrahomeserver-max/postern
Description: API tester and SFTP client
 Self-hosted API tester + SFTP client
CTL
(cd "$STAGE" && find . -path ./DEBIAN -prune -o -type f -printf '%P\0' | sort -z | xargs -0 md5sum > DEBIAN/md5sums)
FILE="$OUT/Postern-$VER-linux-$ARCH.deb"; rm -f "$FILE"
dpkg-deb --root-owner-group -Zxz -z6 --build "$STAGE" "$FILE" >/dev/null
# ---- verify the finished file ----
[ "$(ar t "$FILE" | tr '\n' ' ')" = "debian-binary control.tar.xz data.tar.xz " ] || { echo "bad ar layout"; exit 1; }
python3 - "$FILE" <<'PY'
import sys
d = open(sys.argv[1], 'rb').read(); i = 8
while i + 60 <= len(d) and d[i+58:i+60] == b'`\n': n = int(d[i+48:i+58]); i += 60 + n + (n % 2)
assert i == len(d), 'stray bytes after the last ar member'
PY
dpkg-deb -I "$FILE" >/dev/null
dpkg-deb --fsys-tarfile "$FILE" | tar -t >/dev/null          # full decompression of the data
test "$(dpkg-deb -c "$FILE" | wc -l)" -gt 500
echo "built and verified: $FILE ($(du -h "$FILE" | cut -f1))"
