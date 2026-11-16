# Publishing Postern

Repository: `infrahomeserver-max/postern` (public). Releases are built by `.github/workflows/release.yml` when a `vX.Y.Z` tag is pushed.

## Release steps
1. Bump `version` in `package.json` (and `package-lock.json`), add a `CHANGELOG.md` entry, run `npm test`.
2. Commit and push `main`; wait for the **CI** workflow to go green.
3. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. The **Release** workflow checks the tag matches `package.json`, builds the source tarball, the lite `.deb` files, the lite portable bundles and the desktop installers for Linux, macOS and Windows, then **publish** writes `SHA256SUMS` and attaches everything to the GitHub release. It takes about 6 minutes.
5. Open Actions → Release and confirm every job is green. If one job fails on an artifact upload timeout, use **Re-run failed jobs** (not a full re-run).
6. Smoke-test: `bash packaging/test-release.sh vX.Y.Z --fresh`.

## Re-doing a release (same tag)
Delete the release on the Releases page, then:
```
git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z
git tag vX.Y.Z && git push origin vX.Y.Z
```

## Notes
- Linux desktop `.deb` files are built by `packaging/build-desktop-deb.sh` from electron-builder's unpacked app folder, replacing electron-builder's own `.deb`, which came out with stray bytes or a damaged xz stream on CI runners. The script verifies the result (archive layout and a full decompression of the file tree) and fails the build if it is bad.
- `npmRebuild` is off: the engine is pure JavaScript, and rebuilding native modules breaks cross-architecture builds.
- Local build for the current OS: `npm run build && npm run dist`. Lite bundles: `NODE_DIST_DIR=<extracted Node folder> bash packaging/build-portable.sh linux x64 dist`; `bash packaging/build-deb.sh`.

Assets per release: desktop app `Postern-<ver>-{linux,macos,windows}-<arch>` (`.deb`, `.AppImage`, `.dmg`, `.zip`, `.exe`); lite `.deb` (amd64, arm64); `postern-<ver>-{linux,macos}-{x64,arm64}.tar.gz` and `-windows-x64.zip` (each bundles Node.js 22 and an installer); `postern-<ver>.tar.gz` (source/server, for `deploy/install.sh --service`); `SHA256SUMS`.
The macOS and Windows installers are unsigned and only the Linux ones have been tested; smoke-test them on real machines before announcing.
