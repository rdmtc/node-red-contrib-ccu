# Changelog

Notable changes to node-red-contrib-ccu. Format follows
[Keep a Changelog](https://keepachangelog.com/); entries describe the
user-visible symptom and the cause, not the commit list (the release notes
append commits automatically).

## Unreleased (4.1.0)

### Fixed

- Slat positions on HmIP blind actuators (HmIP-FBL, HmIP-BBL,
  HmIP-DRBLI4, ...) can now be set through the value/set-value nodes:
  the actuators accept but ignore a lone LEVEL_2 write, so writes to
  LEVEL_2 are transparently remapped to the COMBINED_PARAMETER
  datapoint (`L2=<percent>`), which is what the CCU itself sends.
  (#136, #154, #175)

### Changed

- binrpc 3.3.2 -> 4.2.0: zero runtime dependencies (the unmaintained
  `binary`/`put` packages are gone from the whole tree), fragmented TCP
  frames are reassembled correctly (previously a header split across
  chunks caused "malformed response" errors or a hanging request), and
  truncated payloads no longer throw from inside socket handlers.
- New maintainer tooling for the shipped device descriptions:
  `tools/paramsets-fetch.js` fetches paramset descriptions from a live
  CCU, `tools/paramsets-join.js` merges dumps (including
  user-contributed `paramsets.json` files from issue reports). See
  docs/paramsets.md.
- Device descriptions refreshed from two lab CCUs on firmware 3.89.8:
  58 new entries (HmIPW-DRAP 3.0.36, HmIP-PDT 1.4.8, HmIP-WRC2 1.0.3,
  HmIP-RFUSB, RPI-RF-MOD, the CCU's own HM-RCV-50 / HmIP-RCV-50
  channels) and 9 refreshed ones (HmIPW-DRI16 1.2.2 and HmIPW-DRS8 1.2.4
  now include COMBINED_PARAMETER and the PRESS_* datapoints the current
  firmware reports). `paramsets.json` is now key-sorted, which makes this
  one diff large but future ones minimal.

## 4.0.0 (2026-09-02)

### Breaking

- Requires Node.js >= 20 and Node-RED >= 4.0 (previously Node 10 /
  Node-RED 1.0). The primary supported target is Node-RED 5 on Node 24.
  Flows and node configurations are unchanged — existing flows import as
  before.

### Added

- Importable example flows (`examples/`, shown in the editor's import
  dialog): switching a datapoint, receiving RPC events, reading and
  setting a system variable.
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

- Node-RED no longer crashes when the CCU connection drops at an
  unfortunate moment: binrpc 3.3.2 adds the missing socket error
  listener (a response arriving after a timeout killed the whole
  process) and stops the methodCall callback from firing twice on
  failed connections. (#160)
- The value node no longer writes to the CCU when the incoming message
  has no `payload` (previously `undefined` was passed to setValue).
  From PR #173.
- On Node-RED 4.x, node configuration dialogs had to be opened several
  times before the interface/device/channel/datapoint selects populated.
  The editor now triggers the initial load itself instead of relying on
  a change event Node-RED 4 no longer fires reliably, retries when the
  config node is not yet available in the runtime, and no longer wedges
  itself when the request fails or the config node is still unsaved.
- Removed 46 debug `console.log` statements that the node configuration
  dialogs wrote to the browser console.
