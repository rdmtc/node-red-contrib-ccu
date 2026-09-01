# Changelog

Notable changes to node-red-contrib-ccu. Format follows
[Keep a Changelog](https://keepachangelog.com/); entries describe the
user-visible symptom and the cause, not the commit list (the release notes
append commits automatically).

## Unreleased (4.0.0)

### Breaking

- Requires Node.js >= 20 and Node-RED >= 4.0 (previously Node 10 /
  Node-RED 1.0). The primary supported target is Node-RED 5 on Node 24.
  Flows and node configurations are unchanged — existing flows import as
  before.

### Changed

- Runtime dependencies reduced from 10 to 4: the deprecated
  `string-similarity` package was replaced by an internal implementation
  with identical results, `hm-discover`, `nextport` and `buffer-base62`
  were vendored (the latter two rewritten without their abandoned
  transitive dependencies), the `promise.prototype.finally` polyfill
  (a no-op since Node 10) was dropped, and `obj-ease` moved to
  devDependencies. Fewer install warnings, smaller install. (#176)
- Tooling modernized: ESLint 9 + Prettier replace xo, c8 replaces
  nyc/coveralls, mocha 11 and node-red-node-test-helper 0.3.6 run the
  test suite against Node-RED 4.x, GitHub Actions CI covers Node
  20/22/24 x Node-RED 4/5, releases publish to npm via OIDC trusted
  publishing with provenance.

### Fixed

- Removed 46 debug `console.log` statements that the node configuration
  dialogs wrote to the browser console.
