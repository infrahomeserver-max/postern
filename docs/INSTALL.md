# Install, clean reinstall and uninstall

Postern needs nothing else installed: the desktop app carries its own runtime.

**Before you start:** check the download against `SHA256SUMS` from the same release page.

```bash
sha256sum -c SHA256SUMS --ignore-missing          # Linux
shasum -a 256 -c SHA256SUMS --ignore-missing      # macOS
```
```powershell
Get-FileHash .\Postern-Setup-<ver>-windows-x64.exe -Algorithm SHA256   # compare with the line in SHA256SUMS
```

## Where your data lives

| OS | Folder |
|---|---|
| Linux | `~/.local/share/postern` |
| macOS | `~/Library/Application Support/Postern` |
| Windows | `%APPDATA%\Postern` |

It holds the database, `master.key`, `shell.json` (window size, auto sign-out) and `postern.log`. Uninstalling the app **keeps this folder** unless you delete it yourself. The desktop app and the lite edition share it.

## Install

### Ubuntu / Debian (.deb)
```bash
sudo apt install ./Postern-<ver>-linux-amd64.deb      # arm64: Postern-<ver>-linux-arm64.deb
postern                                               # or open "Postern" from the app menu
```
apt installs the libraries Electron needs. The package ships its own Chromium and runtime.

