#!/usr/bin/env bash
# Clean local test of a published Postern release on Debian/Ubuntu.
#   bash test-release.sh [tag] [--fresh]
#     tag      release to test (default: latest published)
#     --fresh  also wipe your Postern data (accounts, collections, mocks) for a first-run test
# Downloads into a throw-away folder, verifies the checksum, removes any older Postern, installs, starts it.
set -euo pipefail
REPO="${POSTERN_REPO:-infrahomeserver-max/postern}"
TAG=""; FRESH=0
for a in "$@"; do case "$a" in --fresh) FRESH=1 ;; *) TAG="$a" ;; esac; done
command -v curl >/dev/null || { echo "curl is required"; exit 1; }
ARCH="$(dpkg --print-architecture)"            # amd64 or arm64
if [ -z "$TAG" ]; then TAG="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest" | sed 's#.*/##')"; fi
case "$TAG" in v[0-9]*) ;; *) echo "No published release found. Wait for Actions -> Release to finish, or pass a tag: bash test-release.sh v0.0.0"; exit 1 ;; esac
VER="${TAG#v}"; DEB="Postern-$VER-linux-$ARCH.deb"
D="$(mktemp -d)"; trap 'rm -rf "$D"' EXIT; cd "$D"
echo "==> Downloading $TAG ($ARCH)"
curl -fsSLO "https://github.com/$REPO/releases/download/$TAG/SHA256SUMS"
curl -fL# -O "https://github.com/$REPO/releases/download/$TAG/$DEB"
echo "==> Verifying checksum"
sha256sum -c SHA256SUMS --ignore-missing | grep -F "$DEB"
echo "==> Removing any older Postern (your data is kept)"
pkill -x postern 2>/dev/null || true
sudo apt-get remove -y postern postern-lite >/dev/null 2>&1 || true
if [ "$FRESH" = 1 ]; then echo "==> --fresh: deleting ~/.local/share/postern"; rm -rf "$HOME/.local/share/postern" "$HOME/.config/Postern"; fi
echo "==> Installing"
sudo apt-get install -y "./$DEB"
echo "==> Installed: $(dpkg-query -W -f='${Package} ${Version}\n' postern)"
echo "Start it from the app menu, or run:  postern"
