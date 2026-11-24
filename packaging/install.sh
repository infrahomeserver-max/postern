#!/usr/bin/env bash
# Install, upgrade or cleanly reinstall Postern on Debian/Ubuntu from a published release.
#   curl -fsSL https://github.com/infrahomeserver-max/postern/releases/latest/download/install.sh | bash
#   curl -fsSL https://github.com/infrahomeserver-max/postern/releases/latest/download/install.sh | bash -s -- --purge
#   bash install.sh [tag] [--purge]
#     tag      release to install (default: latest published)
#     --purge  also delete your Postern data (accounts, collections, mocks) for a first-run clean install
# Downloads into a throw-away folder, verifies the SHA-256 checksum, removes any older Postern, installs, done.
set -euo pipefail
REPO="${POSTERN_REPO:-infrahomeserver-max/postern}"
TAG=""; PURGE=0
for a in "$@"; do case "$a" in --purge|--fresh) PURGE=1 ;; -h|--help) sed -n '2,8p' "$0"; exit 0 ;; *) TAG="$a" ;; esac; done
command -v curl >/dev/null || { echo "curl is required (sudo apt install curl)"; exit 1; }
command -v dpkg >/dev/null || { echo "This installer is for Debian/Ubuntu. Other systems: use the AppImage or tarball from the release page."; exit 1; }
SUDO=""; [ "$(id -u)" = 0 ] || { command -v sudo >/dev/null || { echo "Run as root or install sudo"; exit 1; }; SUDO="sudo"; }
ARCH="$(dpkg --print-architecture)"            # amd64 or arm64
case "$ARCH" in amd64|arm64) ;; *) echo "Unsupported CPU architecture: $ARCH"; exit 1 ;; esac
if [ -z "$TAG" ]; then TAG="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest" | sed 's#.*/##')"; fi
case "$TAG" in v[0-9]*) ;; *) echo "No published release found. Check https://github.com/$REPO/releases or pass a tag: bash install.sh v0.0.0"; exit 1 ;; esac
VER="${TAG#v}"; DEB="Postern-$VER-linux-$ARCH.deb"
D="$(mktemp -d)"; trap 'rm -rf "$D"' EXIT; cd "$D"
echo "==> Downloading Postern $TAG ($ARCH)"
curl -fsSLO "https://github.com/$REPO/releases/download/$TAG/SHA256SUMS"
curl -fL# -O "https://github.com/$REPO/releases/download/$TAG/$DEB"
echo "==> Verifying checksum"
sha256sum -c SHA256SUMS --ignore-missing 2>&1 | grep -F "$DEB" | grep -q ': OK' || { echo "Checksum check FAILED for $DEB - not installing."; exit 1; }
dpkg-deb --fsys-tarfile "$DEB" | tar -t >/dev/null || { echo "$DEB is corrupt - not installing."; exit 1; }
echo "==> Removing any older Postern (your data is kept unless --purge)"
pkill -x postern 2>/dev/null || true
$SUDO apt-get remove -y postern postern-lite >/dev/null 2>&1 || true
if [ "$PURGE" = 1 ]; then echo "==> --purge: deleting your Postern data"; rm -rf "$HOME/.local/share/postern" "$HOME/.config/Postern" "$HOME/.config/postern"; fi
echo "==> Installing"
$SUDO apt-get install -y "./$DEB"
echo "==> Installed: $(dpkg-query -W -f='${Package} ${Version}\n' postern)"
echo "Start it from the app menu, or run:  postern"