### Any Linux (AppImage)
```bash
chmod +x Postern-<ver>-linux-x86_64.AppImage
./Postern-<ver>-linux-x86_64.AppImage
```
If it reports that the sandbox cannot start (typical on Ubuntu 24.04+, which restricts user namespaces), either use the `.deb` or run it with `--no-sandbox` (this weakens Chromium's process sandbox, so prefer the `.deb`). On systems without FUSE: `APPIMAGE_EXTRACT_AND_RUN=1 ./Postern-….AppImage`.

### macOS (.dmg)
Open the `.dmg`, drag **Postern** to Applications. The app is not code-signed, so the first launch is blocked: open **System Settings → Privacy & Security**, scroll to the message about Postern and choose **Open Anyway** (or right-click the app → Open). Use `-arm64` for Apple silicon and `-x64` for Intel Macs.

### Windows 10/11
Run `Postern-Setup-<ver>-windows-x64.exe`. SmartScreen may warn because the file is not signed: choose **More info → Run anyway**. The installer lets you pick the folder and creates Start-menu and desktop entries. The portable `.exe` needs no installation; run it from any folder.

### Lite edition (optional)
Smaller bundles that open in a Chromium-based browser window (Edge, Chrome, Chromium or Brave must be installed): `sudo apt install ./postern-lite_<ver>-1_amd64.deb`, or extract `postern-<ver>-<os>-<arch>.tar.gz` / `.zip` and run `./install.sh` (macOS/Linux) or `install.cmd` (Windows). The lite and desktop `.deb` packages conflict with each other, so install one at a time.

## Update to a newer version
Install the newer file over the old one (`sudo apt install ./Postern-<ver>-linux-amd64.deb`, run the new installer, or replace the app). Your data is kept. After a failed or odd update, use the clean reinstall below.

## Quick install, verify and clean test (Ubuntu / Debian)

One command downloads a release, checks its checksum, removes any older Postern and installs it. Your data is kept unless you add `--purge`.

```bash
curl -fsSL https://github.com/infrahomeserver-max/postern/releases/latest/download/install.sh | bash                    # latest release, keeps your data (also how you upgrade)
curl -fsSL https://github.com/infrahomeserver-max/postern/releases/latest/download/install.sh | bash -s -- --purge     # clean install: also wipes ~/.local/share/postern
curl -fsSL https://github.com/infrahomeserver-max/postern/releases/latest/download/install.sh | bash -s -- v0.0.0      # a specific release
```
`install.sh` is attached to every release, so the same script also sits next to the downloads on the release page.

The `.deb` is about 100 MB, so the progress bar may crawl on a slow link. The script needs a *published* release: wait until the Release workflow is green. Run it from any folder; it cleans up after itself.

## Check that it works
Launch Postern. A window opens with a sign-in/create-account page. Create an account and open **Mocks → Workday-Mock ERP → Add to my workspace** for a one-click smoke test (a ready-made collection and environment appear under **Requests**, and the environment is selected for you).

`postern --version` prints the version on Linux.

## Clean reinstall (fresh start)

Do this to remove a broken or old install, including the old *DevHub* builds.

1. **Back up what you want to keep** (skip if you want a truly empty start): use **Settings → Backup & restore** and copy the whole data folder from the table above, `master.key` included.
2. **Quit Postern** completely (File → Quit, or end the process).
3. **Uninstall the app** (next section).
4. **Remove old DevHub leftovers**, if you ever ran it:
   ```bash
   sudo systemctl disable --now devhub 2>/dev/null
   sudo rm -rf /opt/devhub /etc/systemd/system/devhub.service /usr/local/bin/postern
   sudo rm -rf /var/lib/devhub /etc/devhub          # service-mode data, only if you do not need it
   sudo userdel devhub 2>/dev/null
   ```
5. **Delete the data folder** (this erases every account, collection, mock and saved site, and cannot be undone):
   ```bash
   rm -rf ~/.local/share/postern                           # Linux
   rm -rf ~/Library/Application\ Support/Postern           # macOS
   ```
   ```powershell
   Remove-Item -Recurse -Force "$env:APPDATA\Postern"      # Windows
   ```
6. **Install the new version** from the section above and create your account again.

## Uninstall

| How you installed | Command |
|---|---|
| `.deb` (desktop) | `sudo apt remove postern` (`sudo apt purge postern` also drops package config) |
| `.deb` (lite) | `sudo apt remove postern-lite` |
| AppImage | delete the `.AppImage` file (and its menu entry if your desktop added one: `~/.local/share/applications/*postern*`) |
| macOS `.dmg` | drag **Postern** from Applications to the Trash |
| Windows installer | Settings → Apps → Installed apps → Postern → Uninstall |
| Windows portable | delete the `.exe` |
| Lite portable installer | Linux: `~/.local/opt/postern/uninstall.sh`; macOS: `uninstall.sh` next to the app; Windows: Apps & features |

None of these delete your data. To remove it as well, follow step 5 above, or pass `--purge` to the lite `uninstall.sh` (`-Purge` on Windows).

## Always-on server for a team (optional, Ubuntu)

From the source tarball `postern-<ver>.tar.gz`: `sudo ./deploy/install.sh --service` installs a hardened systemd service. Remove it with `sudo ./deploy/uninstall.sh` (add `--purge` to delete its data and config). Put it behind HTTPS and DNS as described in [INTERNAL-NETWORK.md](INTERNAL-NETWORK.md).

## Troubleshooting

- **`apt` says "Invalid archive member header" or `dpkg` says "lzma error: compressed data is corrupt":** you have a `.deb` from an early v0.0.0 build whose package data was damaged. Download the current release again; the Release workflow now builds the `.deb` itself and verifies a full decompression before publishing.
- **`apt` prints "Download is performed unsandboxed as root … couldn't be accessed by user _apt":** harmless; it only means the file sits in a folder `_apt` cannot read. Install still works.
- **`curl … 404` in the quick-install script:** the release for that tag is not published yet (or failed). Check Actions → Release.

- **Window does not open / closes at once:** read `postern.log` in the data folder.
- **"Engine did not start":** another copy may be running, or the data folder is not writable. Quit all Postern processes and retry.
- **Blank window on Linux with odd graphics drivers:** start with `postern --disable-gpu`.
- **Locked out (forgot password):** passwords cannot be recovered. Restore a backup of the data folder, or follow the clean reinstall to start fresh.
