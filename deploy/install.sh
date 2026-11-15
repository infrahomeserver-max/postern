#!/usr/bin/env bash
# Postern installer for Ubuntu 20.04 / 22.04 / 24.04 (also works on Debian 11+).
#
#   sudo ./deploy/install.sh              Desktop app (default): an icon in the applications menu. The app
#                                         starts when you open it, picks a free port, and stops when you close it.
#   sudo ./deploy/install.sh --service    Always-on server (systemd) for a shared machine or remote access.
#
# Options: --port N --host ADDR (service mode)  --yes (don't ask before upgrading Node.js)
# Safe to re-run: upgrades the code, keeps config and data. Switching mode is just re-running with/without --service.
set -euo pipefail

APP_DIR=/opt/devhub; DATA_DIR=/var/lib/devhub; CONF_DIR=/etc/devhub
MODE=desktop; PORT=3210; HOST=127.0.0.1; PORT_SET=0; HOST_SET=0; YES=0
while [ $# -gt 0 ]; do case "$1" in
  --service) MODE=service; shift;; --desktop) MODE=desktop; shift;;
  --port) PORT="$2"; PORT_SET=1; shift 2;; --host) HOST="$2"; HOST_SET=1; shift 2;;
  --yes|-y) YES=1; shift;; -h|--help) sed -n 2,10p "$0"; exit 0;;
  *) echo "Unknown option $1"; exit 1;; esac; done

[ "$(id -u)" = 0 ] || { echo "Run as root: sudo $0"; exit 1; }
SRC="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$SRC/server/index.js" ] || { echo "Run from an extracted release or repo checkout."; exit 1; }
say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
has_systemd() { command -v systemctl >/dev/null && [ -d /run/systemd/system ]; }

say "Checking OS"
. /etc/os-release; echo "$PRETTY_NAME"
command -v apt-get >/dev/null || { echo "apt-get not found: this installer targets Ubuntu/Debian."; exit 1; }

need_node=1
if command -v node >/dev/null; then
  major=$(node -p 'process.versions.node.split(".")[0]')
  [ "$major" -ge 22 ] && need_node=0
fi
if [ $need_node = 1 ]; then
  if command -v node >/dev/null && [ $YES = 0 ]; then
    echo "Node $(node -v) is installed, but Postern needs Node 22 or newer."
    echo "Upgrading replaces the system Node.js and removes Ubuntu packages that depend on the old one"
    echo "(for example the apt versions of npm, eslint and webpack)."
    read -r -p "Replace the system Node.js with Node 22? [y/N] " a </dev/tty || a=n
    case "$a" in y|Y|yes) ;; *) echo "Stopped. Nothing was changed. Re-run with --yes to skip this question."; exit 1;; esac
  fi
  say "Installing Node.js 22 (NodeSource)"
  apt-get update -y; apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "Node $(node -v)"

if [ ! -f "$SRC/web/dist/index.html" ]; then
  say "No prebuilt UI found: building from source"
  (cd "$SRC" && npm ci && npx vite build web)
fi

say "Copying application to $APP_DIR"
install -d -m 755 "$APP_DIR"
for f in server desktop web/dist package.json package-lock.json; do
  mkdir -p "$APP_DIR/$(dirname "$f")"; rm -rf "${APP_DIR:?}/$f"; cp -a "$SRC/$f" "$APP_DIR/$f"
done
[ -f "$SRC/VERSION" ] && cp "$SRC/VERSION" "$APP_DIR/VERSION" || true
say "Installing production dependencies"
(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund)
chown -R root:root "$APP_DIR"

if [ $MODE = service ]; then
  say "Creating service user and folders"
  id devhub >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin devhub
  install -d -o devhub -g devhub -m 700 "$DATA_DIR"; install -d -m 755 "$CONF_DIR"
  if [ ! -f "$CONF_DIR/devhub.env" ]; then
    say "Writing $CONF_DIR/devhub.env"
    sed -e "s/^PORT=.*/PORT=$PORT/" -e "s/^HOST=.*/HOST=$HOST/" "$SRC/deploy/devhub.env.example" > "$CONF_DIR/devhub.env"
    chmod 640 "$CONF_DIR/devhub.env"; chgrp devhub "$CONF_DIR/devhub.env"
  else
    echo "Keeping existing $CONF_DIR/devhub.env"
    [ $PORT_SET = 1 ] && sed -i "s/^PORT=.*/PORT=$PORT/" "$CONF_DIR/devhub.env" && echo "  port set to $PORT"
    [ $HOST_SET = 1 ] && sed -i "s/^HOST=.*/HOST=$HOST/" "$CONF_DIR/devhub.env" && echo "  host set to $HOST"
  fi
  install -m 644 "$SRC/deploy/nginx.conf.example" "$CONF_DIR/nginx.conf.example"
  P=$(grep '^PORT=' "$CONF_DIR/devhub.env" | cut -d= -f2)
  if has_systemd; then
    say "Installing systemd service"
    install -m 644 "$SRC/deploy/devhub.service" /etc/systemd/system/devhub.service
    systemctl daemon-reload; systemctl enable devhub; systemctl restart devhub
    sleep 2; systemctl --no-pager --lines=5 status devhub || true
  else
    say "No systemd here. Start manually with:"
    echo "  sudo -u devhub env \$(grep -v '^#' $CONF_DIR/devhub.env | xargs) NODE_ENV=production node $APP_DIR/server/index.js"
  fi
  cat > /usr/local/bin/postern <<LAUNCH
