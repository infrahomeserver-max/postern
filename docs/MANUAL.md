# Postern user manual

Version 0.0.0. This guide covers the desktop app; the lite edition is identical apart from the window.

## Contents
1. [First start and accounts](#1-first-start-and-accounts)
2. [The workspace](#2-the-workspace)
3. [API Tester](#3-api-tester)
4. [SOAP / WSDL](#4-soap--wsdl)
5. [Mock Servers and the sample ERP](#5-mock-servers-and-the-sample-workday-style-erp)
6. [SFTP Client](#6-sftp-client)
7. [Settings](#7-settings)
8. [Security, privacy and backups](#8-security-privacy-and-backups)
9. [Keyboard shortcuts and menus](#9-keyboard-shortcuts-and-menus)
10. [Troubleshooting](#10-troubleshooting)

## 1. First start and accounts
On first launch choose **Create account** and enter a username and password (at least 8 characters; a long passphrase is best). There is no email or phone number: accounts live only on this computer.

- Several people can have separate accounts on the same install; each account's data is isolated and encrypted with its own key.
- **Passwords cannot be recovered.** Keep a backup of the data folder (section 8).
- Change your password in **Settings → Account**. Sign out from the menu (File → Sign out now, Ctrl/Cmd+L).

## 2. The workspace
The bar on the left switches between **Requests** (API tester), **Transfer** (SFTP), **Mocks** and **Settings**. Each opens as its own area with its own tabs; the bottom bar shows the version and connection state.

## 3. API Tester
**Sending a request.** Click **+ → REST request**, choose the method, enter the URL, press **Send** (Ctrl/Cmd+Enter). The response shows status, time, size, headers, body (pretty-printed, raw, or preview) and test results.

**Request tabs**
- *Params / Headers:* key-value tables with an on/off checkbox per row.
- *Auth:* each type shows a short description in the tab.
  - **Basic**, **Bearer token**, **API key** (header or query).
  - **JWT bearer (HMAC):** builds an HS256/384/512 token from your secret and JSON payload on every send, optionally adding `iat` and `exp`.
  - **Digest:** Postern sends the request, reads the server's 401 challenge and retries with the hashed answer.
  - **AWS Signature v4:** signs with access key, secret key, optional session token, region and service.
  - **OAuth 1.0** (HMAC-SHA1, SHA256 or PLAINTEXT, signed on the engine).
  - **OAuth 2.0:** client-credentials, password and refresh-token grants, with credentials in the body or as a Basic header. Browser-based grants (authorization code, implicit) are not supported yet.
  Not available yet: Hawk, NTLM, Akamai EdgeGrid and other less common schemes.
- *Body:* raw (JSON, XML, HTML, text), form URL-encoded, form-data with files, GraphQL, or a binary file.
- *Scripts / Tests:* a pre-request script and Postman-style tests (`pm.test`, `pm.expect`, `pm.response`, `pm.environment`). Scripts run in an isolated sandbox with no network or storage access.
- *Settings:* per-request timeout, redirects, SSL verification, proxy. "Default" follows **Settings → Network**.

**Tabs** can be dragged to reorder them, closed with the ✕ or a middle-click, and scroll when there are many. Closing the last tab shows an empty screen with a **New request** button. The **environment menu and Manage** sit at the right end of the tab bar: pick the active environment there, or click **Manage** to edit its variables in a tab. In the left panel, the up/down arrows next to the search box collapse every folder at once. Key-value tables (params, headers, form) have a placeholder row at the end; untick a row to disable it or use ✕ to remove it. Response status colours: 2xx green, 3xx blue, 4xx red, 5xx solid red; the response bar has **Save as example** and **Clear**.

**Collections** group requests in folders. Right-click a collection to rename, run, or export it. **Run collection** executes the requests in order for a chosen number of iterations with an optional delay and shows a pass/fail report.

**Environments and variables.** Create environments (e.g. Dev, Prod) under the Environments tab and use `{{name}}` in URLs, headers and bodies. Mark values as secret to mask them. Dynamic values: `{{$guid}}`, `{{$timestamp}}`, `{{$randomName}}`. Scripts can set variables with `pm.environment.set`.

**History** lists recently sent requests; click one to reopen it.

**Code generation** (the `</>` button) produces cURL, JavaScript fetch or Python for the current request.

**Import / Export.** Import Postman v2.x collections and environments, OpenAPI 3 / Swagger files, and cURL commands (paste or drop a file). Export a collection as Postman v2.1.

## 4. SOAP / WSDL
**+ → Import WSDL**, then give a URL, choose a file or paste XML. Postern follows `wsdl:import` and `xsd:import`, and creates a collection with one ready-to-send request per operation with a sample envelope. Fill in the values, set SOAP version/action if needed, and Send. Authentication options (Basic, Bearer, WS-Security UsernameToken) are in the Auth tab. SOAP faults are shown clearly.

## 5. Mock Servers and the sample Workday-style ERP
**Mock Servers → New mock** creates a public URL `http://127.0.0.1:<port>/mock/<random-id>`. Add routes (method + path with `:params` and `*`), set status, headers, delay and a body template (`{{params.id}}`, `{{query.q}}`, `{{body.x}}`, `{{$guid}}`). Mocks answer without sign-in, so they can be called from other tools on the same machine.

**Sample: Workday-style ERP** is a fake finance system with deterministic synthetic data (4 companies, accounts, periods FY2024–26, journals, trial balances, FX rates, fixed assets). It is served over REST, report-as-a-service (JSON/CSV/XML) and SOAP with a WSDL.
1. Open Mock Servers → **Sample: Workday-style ERP**.
2. Click **Add to my workspace**. A collection (REST + SOAP) and an environment (base URL, client id/secret) appear in API Tester.
3. Send the OAuth token request if you want a Bearer token (Basic auth also works), then any extractor. Use `limit` / `offset` / `page` for **optional pagination**, `rows` to change volume, and `simulate=401|403|404|429|500|503|timeout` and `latency` to rehearse error handling.

Never put real data into the sample; it is for testing extractors and integrations.

**From a sample (anonymised).** To mock a system whose data is confidential, use **Mocks → From a sample (anonymised)…**: paste or choose a real JSON or XML/SOAP response, optionally list field names to keep as-is (harmless codes such as `status`), and choose how many list items to keep (default 3). You get the same structure with fake values: names, e-mails, ids, amounts, dates, phone numbers and URLs are replaced, formats are kept, and the same real value always maps to the same fake one so references between records still line up. Everything runs inside the app: the sample is not stored or sent anywhere. A leak check searches the result for every original value and blocks creation if any survived. Field and tag names are kept as structure; rename them if a name itself is confidential. You can add the result as a route to the open mock or create a new mock.

**How mocks run.** A mock is a set of routes stored in your database and answered by the same running app; nothing extra runs and an idle mock uses no resources. Mocks work only while Postern is open (desktop: they stop when the app closes). Their URLs need no sign-in and are protected only by the random id in the URL (optionally add a key with *Require key*), so do not share a mock URL you would not share publicly.

## 6. SFTP Client
**Connect.** Use *Quick connect* (host, port, user, secret) or save a **Site** in the Site Manager (double-click a site to connect). Authentication types:
- **Password**
- **Private key** (paste the key; add a passphrase if it has one)
- **SSH agent:** uses keys loaded in your running agent (`ssh-agent`, Pageant, or the Windows OpenSSH agent). Postern stores no secret. Start the agent and `ssh-add` your key first.
- **Password + verification code (keyboard-interactive):** for servers that ask for a one-time code. Postern asks for the code on each connection unless you untick *Ask for a one-time code*.

**Host keys.** The server's key is pinned on the first connection (a *Host key pinned* badge appears on the site). If it later changes, the connection is blocked with a warning; accept the new key only if you know the server was rebuilt.

**Transfers.** The left pane is your computer and the right pane the server (the Local pane needs the local-folder option when running as a server; the desktop app has it). Drag files between panes, or double-click a file to upload/download it. Right-click for *Open with* (transfer, edit remotely, preview), rename, chmod, delete and new folder. The queue shows progress and speed; interrupted downloads resume. Folders transfer recursively.

**Import:** the upload icon in the Site Manager imports a FileZilla `sitemanager.xml` (SFTP entries only) or a Postern JSON file.

**Tuning** (timeouts, retries, parallel transfers, chunk size) is in **Settings → Network**.

## 7. Settings
A menu on the left switches sections (styled like the main bar):
- **Appearance:** light/dark, theme colour, selection tint, text contrast, button style.
- **Interface:** zoom (80–150 %), comfortable or compact density, reduced animations.
- **Requests & history:** warn before closing a tab with unsaved changes, wrap long lines in responses, keep or clear request history. (Timeouts and proxy are under Network.)
- **Network:** timeout, follow redirects, verify SSL, maximum response size, User-Agent; proxy mode (none / system / custom with credentials and a bypass list); extra CA certificate (PEM) and client certificate/key for mutual TLS; SFTP connect timeout, keep-alive, retries and transfer tuning. Individual requests can override.
- **File types:** the default action for each file type in SFTP (transfer, edit, preview, ask).
- **Backup & restore:** download one JSON file with all collections, environments and SFTP site definitions, and restore it later. Saved SFTP passwords and keys are **not** included, so re-enter them after restoring.
- **Account:** shows who is signed in and changes your password (current + new, at least 8 characters).
- **Security & privacy:** a summary of how your data is protected.
- **Shortcuts** and **About** (version, where your data is stored).

Interface and request preferences are stored per browser/profile, not in your account. In the desktop app the menu **Security → Auto sign-out** signs you out after 5, 15, 30 or 60 idle minutes, and always when the screen locks or the computer sleeps (when enabled). **Security → Open data folder** reveals your data.

## 8. Security, privacy and backups
- Everything is stored locally and encrypted at rest. Nothing is sent anywhere by Postern itself; it only contacts the servers you ask it to.
- The app window can talk only to its own local engine, which accepts only the window. See [SECURITY.md](../SECURITY.md).
- **Backups:** quit Postern, copy the entire data folder (see [INSTALL.md](INSTALL.md)), keeping `master.key` with the database. To restore, quit Postern and copy the folder back. Use **Settings → Backup & restore** for a portable JSON copy of collections, environments and site definitions (without secrets).
- Enable full-disk encryption on laptops; the key file is protected by file permissions only.
- Treat imported collections and scripts from others as untrusted.

## 9. Keyboard shortcuts and menus
| Action | Shortcut |
|---|---|
| Send request | Ctrl/Cmd+Enter |
| Save request to a collection | Ctrl/Cmd+S |
| New request tab | Ctrl/Cmd+T |
| Close a tab | middle-click, or ✕ |
| Sign out now | Ctrl/Cmd+L |
| Reload | Ctrl/Cmd+R |
| Zoom in / out / reset | Ctrl/Cmd + `+` / `-` / `0` |
| Full screen | F11 (Ctrl+Cmd+F on macOS) |

Menus: **File** (sign out, quit), **Edit**, **View**, **Security** (auto sign-out, data folder), **Window**, **Help** (version, project page).

## 10. Troubleshooting
- **Request fails with a certificate error:** add the CA in Settings → Network, or turn off *Verify SSL* for that request only.
- **Calls to an internal host fail:** set the proxy mode or bypass list; see [INTERNAL-NETWORK.md](INTERNAL-NETWORK.md).
- **SFTP "No SSH agent found":** start `ssh-agent`, run `ssh-add`, then restart Postern from the same terminal session so it sees `SSH_AUTH_SOCK`.
- **SFTP "authentication failed" with a code:** codes expire quickly; enter a fresh one.
- **App will not start:** see the troubleshooting list in [INSTALL.md](INSTALL.md) and read `postern.log`.
