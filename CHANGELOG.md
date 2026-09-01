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

### Added

- CCU-Jack can be enabled as an additional interface on the connection
  node (XMLRPC on port 2121, or 2122 with TLS; port configurable). CCU
  discovery now probes for CCU-Jack as well. Based on PR #162, closes
  #164.

### Changed

- `homematic-rega` 1.5 -> 2.0 and `homematic-xmlrpc` 1.0 -> 2.0. This
  removes the long-deprecated `request` package and the fragile
  xmlbuilder GitHub-tarball reference from the dependency tree; ReGa
  timestamps are now converted inside the library, and the "uncertain
  value" detection (ReGa reporting 1970-01-01) works on the timestamp
  itself instead of a locale-dependent string compare. Requires Node
  20.19+/22.12+ (`require(esm)`).
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

- On Node-RED 4.x, node configuration dialogs had to be opened several
  times before the interface/device/channel/datapoint selects populated.
  The editor now triggers the initial load itself instead of relying on
  a change event Node-RED 4 no longer fires reliably, retries when the
  config node is not yet available in the runtime, and no longer wedges
  itself when the request fails or the config node is still unsaved.
- Removed 46 debug `console.log` statements that the node configuration
  dialogs wrote to the browser console.
