#!/usr/bin/env bash
# Removes exactly what install.sh created (listed in its manifest). Your data is kept unless you pass --purge.
set -euo pipefail
PURGE=0; [ "${1:-}" = --purge ] && PURGE=1
OS="$(uname -s)"
if [ "$OS" = Darwin ]; then MAN="$HOME/Library/Application Support/Postern/install-manifest.txt"; DATA="$HOME/Library/Application Support/Postern"
else MAN="$HOME/.local/opt/postern/install-manifest.txt"; DATA="$HOME/.local/share/postern"; fi
[ -f "$MAN" ] || { echo "no install manifest found ($MAN); nothing to remove" >&2; exit 1; }
while IFS= read -r p; do [ -n "$p" ] && { echo "removing $p"; rm -rf -- "$p"; }; done < "$MAN"
rm -f -- "$MAN"
command -v update-desktop-database >/dev/null && update-desktop-database -q "$HOME/.local/share/applications" 2>/dev/null || true
[ $PURGE = 1 ] && { echo "deleting data $DATA"; rm -rf -- "$DATA"; } || echo "kept your data in $DATA (use --purge to delete it)"
