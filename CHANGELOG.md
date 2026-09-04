# Changelog

Notable changes to node-red-contrib-ccu. Format follows
[Keep a Changelog](https://keepachangelog.com/); entries describe the
user-visible symptom and the cause, not the commit list (the release notes
append commits automatically).

## 4.3.0 (2026-09-04)

### Added

- **Dynamic node configuration through `msg.config`** (roadmap B-2). Put
  an object in `msg.config` and its properties override that node's own
  configuration for that one message; the stored configuration is never
  modified, so the next message starts from the dialog settings again.
  Supported by the value, set-value, switch, sysvar, signal and display
  nodes; each node's help panel lists the keys it accepts, and anything
  else is ignored. `msg.ccu` could not be used for this because it
  already carries the CCU host name. (#172, #71, #103, #80, #56, #148,
  #185)
- signal node: every command field is reachable that way, including
  `soundList` and `dimmerList`, which now also accept a plain array of
  values (`msg.config.soundList = [1, 2]`) instead of the editor's
  list-of-objects shape. (#148, #80)
- sysvar node: a typed input selects where the value to write comes from
  (msg/flow/global/env). Computing a value and storing it in a variable
  no longer needs a change node to move it into `msg.payload` first.
  (#56)
- sysvar and rpc-event nodes show the last value and how long ago it
  arrived under the node — the sysvar node also when "emit value on
  start" is off, since the connection knows the value either way. (#54,
  #52)
- value and rpc-event nodes: new option **discard uncertain values**,
  which drops values the ReGa could not timestamp (`msg.uncertain`).
  Off by default, so existing flows are unaffected. (#96)
- ccu-mqtt: new **get** topic (`hm/get/<channel>/<datapoint>` by
  default) republishes the last known value on its status topic, so a
  refresh can be triggered over MQTT. An empty datapoint republishes the
  whole channel. (#115)
- ccu-mqtt: the **RPC** topics are implemented and visible in the editor.
  The dispatcher recognised the RPC topic before but the node had no
  handler for it, so such messages were silently dropped and the
  response topic was never used — which is why both fields were
  commented out. The result (or the error) is published on the response
  topic. (#22)
- switch node: rule values accept the **bool** type, as core Node-RED's
  switch node does. Without it `true` had to be entered as a string, and
  `true == "true"` is false in JavaScript, so boolean datapoints could
  only be compared by writing 0/1. (#51)
- connection node: **RPC ping** can be switched off, which disables the
  periodic ping and the timeout-triggered re-init for that connection.
  Setting the ping timeout to 0 never did this — it fell back to 60
  seconds. (#44)
- connection node: **names/rooms refresh** interval (default 15 minutes,
  0 = off). Channel names, rooms and functions used to be read once when
  the connection started, so anything added in the CCU WebUI stayed
  invisible until the flow was redeployed. (#167)

### Fixed

- set-value node: only the _first_ message ever configured the node.
  Message properties were written into the node's own configuration, so
  every later message hit the "already configured" guard and was
  ignored, and the node kept acting on the first message's rooms,
  functions or channel. Each message is now evaluated on its own. (#133)
- set-value node: the device-name filter tested whether the _channel_
  had a ReGa name while comparing the _device_ name, so channels without
  a name of their own were dropped even when their device matched.
- Enum names never worked: the CCU sends them in `VALUE_LIST`, but the
  code read `ENUM`, which no interface process sends. `msg.datapointEnum`
  and `msg.valueEnum` were always `undefined`, and writing an enum
  datapoint by name (`AUTO-MODE` rather than `0`) fell back to `0`.
- ccu-mqtt: the "is this parameter writeable" check was
  `!(desc.OPERATIONS) && 2`, which is always false — it never fired, and
  read-only parameters were written anyway.
- ccu-mqtt: `putParamset` cast every value against the description of a
  parameter that does not exist in that call, so the whole paramset went
  out uncast. Its private copy of the cast logic is gone; the shared one
  gained the MIN/MAX clamping that copy did. Unparseable numbers become
  0 instead of NaN, which XML-RPC cannot encode.
- Running on the CCU itself was not detected any more, so local installs
  (RedMatic) silently talked to the interface processes through the
  CCU's lighttpd proxy instead of their direct ports. The check grepped
  `/etc/lighttpd/conf.d/proxy.conf` for a port number; on current
  firmware that file is a one-line include and the port markers live two
  levels down. It now looks for a listener on the direct port instead.
  (Roadmap B-4)
- Writing several system variables at once left all but the first
  invisible until the next scheduled ReGa poll (30 s by default): the
  immediate re-poll each write triggers was dropped while another poll
  was still running. It is remembered and run once afterwards. (#166)
- RSSI values from the ReGa poll were converted from the unsigned byte
  unconditionally, so a value that was already negative, or the 0 that
  means "never received", became -318 or -256. (#183)
- Editor: the Channel and Datapoint fields were cleared whenever their
  content was not a known channel address, which also wiped
  `${PARAMETER}` placeholders every time the dialog was opened — so a
  node inside a subflow lost its subflow parameter. Placeholders are
  left alone now. (#158)
- The German help texts of the rpc-event node never loaded:
  `locales/de/ccu-rpc-event.json` had a trailing comma and was not valid
  JSON.

## 4.2.0 (2026-09-04)

### Added

- New node **ccu-homeassistant**: publishes Home Assistant MQTT
  auto-discovery configurations (device-based, HA >= 2024.11) for a
  checkbox-selected set of devices. It is a companion to the ccu-mqtt
  node and reuses its topic templates and payload format, so the
  discovery configs point at the topics ccu-mqtt already publishes and
  consumes; wire its output to the same mqtt-out node. Entities: switch,
  light (dimmers), cover (blinds/shutters incl. tilt), climate (HM and
  HmIP thermostats), binary_sensor (contact, rotary handle, motion,
  presence, smoke, water), event (keys), lock (KeyMatic), sensor (energy,
  weather, maintenance) plus, optionally, disabled-by-default entities for
  every other datapoint. Unchecking a device removes it from Home
  Assistant on the next deploy. (Roadmap B-16)
- ccu-mqtt: the setValue topic accepts Home Assistant's command words —
  `OPEN`, `CLOSE`, `STOP`, `ON`, `OFF` on LEVEL and `AUTO-MODE`,
  `MANU-MODE`, `BOOST-MODE`, `COMFORT-MODE`, `LOWERING-MODE` on the
  read-only CONTROL_MODE of HM thermostats (translated to the `*_MODE`
  actions).

### Fixed

- ccu-mqtt: channels without a ReGa name produced topics with an empty
  segment (`hm/status//STATE`); the channel address is used instead.
- Closing a ccu-mqtt or ccu-rpc-event node threw inside the connection's
  deregister, so the node was never reported as closed on deploy.

## 4.1.0 (2026-09-04)

### Fixed

- Slat positions on HmIP blind actuators (HmIP-FBL, HmIP-BBL,
  HmIP-DRBLI4, ...) can now be set through the value/set-value nodes:
  the actuators accept but ignore a lone LEVEL_2 write, so writes to
  LEVEL_2 are transparently remapped to the COMBINED_PARAMETER
  datapoint (`L2=<percent>`), which is what the CCU itself sends.
  Verified against the CCU's own commands and in unit tests, not yet on
  a physical actuator — feedback in the issues is welcome. (#136, #154,
  #175)

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
- Device descriptions regenerated from the maintainer's production CCU3
  (firmware 3.87.6, ~70 device type/firmware combinations across
  BidCos-RF, BidCos-Wired, HmIP and heating groups): 547 new entries and
  32 refreshed ones. New, among others: HmIP-FBL 1.8.12, HmIP-BSL 1.0.2,
  HmIP-BSM 1.18.14, HmIP-DRSI4, HmIP-MOD-OC8, HmIP-MP3P, HmIP-SRH 1.2.12,
  HmIP-STHD / WTH-1 / WTH-2 2.8.10, HmIP-WRC6 2.2.14, HmIP-eTRV-2 2.2.8,
  HmIP-eTRV-B-2 R4M, HmIP-eTRV-C / C-2 1.4.14, HMIP-PSM 2.22.8,
  HMIP-SWDO 1.18.10, HMIP-WRC2 1.18.x and the HmIP-HEATING 2.0.0 group.
  Devices of these types no longer need a live paramset fetch before
  their channels show up in the node configuration dialogs, and the
  refreshed entries carry the CONTROL hints the current firmware sends.

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
