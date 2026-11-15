#!/usr/bin/env bash
# Usage: sudo ./uninstall.sh [--purge]   (--purge also deletes the service data + config; your desktop data in ~/.local/share/postern is never touched)
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }
systemctl disable --now devhub 2>/dev/null || true
rm -f /etc/systemd/system/devhub.service; systemctl daemon-reload 2>/dev/null || true
rm -rf /opt/devhub
rm -f /usr/local/bin/postern /usr/share/applications/postern.desktop /usr/share/icons/hicolor/192x192/apps/postern.png /usr/share/icons/hicolor/512x512/apps/postern.png
if [ "${1:-}" = "--purge" ]; then rm -rf /var/lib/devhub /etc/devhub; userdel devhub 2>/dev/null || true; echo "Purged."; else echo "Kept /var/lib/devhub and /etc/devhub (use --purge to delete)."; fi
