#!/usr/bin/env bash
# Postern installer for Linux and macOS (run from the extracted download). Installs for the current user, no sudo,
# with its own Node.js; the system Node.js is never touched. Everything it creates is listed in a manifest.
#   ./install.sh               install / upgrade
#   ./install.sh --dry-run     show what would happen
#   ./install.sh --prefix DIR  install the app into DIR (default: ~/.local/opt/postern, or ~/Applications/Postern.app on macOS)
#   ./install.sh --remove-old  also remove an old system-wide install (/opt/devhub, needs sudo)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OS="$(uname -s)"; DRY=0; PREFIX=""; OLD=0
while [ $# -gt 0 ]; do case "$1" in
  --dry-run) DRY=1;; --prefix) PREFIX="${2:?}"; shift;; --remove-old) OLD=1;;
  -h|--help) sed -n 2,8p "$0"; exit 0;; *) echo "unknown option: $1" >&2; exit 2;; esac; shift; done
say() { printf '==> %s\n' "$*"; }
run() { if [ $DRY = 1 ]; then printf '    %s\n' "$*"; else "$@"; fi; }
[ -x "$HERE/runtime/node" ] && [ -f "$HERE/app/desktop/launch.mjs" ] || { echo "run this from the extracted Postern folder" >&2; exit 1; }
VERSION="$(cat "$HERE/app/VERSION")"
BIN="$HOME/.local/bin"
if [ "$OS" = Darwin ]; then
  APPDIR="${PREFIX:-$HOME/Applications/Postern.app}"; ROOT="$APPDIR/Contents/Resources"; MAN="$HOME/Library/Application Support/Postern/install-manifest.txt"
else
  ROOT="${PREFIX:-$HOME/.local/opt/postern}"; MAN="$ROOT/install-manifest.txt"
  ICONS="$HOME/.local/share/icons/hicolor"; APPS="$HOME/.local/share/applications"
fi

if [ $OLD = 1 ] || [ -d /opt/devhub ]; then
  if [ -d /opt/devhub ] && [ $OLD = 1 ]; then
    say "Removing the old system-wide install (needs sudo)"
    run sudo sh -c 'systemctl disable --now devhub 2>/dev/null; rm -rf /opt/devhub /usr/local/bin/postern /usr/share/applications/postern.desktop /usr/share/icons/hicolor/*/apps/postern.png /etc/systemd/system/devhub.service; systemctl daemon-reload 2>/dev/null; true'
  elif [ -d /opt/devhub ]; then
    echo "note: an old system-wide install exists in /opt/devhub. Re-run with --remove-old to remove it (your data is kept)."
  fi
fi

say "Installing Postern $VERSION into $ROOT"
run rm -rf "$ROOT/app" "$ROOT/runtime"
run mkdir -p "$ROOT"
run cp -a "$HERE/app" "$HERE/runtime" "$ROOT/"
run mkdir -p "$BIN"
if [ "$OS" = Darwin ]; then
  run mkdir -p "$APPDIR/Contents/MacOS"
  if [ $DRY = 0 ]; then
    cat > "$APPDIR/Contents/MacOS/Postern" <<L
#!/bin/sh
exec "\$(dirname "\$0")/../Resources/runtime/node" "\$(dirname "\$0")/../Resources/app/desktop/launch.mjs" "\$@"
L
    chmod 755 "$APPDIR/Contents/MacOS/Postern"
    cat > "$APPDIR/Contents/Info.plist" <<L
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Postern</string><key>CFBundleDisplayName</key><string>Postern</string>
<key>CFBundleIdentifier</key><string>io.github.infrahomeserver-max.postern</string>
<key>CFBundleExecutable</key><string>Postern</string><key>CFBundleIconFile</key><string>postern</string>
<key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>$VERSION</string>
<key>CFBundleVersion</key><string>$VERSION</string><key>LSMinimumSystemVersion</key><string>11.0</string>
<key>LSUIElement</key><false/><key>NSHighResolutionCapable</key><true/>
</dict></plist>
L
    if command -v iconutil >/dev/null && command -v sips >/dev/null; then
      T="$(mktemp -d)"; S="$T/postern.iconset"; mkdir "$S"
      for z in 16 32 64 128 256 512; do sips -z $z $z "$HERE/icons/icon-512.png" --out "$S/icon_${z}x${z}.png" >/dev/null; done
      cp "$S/icon_32x32.png" "$S/icon_16x16@2x.png"; cp "$S/icon_64x64.png" "$S/icon_32x32@2x.png"
      cp "$S/icon_256x256.png" "$S/icon_128x128@2x.png"; cp "$S/icon_512x512.png" "$S/icon_256x256@2x.png"; cp "$HERE/icons/icon-512.png" "$S/icon_512x512@2x.png"
      rm "$S/icon_64x64.png"; iconutil -c icns "$S" -o "$APPDIR/Contents/Resources/postern.icns" || true; rm -rf "$T"
    fi
    xattr -dr com.apple.quarantine "$APPDIR" 2>/dev/null || true
  else echo "    write $APPDIR/Contents/{MacOS/Postern,Info.plist,Resources/postern.icns}"; fi
  LAUNCH="$ROOT/runtime/node $ROOT/app/desktop/launch.mjs"
else
  for z in 192 512; do run install -D -m 644 "$HERE/icons/icon-$z.png" "$ICONS/${z}x${z}/apps/postern.png"; done
  run install -D -m 644 "$HERE/icons/icon.svg" "$ICONS/scalable/apps/postern.svg"
  if [ $DRY = 0 ]; then
    mkdir -p "$APPS"; sed "s#^Exec=.*#Exec=$BIN/postern#" "$HERE/postern.desktop" > "$APPS/postern.desktop"
    command -v update-desktop-database >/dev/null && update-desktop-database -q "$APPS" || true
    command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t -f "$ICONS" 2>/dev/null || true
  else echo "    write $APPS/postern.desktop"; fi
fi
if [ $DRY = 0 ]; then
  printf '#!/bin/sh\nexec "%s/runtime/node" "%s/app/desktop/launch.mjs" "$@"\n' "$ROOT" "$ROOT" > "$BIN/postern"; chmod 755 "$BIN/postern"
  mkdir -p "$(dirname "$MAN")"
  { echo "$ROOT"; echo "$BIN/postern"; [ "$OS" = Darwin ] && echo "$APPDIR" || { echo "$APPS/postern.desktop"; ls "$ICONS"/*/apps/postern.* 2>/dev/null; }; } > "$MAN"
  cp "$HERE/uninstall.sh" "$ROOT/uninstall.sh" 2>/dev/null || true
else echo "    write $BIN/postern"; fi
case ":$PATH:" in *":$BIN:"*) ;; *) echo "note: add $BIN to your PATH to run 'postern' from a terminal (the menu entry works already).";; esac
say "Done. Open Postern from your applications menu$([ "$OS" = Darwin ] && echo ' (~/Applications)'). Your data stays in $([ "$OS" = Darwin ] && echo "~/Library/Application Support/Postern" || echo "~/.local/share/postern")."
echo "    Remove with: $ROOT/uninstall.sh   (add --purge to also delete your data)"
