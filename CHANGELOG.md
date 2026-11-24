# Changelog

## 0.0.0 - first public pre-release
Early public release: expect rough edges and breaking changes before 0.1.
- REST + SOAP/WSDL API tester (collections, environments, OAuth1/2, mock servers, security and performance checks).
- SFTP client with site manager, transfers and open-with.
- Settings → Network: global defaults for timeout, redirects, SSL, max response size, User-Agent, proxy (none/system/custom, with bypass list and credentials), extra CA and client certificate (mTLS), plus SFTP connect timeout, keep-alive, retries and transfer tuning. Requests can still override.
- Workday-style dummy ERP (Mocks → "Sample: Workday-style ERP"): generated finance data for periods, journals/transactions, trial balances, FX rates and fixed assets over REST, report (RaaS-style) and SOAP endpoints with a WSDL, OAuth token endpoint, optional pagination, filters, failure/latency simulation and a one-click collection/environment import.
- **Desktop app (Electron)** with a hardened window (sandboxed page, no Node, outside network blocked, per-launch token between window and engine, loopback Host check), optional idle auto sign-out, installers for Linux (deb, AppImage), macOS (dmg) and Windows (installer, portable). The earlier browser-window bundles remain as "lite".
- SFTP sign-in with the SSH agent, or password + one-time code (keyboard-interactive / 2FA), besides password and private key.
- API Tester: JWT (HMAC), Digest and AWS Signature v4 auth; OAuth 2 password and refresh-token grants; a short description for each auth type.
- One-line Linux installer attached to every release: `curl -fsSL https://github.com/infrahomeserver-max/postern/releases/latest/download/install.sh | bash` (verifies the checksum; `--purge` for a clean install).
- Side panels (Requests, Mocks, SFTP): drag the divider to resize, double-click it or use the hide button / Ctrl+B to collapse; the panel follows the active tab (environment tab → Environments, request tab → its place in Collections).
- Ask before sending when an environment is active: Cancel / Send now bar that sends by itself after N seconds (Settings → Requests & history; 0 = wait). Each collection remembers its environment; the picker only appears once an environment exists.
- Hover a `{{variable}}` in the request editor to see, edit or define its value.
- Mock from sample: **Start from a known system** (Workday SOAP + REST, SAP S/4HANA OData, NetSuite, Oracle Fusion Financials, Oracle E-Business Suite ISG REST, Salesforce, Dynamics 365, ServiceNow, Stripe-style list, OAuth token, RFC 7807 error), modelled on the vendors' documented response shapes with fictional values; more realistic generated values (32-hex WIDs, real ISO currency/country codes, plausible prefixed ids, person vs business labels); Copy / Select buttons for the sample and the mock.
- Mock from sample: window can be expanded, search in the preview, side-by-side compare with your sample, XML `type`/`version` attributes and values listed under "Keep" are preserved.
- Interface: arrow cursor on buttons/tabs/rows and clearer hover; key-value rows no longer leave a stray ticked row and every row can be removed; coloured method picker; red status chips for 4xx/5xx; Clear button on responses; draggable tabs; collapse-all in the sidebar; tabbed Settings; themed dropdowns; refreshed light theme; the sample ERP environment is selected automatically.
- Sign-in with local username and password; secrets encrypted at rest (AES-256-GCM).
- Desktop app mode (own window, free local port, stops on close); `.deb` with bundled Node.js (amd64/arm64) and tarball installer.
- Portable bundles with their own Node.js and per-user installers for Linux (x64/arm64), macOS (arm64/x64) and Windows (x64). macOS and Windows are untested pre-release builds and are not code-signed.
- The `.deb` removes an older `/opt/devhub` install automatically; data is kept.
- Release workflow publishes bundles, `.deb` files, source tarball and `SHA256SUMS`.
- Request tab bar: the environment picker and Manage are pinned at the right and tabs scroll; the last tab can now be closed (empty state with New request).
- Settings: left navigation styled like the main rail; new sections Interface (zoom, density, reduced motion), Requests & history (unsaved warning, wrap lines, keep/clear history), Shortcuts and About.
- **Mock from a sample (anonymised)**: paste or choose a real JSON/XML response and get the same structure with fake values. Runs in the browser, nothing is stored or sent; a leak check proves none of the original values remain; field names you list are kept as-is.
- Dev dependency `minimatch` pinned to a patched release (Dependabot alert, build tooling only).
