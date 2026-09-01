# Phase 1 — tooling groundwork (no behavior change)

**Completed 2026-09-01**, shipped as `4.0.0-dev.1` … `4.0.0-dev.4` on
master. Everything here is invisible to users; goal was a working modern
dev loop.

1. **done** (dev.4) — New CI workflow (D-9): `.github/workflows/ci.yml`,
   lint job on Node 24 plus test matrix Node 20/22/24 × Node-RED 4/5
   (NR 5 legs on 22/24 via `npm install --no-save node-red@^5`). Travis
   leftovers deleted, README badges replaced (npm, CI, license); the
   dead david-dm/travis/coveralls/XO badges are gone. Also added the
   release pipeline early (D-10/D-11): `release.yml` with npm OIDC
   trusted publishing (`--provenance`, no npm token) and a
   `github-release` job fed by `.github/release-notes.js` from
   CHANGELOG.md.
2. **done** (dev.3) — xo → ESLint 9 flat config + Prettier (D-3):
   `eslint.config.js` (@eslint/js recommended + eslint-config-prettier;
   browser/jquery/RED globals for editor scripts via eslint-plugin-html
   8), `.prettierrc` (4-space, 120 cols, single quotes), whole codebase
   mechanically reformatted. husky removed. The old xo excludes
   (`ccu-switch.*`, `paramsets-join.js`) carried over as eslint ignores —
   still to burn down.
3. **done** (dev.2) — Dropped `promise.prototype.finally` + shim call,
   moved `obj-ease` to devDeps, replaced deprecated `string-similarity`
   with `nodes/lib/similarity.js` (same Dice algorithm, verified
   identical results against the original) (D-6).
4. **done** (dev.2) — Vendored micro-deps (D-7): `nodes/lib/nextport.js`
   (verbatim), `nodes/lib/discover.js` (rewritten without the abandoned
   `binary`/`async` deps, plus a udp error handler so discovery can
   never crash the process), `nodes/lib/base62.js` (BigInt rewrite,
   verified byte-identical output). `mqtt-wildcard` kept as a dep
   (OQ-3). Runtime dependencies: 10 → 4.
5. **done** (dev.1) — nyc/coveralls/camo-purge → c8; mocha 8 → 11;
   node-red-node-test-helper 0.2.5 → 0.3.6; node-red devDep 1.x → 4.x;
   npm `overrides` forces `homematic-xmlrpc ^2.0.0` into `hm-simulator`.
   Also fixed real test flakiness found doing this: `removeFiles()`
   aborted on the first missing file (single try around four unlinks)
   and never ran _before_ a suite, so stale value caches leaked between
   runs. All 23 specs pass on Node 20 / Node-RED 4.1.
6. **done** (dev.3) — Removed 46 `console.log` debug leftovers from the
   editor html files.
7. **done** (dev.4) — `CHANGELOG.md` bootstrap (Keep a Changelog format,
   D-11) with the 4.0.0 Unreleased section.

Not part of Phase 1 as planned but landed alongside: `engines.node >=20`
and `node-red.version >=4.0.0` declared in package.json (D-1/D-13,
pulled forward from Phase 2 because the devDependencies already require
Node 20).
