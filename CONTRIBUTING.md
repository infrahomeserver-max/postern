# Contributing to Postern

Changes that keep Postern fast, private and dependency-light are the easiest to accept.

## Licence of contributions

Postern is released under the [MIT licence](LICENSE). By submitting a contribution you
agree it is licensed under MIT and certify the
[Developer Certificate of Origin 1.1](https://developercertificate.org/). Sign off every commit:

```
git commit -s -m "Fix tab close on empty request"
```

Do not submit code copied from projects with incompatible licences (GPL, AGPL, proprietary).

## Getting started

```
npm ci
npm run build        # builds the UI into web/dist
npm run dev:server   # API on :3000 (set PORT to change)
```

Before opening a pull request: the UI builds, the server boots, and you updated CHANGELOG.md
for user-visible changes. Releases are cut by pushing a `vX.Y.Z` tag (see `packaging/PUBLISHING.md`).
