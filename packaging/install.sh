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
# ---- pretty output: colours and a live progress bar only on a real terminal ----
if [ -t 2 ]; then B=$'\033[1m'; G=$'\033[32m'; C=$'\033[36m'; Y=$'\033[33m'; R=$'\033[31m'; Z=$'\033[0m'; TTY=1; else B=; G=; C=; Y=; R=; Z=; TTY=0; fi
step() { printf '%s==>%s %s%s%s\n' "$C" "$Z" "$B" "$*" "$Z" >&2; }
ok()   { printf '    %s✓%s %s\n' "$G" "$Z" "$*" >&2; }
human() { awk -v b="$1" 'BEGIN{ s=b+0; split("B KB MB GB",u," "); i=1; while (s>=1024 && i<4) { s/=1024; i++ } printf (i==1 ? "%d %s" : "%.1f %s"), s, u[i] }'; }
clock() { awk -v t="$1" 'BEGIN{ t=int(t); if (t<0) t=0; printf "%d:%02d", t/60, t%60 }'; }
# download <url> <file>:  [#########-----] 48%  24.6 MB / 51.2 MB  4.1 MB/s  ETA 0:06
download() {
  local url="$1" out="$2" total=0 pid start now size pct fill bar spd eta width=28 spin='|/-\' n=0 lim=()
  [ -n "${POSTERN_LIMIT_RATE:-}" ] && lim=(--limit-rate "$POSTERN_LIMIT_RATE")
  total="$(curl -fsSLI "$url" 2>/dev/null | tr -d '\r' | awk 'tolower($1)=="content-length:"{v=$2} END{print v+0}')"
  if [ "$TTY" != 1 ]; then curl -fL --retry 3 -sS "${lim[@]}" -o "$out" "$url"; ok "downloaded $(human "$(stat -c %s "$out")")"; return; fi
  start=$(date +%s.%N)
  curl -fL --retry 3 -sS "${lim[@]}" -o "$out" "$url" & pid=$!
  trap 'kill $pid 2>/dev/null; printf "\n" >&2; exit 130' INT TERM
  while kill -0 "$pid" 2>/dev/null; do
    size=$(stat -c %s "$out" 2>/dev/null || echo 0); now=$(date +%s.%N); n=$((n+1))
    spd=$(awk -v s="$size" -v a="$start" -v b="$now" 'BEGIN{ d=b-a; printf "%d", (d>0.2 ? s/d : 0) }')
    if [ "$total" -gt 0 ]; then
      pct=$(( size * 100 / total )); [ "$pct" -gt 100 ] && pct=100; fill=$(( pct * width / 100 ))
      bar="$(printf '%*s' "$fill" '' | tr ' ' '#')$(printf '%*s' $((width-fill)) '' | tr ' ' '-')"
      eta="--:--"; [ "$spd" -gt 0 ] && eta="$(clock "$(awk -v t="$total" -v s="$size" -v v="$spd" 'BEGIN{ printf "%d", (t-s)/v }')")"
      printf '\r    %s[%s]%s %3d%%  %s / %s  %s/s  ETA %s   ' "$G" "$bar" "$Z" "$pct" "$(human "$size")" "$(human "$total")" "$(human "$spd")" "$eta" >&2
    else
      printf '\r    %s %s downloaded  %s/s   ' "${spin:$((n%4)):1}" "$(human "$size")" "$(human "$spd")" >&2
    fi
    sleep 0.15
  done
  wait "$pid" || { printf '\n' >&2; echo "${R}Download failed.${Z} Check your connection and try again." >&2; exit 1; }
  trap - INT TERM
  size=$(stat -c %s "$out"); now=$(date +%s.%N)
  printf '\r    %s[%s]%s 100%%  %s in %ss  (%s/s)          \n' "$G" "$(printf '%*s' "$width" '' | tr ' ' '#')" "$Z" "$(human "$size")" "$(awk -v a="$start" -v b="$now" 'BEGIN{printf "%.1f", b-a}')" "$(human "$(awk -v s="$size" -v a="$start" -v b="$now" 'BEGIN{ d=b-a; printf "%d", (d>0 ? s/d : s) }')")" >&2
}

step "Downloading Postern $TAG ($ARCH)"
curl -fsSLO "https://github.com/$REPO/releases/download/$TAG/SHA256SUMS"
download "https://github.com/$REPO/releases/download/$TAG/$DEB" "$DEB"
step "Verifying checksum"
sha256sum -c SHA256SUMS --ignore-missing 2>&1 | grep -F "$DEB" | grep -q ': OK' || { echo "${R}Checksum check FAILED for $DEB - not installing.${Z}"; exit 1; }
ok "checksum matches"
dpkg-deb --fsys-tarfile "$DEB" | tar -t >/dev/null || { echo "${R}$DEB is corrupt - not installing.${Z}"; exit 1; }
ok "package is intact"
step "Removing any older Postern (your data is kept unless --purge)"
pkill -x postern 2>/dev/null || true
$SUDO apt-get remove -y postern postern-lite >/dev/null 2>&1 || true
if [ "$PURGE" = 1 ]; then echo "    ${Y}--purge:${Z} deleting your Postern data" >&2; rm -rf "$HOME/.local/share/postern" "$HOME/.config/Postern" "$HOME/.config/postern"; fi
step "Installing"
$SUDO apt-get install -y "./$DEB"
ok "Installed $(dpkg-query -W -f='${Package} ${Version}' postern)"
echo "Start it from the app menu, or run:  postern"
