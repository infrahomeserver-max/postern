# Publishing Postern

1. Create the GitHub repository `infrahomeserver-max/postern` (public).
2. Bump `version` in `package.json` and add a `CHANGELOG.md` entry.
3. Commit, then tag and push: `git tag vX.Y.Z && git push origin main vX.Y.Z`.
4. The **Release** workflow checks the tag matches `package.json`, builds the tarball and a `.deb`
   for amd64 and arm64 (each bundles Node.js 22), writes `SHA256SUMS`, and attaches everything to the release.

Local build (offline test): `NODE_DIST_DIR=<extracted Node folder> bash packaging/build-portable.sh linux x64 dist`; `bash packaging/build-deb.sh`.

Assets per release: desktop app `Postern-<ver>-{linux,macos,windows}-<arch>` (`.deb`, `.AppImage`, `.dmg`, `.zip`, `.exe`); lite `.deb` (amd64, arm64); `postern-<ver>-{linux,macos}-{x64,arm64}.tar.gz` and `-windows-x64.zip`
(each bundles the official, checksum-verified Node.js 22 and an installer); `postern-<ver>.tar.gz` (source/server, for `deploy/install.sh --service`); `SHA256SUMS`.
The macOS and Windows installers have been written but only the Linux ones were tested; smoke-test them on real machines before announcing.
