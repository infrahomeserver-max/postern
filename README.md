# Postern

A self-hosted desktop workspace that combines a Postman-style **API tester** (REST and SOAP/WSDL) with a FileZilla-style **SFTP client**. It runs on your own machine, keeps your data local and encrypted, and sends no telemetry.

> **Status: pre-release (0.0.0).** Expect rough edges and breaking changes before 0.1. Formerly called DevHub, so some internal names (`DEVHUB_*` variables, the optional service name) keep the old prefix.

## Highlights

- **API tester:** all HTTP methods (each with its own colour), draggable tabs, collections, environments and `{{variables}}`, auth: Basic, Bearer, API key, JWT (HMAC), Digest, AWS Signature v4, OAuth 1.0 and OAuth 2 (client credentials, password, refresh token), pre-request scripts and `pm.test` tests in a sandbox, collection runner, history, code generation, and import/export of Postman, OpenAPI/Swagger and cURL.
- **SOAP / WSDL:** import a WSDL from a URL, file or paste and get a ready-to-send request for every operation.
- **Mock servers:** public per-mock URLs with templated responses, built from a collection, a WSDL, or **an anonymised real sample** (paste a JSON/XML response and get the same structure with fake values, checked for leaks, entirely in the app), plus a built-in **Workday-style dummy ERP** (periods, journals, trial balances, FX, fixed assets over REST, reports and SOAP, with optional pagination and simulated errors).
- **SFTP:** site manager, dual-pane local ⇄ remote transfers, queue, resume, remote edit, FileZilla site import, host-key pinning. Sign in with a password, private key, **SSH agent**, or **password + one-time code (2FA)**.
- **Settings:** theme and colours, interface zoom and density, request and history options, network (timeouts, redirects, SSL, proxy, extra CA and client certificates), file-type actions, backup and restore.
- **Private by design:** per-user accounts with isolated data, everything encrypted at rest (AES-256-GCM), no cloud, no telemetry.

## Install

Download from the [Releases](https://github.com/infrahomeserver-max/postern/releases) page and check the file against `SHA256SUMS`. Full steps, including a clean reinstall and uninstalling, are in **[docs/INSTALL.md](docs/INSTALL.md)**.

| Platform | Download |
|---|---|
| Ubuntu / Debian | `Postern-<ver>-linux-amd64.deb` or `-arm64.deb` |
| Any Linux | `Postern-<ver>-linux-x86_64.AppImage` or `-arm64.AppImage` |
| macOS | `Postern-<ver>-macos-arm64.dmg` (Apple silicon) or `-x64.dmg` (Intel) |
| Windows 10/11 | `Postern-Setup-<ver>-windows-x64.exe` (installer) or the portable `.exe` |

Quickest way on Ubuntu / Debian (downloads, verifies, removes any older copy and installs):

```bash
curl -fsSLO https://raw.githubusercontent.com/infrahomeserver-max/postern/main/packaging/test-release.sh
bash test-release.sh v0.0.0          # add --fresh for a first-run test that also wipes your data
postern
```

The macOS and Windows builds are **not code-signed**, so the first launch shows a warning (see INSTALL.md), and only the Linux builds have been tested by the maintainers. A smaller "lite" edition that opens in a browser-style window is also published (`postern-lite_…deb`, `postern-<ver>-<os>-<arch>` bundles).

## Using it

Start Postern, create a local account (username + password; no email or phone number), and open **Requests** (API tester), **Transfer** (SFTP), **Mocks** or **Settings** from the left bar. **Mocks → Sample: Workday-style ERP → Add to my workspace** is a one-click way to try everything. The complete guide is **[docs/MANUAL.md](docs/MANUAL.md)**.

## Your data

Stored on your computer only: Linux `~/.local/share/postern`, macOS `~/Library/Application Support/Postern`, Windows `%APPDATA%\Postern`. **Back up the whole folder, especially `master.key`**: without it, saved passwords and collections cannot be decrypted, and nobody can recover them for you. Use **Export** in each module for portable backups.

## Security

The desktop app runs its page in a sandboxed window with no Node access, blocks every connection except to its own local engine, protects that engine with a random per-launch token, and offers auto sign-out. Details, limits and how to report a problem: **[SECURITY.md](SECURITY.md)**.

## Run from source

Needs Node.js 22 or newer.

```bash
npm ci
npm run build            # web UI
npm run desktop          # Electron desktop app (needs the dev dependencies)
npm start                # or: the server only, at http://127.0.0.1:3000
npm test                 # unit and integration tests (signing vectors, anonymiser, workday data, auth)
```

Server mode variables (`PORT`, `HOST`, `DEVHUB_DATA`, `DEVHUB_ALLOW_REGISTER=0`, `DEVHUB_BLOCK_PRIVATE=1`, `DEVHUB_MASTER_KEY`, …) and running Postern for a team on an internal network are described in [docs/INTERNAL-NETWORK.md](docs/INTERNAL-NETWORK.md).

Building installers: `npm run dist` (Electron, current OS) or push a `vX.Y.Z` tag to let the Release workflow build every platform; see [packaging/PUBLISHING.md](packaging/PUBLISHING.md).

## Not included yet

SSH terminal, database client, WebSocket/gRPC clients, team sharing / cloud sync, sign-in two-factor for Postern itself, and some auth schemes (Hawk, NTLM, Akamai, browser-based OAuth authorization code).

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md). Licensed under the terms in [LICENSE](LICENSE).
