# Security policy

## Reporting a vulnerability

Please report privately; do not open a public issue. Use GitHub's
**Security → Report a vulnerability** (private advisory) on this repository,
with the version, your OS and steps to reproduce. We aim to acknowledge within
7 days and to ship a fix or mitigation for confirmed issues within 90 days.

## Supported versions

Only the latest release receives security fixes. Dependency alerts are handled through Dependabot; build-tool-only advisories (for example in `electron-builder`) do not ship in the app.

## Security model

- Desktop mode (`postern`) listens on **127.0.0.1 only**, on a free port chosen at launch, and exits when the window closes.
- Accounts use scrypt-hashed passwords and HttpOnly, SameSite cookie sessions with a CSRF header on every write.
- Saved SFTP/API secrets are encrypted at rest (AES-256-GCM); `DEVHUB_MASTER_KEY` can supply the key.
- Outgoing requests can be restricted from private networks (`DEVHUB_BLOCK_PRIVATE=1`).
- The UI loads no external resources and Postern sends no telemetry.
- **Mock servers** answer without sign-in at an unguessable URL (`/mock/<random id>`), rate-limited per mock, with an optional access key. Treat a mock URL like a link anyone can open. The anonymised-sample generator runs in the browser and never uploads the sample.
- Request signing (Digest, AWS SigV4, JWT) happens on the local engine; the secrets stay in your encrypted data.
- Release files (including the Windows and macOS builds) are not code-signed; verify downloads with `SHA256SUMS`.

### Desktop app (Electron) hardening
The installer builds (`Postern-<ver>-<os>-<arch>`) run the UI in a locked-down Chromium window:
- No Node.js in the page (`contextIsolation`, `sandbox`, `nodeIntegration` off); the preload script only reports user activity.
- The window can talk **only** to its own local engine: every other request (http, https, ws, ftp) is cancelled, in-window navigation to other sites is blocked, links open in your normal browser, and camera/mic/location/notification/device permissions are denied.
- The engine requires a random per-launch token that only the app window holds. Other local programs and web pages in your browser get `403` for the UI and the API (only `/mock`, `/sample` and `/api/ping` stay open for test clients). A non-loopback `Host` header is rejected (DNS-rebinding).
- The engine runs with a minimal environment (no inherited secrets) and stops when the app closes, or after 4 minutes without the window.
- Dev tools are disabled in packaged builds. Optional **Security → Auto sign-out** after 5–60 idle minutes, on screen lock and on sleep; File → Sign out now (Ctrl/Cmd+L).
- SFTP can authenticate with the SSH agent (no secret stored in Postern) or password + one-time code (keyboard-interactive).
- Checked by `tests/electron-shell.mjs` (20 checks, run in CI on Linux) and `npm audit --omit=dev` (0 known vulnerabilities at release).

Not covered: the OS-level key store (`master.key` sits next to the database with owner-only permissions, so disk encryption is recommended), malware already running as your user (it can read your files), and a compromised Chromium until you install the next release (Electron ships its own Chromium; update promptly).
Out of scope: attacks needing prior local code execution as the same user.