#!/bin/sh
# Opens the always-on Postern service in its own window.
URL="http://localhost:$P"
for b in google-chrome google-chrome-stable chromium chromium-browser brave-browser microsoft-edge microsoft-edge-stable; do
  if command -v "\$b" >/dev/null 2>&1; then exec "\$b" --app="\$URL" --class=postern --name=postern "\$@"; fi
done
exec xdg-open "\$URL"
LAUNCH
else
  # Desktop mode: nothing runs in the background. Turn off an earlier always-on service, and bring its data along.
  if has_systemd && [ -f /etc/systemd/system/devhub.service ]; then
    say "Switching from the always-on service to the desktop app"
    systemctl disable --now devhub 2>/dev/null || true
    rm -f /etc/systemd/system/devhub.service; systemctl daemon-reload
  fi
  U="${SUDO_USER:-}"
  if [ -n "$U" ] && [ "$U" != root ] && [ -f "$DATA_DIR/devhub.db" ]; then
    UH=$(getent passwd "$U" | cut -d: -f6); T="$UH/.local/share/postern"
    if [ ! -e "$T/devhub.db" ]; then
      say "Copying your existing data to $T"
      install -d -o "$U" -g "$(id -gn "$U")" -m 700 "$UH/.local" "$UH/.local/share" 2>/dev/null || true
      install -d -o "$U" -g "$(id -gn "$U")" -m 700 "$T"
      cp -a "$DATA_DIR/." "$T/"; chown -R "$U:$(id -gn "$U")" "$T"
      echo "The original stays in $DATA_DIR (once you have checked the app, remove it with: sudo rm -rf /var/lib/devhub /etc/devhub)"
    fi
  fi
  cat > /usr/local/bin/postern <<'LAUNCH'
#!/bin/sh
# Starts Postern on a free local port, opens its window, and stops it when the window closes.
exec node /opt/devhub/desktop/launch.mjs "$@"
LAUNCH
fi
chmod 755 /usr/local/bin/postern

say "Adding Postern to the applications menu"
for z in 192 512; do install -D -m 644 "$APP_DIR/web/dist/icon-$z.png" "/usr/share/icons/hicolor/${z}x${z}/apps/postern.png"; done
cat > /usr/share/applications/postern.desktop <<DESK
[Desktop Entry]
Type=Application
Name=Postern
GenericName=API and SFTP client
Comment=API, SOAP and SFTP workspace
Exec=/usr/local/bin/postern
Icon=postern
Terminal=false
Categories=Development;Network;
Keywords=api;rest;soap;sftp;http;
StartupWMClass=postern
DESK
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -f /usr/share/icons/hicolor 2>/dev/null || true
command -v update-desktop-database >/dev/null && update-desktop-database -q /usr/share/applications 2>/dev/null || true

if [ $MODE = service ]; then
  say "Done. Postern is running at http://localhost:${P} (also in the applications menu)"
  cat <<MSG
  Data (encrypted at rest):  $DATA_DIR   (back up this folder, including master.key)
  Config:                    $CONF_DIR/devhub.env      Logs: journalctl -u devhub -f
  Public access with HTTPS:  see $CONF_DIR/nginx.conf.example, then set DEVHUB_SECURE_COOKIE=1 and DEVHUB_TRUST_PROXY=1
  After creating your account set DEVHUB_ALLOW_REGISTER=0 and: systemctl restart devhub
MSG
else
  say "Done. Open \"Postern\" from the applications menu (or run: postern)"
  cat <<MSG
  Nothing runs in the background: the app starts when you open it and stops when you close its window.
  It uses port 3210 when free, otherwise the next free port.
  Your data (encrypted at rest):  ~/.local/share/postern   (back up this folder, including master.key)
MSG
fi
