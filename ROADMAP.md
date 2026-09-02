# Roadmap — node-red-contrib-ccu modernization

Goal: make node-red-contrib-ccu a first-class citizen on current Node-RED
(primary target: Node-RED 5 on Node 24, with Node-RED 4.x kept working),
on maintained tooling,
with a release pipeline that lets it ship regularly again. The package has
not been published since v3.4.2 (Jan 2022); flows.nodered.org shows
[no scorecard at all](https://flows.nodered.org/node/node-red-contrib-ccu/scorecard)
and Node-RED 4.1+ visibly flags stale packages in the palette manager.
Meanwhile the community keeps the ecosystem alive by hand
([RedMatic 7.4.1 patch thread](https://homematic-forum.de/forum/viewtopic.php?t=86666),
active through Aug 2026) and competitors absorb users who leave
([CCU-Jack](https://github.com/mdzio/ccu-jack) + MQTT,
[node-red-contrib-openccu-loom](https://github.com/SukramJ/node-red-contrib-openccu-loom)).
Demand for a maintained upstream is clearly there.

Conventions (same scheme as [feezal](https://github.com/feezal/feezal)):
decisions are `D-n`, open questions `OQ-n`, backlog items `B-n`. IDs are
stable and never reused. This file holds only open items: when an item is
completed or closed, its content moves to
[roadmap-archive/](roadmap-archive/) — one file per item, named after its
ID (e.g. `B-1.md`) — and its line in the contents below gets a ✅ marker
linking into the archive, so the ID stays findable from this index.
Decisions (D-n) stay here as the record of why things are the way they
are; answered open questions are rewritten in place
(`**answered <date>** — …`).

Status 2026-09-02: **4.0.0 is released** (npm latest, OIDC provenance,
GitHub release). Phases 1 and 2 are done and archived. Next: Phase 3
(refactor & tests) and the Phase 4 backlog (B-1…B-13); work continues on
master with CI (Node 22/24 × Node-RED 4/5) as the gate. Research basis:
the GitHub tracker/PRs/forks, homematic-forum.de, Node-RED release notes and
scorecard criteria, and the hm2mqtt.js 3.0 rewrite (same author), which
already re-derived and modernized large parts of `ccu-connection.js` and
whose ROADMAP documents several verified bugs in this repo.

**Ground truth**

- [1. Where we stand (v3.4.2)](#1-where-we-stand-v342)
- [2. Platform targets](#2-platform-targets)
- [10. Ecosystem context (2026)](#10-ecosystem-context-2026)

**Decisions**

- [3. Decisions D-1…D-15](#3-decisions)
- [11. Open questions OQ-1…OQ-6](#11-open-questions)

**Phases**

- [4. Phase 1 — tooling groundwork](#4-phase-1--tooling-groundwork-no-behavior-change) ✅ [archived](roadmap-archive/phase-1.md)
- [5. Phase 2 — compatibility release 4.0.0](#5-phase-2--compatibility-release-400) ✅ [archived](roadmap-archive/phase-2.md)
- [6. Phase 3 — refactor & tests](#6-phase-3--refactor--tests)
- [7. Phase 4 — features & devices B-1…B-13](#7-phase-4--features--device-backlog)

**Reference**

- [8. Bug inventory](#8-bug-inventory-diagnosed-not-yet-fixed)
- [9. What to take from forks and PRs](#9-what-to-take-from-forks-and-prs)
- [12. GitHub issue snapshot](#12-github-issue-snapshot)

Completed items: [roadmap-archive/](roadmap-archive/) — currently only
the [pre-roadmap TODO.md history](roadmap-archive/todo-history.md).

---

## 1. Where we stand (v3.4.2)

- **Runtime**: `engines.node >= 10`; Node-RED devDep `^1.1.2`; zero
  `async/await`, a `promise.prototype.finally` polyfill that has been a
  no-op since Node 10; `nodes/ccu-connection.js` is a 2953-line monolith
  (HTTP admin endpoint, RPC clients/servers, metadata persistence, ReGa,
  message creation, casting, queue — all in one closure).
- **Tooling**: xo 0.32 (2020), mocha 8, nyc + coveralls (both effectively
  dead), husky 4 (dead config format), `node-red-node-test-helper` 0.2.5
  (current: 0.3.6). CI is a GitHub workflow on Node **10.x/12.x** with
  `actions/*@v1/v2` (removed runners); a stale `.travis.yml` remains;
  README badges point at dead services (travis-ci.org, david-dm.org).
  Publishing is manual (`checkgit`/`postpublish` shell one-liners).
- **Tests**: 3 specs, 31 cases, all full Node-RED boots against
  `hm-simulator`. No unit tests for the pure logic (`createMessage`,
  casting, topic templates). Issue [#81](https://github.com/rdmtc/node-red-contrib-ccu/issues/81).
- **Known blocker**: on Node-RED 4.x, users must open node config dialogs
  several times before the interface/device/channel/datapoint selects
  populate. Root cause diagnosed — see §8.1. Nobody in the
  ecosystem has fixed this; it must be fixed here.
- **Dependencies**: 4 of 10 runtime deps are removable outright, 2 have
  maintained 2.0 releases by the same author, 1 (`string-similarity`) is
  deprecated on npm (issue [#176](https://github.com/rdmtc/node-red-contrib-ccu/issues/176)).
  Details in §3 / D-4…D-7.

## 2. Platform targets

Facts (verified 2026-09-01):

| Platform                                                            | Requirement           | Note                                                      |
| ------------------------------------------------------------------- | --------------------- | --------------------------------------------------------- |
| Node-RED 4.0 (Jun 2024)                                             | Node ≥ 18             | in maintenance until 2026-12-31                           |
| Node-RED 4.1 (Jul 2025)                                             | Node ≥ 18             | flags stale/deprecated palette packages                   |
| Node-RED 5.0 (Jun 2026)                                             | Node ≥ 22.9           | **drops 32-bit ARM** — no NR 5 on CCU3-class hardware     |
| homematic-rega 2.0.0 / homematic-xmlrpc 2.0.0                       | Node ≥ 20             | published 2026-08-27                                      |
| RedMatic revival ([../redmatic ROADMAP §4](../redmatic/ROADMAP.md)) | Node 24, Node-RED 5.x | armv7l runtime repackaged from Alpine musl (hm2mqtt H-39) |

Consequence: the old "Node-RED ≥ 1.0" README promise is obsolete. And the
"no Node-RED 5 / Node 24 on CCU3 hardware" constraint only applies to
_official_ binaries: hm2mqtt solved the runtime problem by repackaging
Alpine's musl Node 24 armv7l build with patchelf (hm2mqtt ROADMAP H-39),
verified on real CCU3 hardware — full test suite green on the official
firmware's glibc 2.27 (OQ-63 there). The RedMatic revival adopts exactly
that ([../redmatic ROADMAP §4](../redmatic/ROADMAP.md): Node 14 → 24.x,
Node-RED 2.1.5 → 5.x). So:

**Primary target: Node-RED 5.x on Node 24 — what RedMatic will bundle.
Floors stay at Node ≥ 20 / Node-RED ≥ 4.0** (nothing here needs 5-only
APIs; standalone Node-RED 4.x users remain supported at least until its
maintenance ends 2026-12-31), **CommonJS throughout** (D-2).

## 3. Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | **Raise floors: `engines.node: ">=20"`, `node-red.version: ">=4.0.0"` in package.json — but the primary dev/test target is Node-RED 5 on Node 24**, which the RedMatic revival bundles (self-built Alpine-musl armv7l runtime, hm2mqtt H-39). The floors keep standalone NR 4.x / Node 20 users supported and match what homematic-rega/xmlrpc 2.0 require (Node ≥ 20). This is the gate for everything else and makes the next release a major: **4.0.0**.                                       |
| D-2  | **Stay CommonJS.** Node-RED 5's ESM support is incomplete; the maintainers themselves advise against migrating node runtimes to ESM ([discourse thread](https://discourse.nodered.org/t/node-red-v5-now-supports-esm-nodes-maybe-maybe-not/101259)). `homematic-rega` 2.0 is ESM-only → load it via dynamic `import()` from CJS.                                                                                                                                                                  |
| D-3  | **Lint: xo → ESLint 9 flat config + Prettier.** Template exists in [hm2mqtt.js/eslint.config.js](../hm2mqtt.js/eslint.config.js) including the second config block with browser globals (`$`, `RED`) for the `.html` editor scripts — replaces xo's `global` hack. Prettier at 4-space/120-col matches the existing style (hm2mqtt's `.prettierrc` is copyable). Drop husky entirely; CI is the gate.                                                                                             |
| D-4  | **Bump `homematic-xmlrpc` → 2.0.0 and `homematic-rega` → 2.0.0.** xmlrpc 2.0 removes the fragile xmlbuilder GitHub-tarball reference and adds server `error`/`listening` events + promise `close()` — exactly what the `httpServer` reach-in hack at `ccu-connection.js:1709` asks for in its own TODO comment. rega 2.0 has zero runtime deps and finally removes `request@2.88` (deprecated since 2020, our biggest audit liability), does timestamp conversion in the lib, and is unit-tested. |
| D-5  | **binrpc: merge/release [hobbyquaker/binrpc#10](https://github.com/hobbyquaker/binrpc/pull/10)** (open since 2019 — missing socket error listener; a late response after timeout crashes the whole Node-RED process). This is the likely cause of issue [#160](https://github.com/rdmtc/node-red-contrib-ccu/issues/160). A binrpc 4.0 without the abandoned `binary`/`put` deps is a separate, later job (same call as hm2mqtt ROADMAP §6.4).                                                    |
| D-6  | **Drop dead-weight deps**: `promise.prototype.finally` (native since Node 10), `obj-ease` (only used by `tools/`, move to devDeps at most), `string-similarity` (deprecated; single call site at `ccu-connection.js:437` — replace with ~20 lines of inline Dice coefficient, closes the core of [#176](https://github.com/rdmtc/node-red-contrib-ccu/issues/176)).                                                                                                                               |
| D-7  | **Vendor the micro-deps** `hm-discover`, `nextport`, `buffer-base62`, `mqtt-wildcard` into `nodes/lib/` (ptweety fork demonstrated this — ~50 lines each, all dormant since ~2019). Fewer install-time deprecation warnings, better scorecard "dependencies at latest" line.                                                                                                                                                                                                                      |
| D-8  | **Tests: extract pure modules and unit-test them with `node --test` + `node:assert` (zero test deps); keep `node-red-node-test-helper` (bumped to 0.3.6) + mocha 10 for the integration specs; coverage nyc → c8, drop coveralls/camo-purge.** This revises the earlier "adopt jest" plan: the author's own newer practice (hm2mqtt, 21 test files on `node --test`) is a strictly smaller dependency surface, and test-helper remains the official, mocha-centric path for integration.          |
| D-9  | **CI: GitHub Actions, Node 20/22/24 × Node-RED 4.x and 5.x** (5.x legs on Node 22/24 only — its floor is 22.9; **Node 24 + Node-RED 5 is the primary leg**), `checkout@v4`/`setup-node@v4`, `npm ci` → lint → test. Delete `.travis.yml`, fix README badges.                                                                                                                                                                                                                                      |
| D-10 | **Release: tag-triggered workflow with npm OIDC trusted publishing** (`id-token: write`, `npm publish --provenance`, needs npm ≥ 11.5.1 so `npm install -g npm@latest` first). Copyable nearly verbatim from [hm2mqtt.js/.github/workflows/release.yml](../hm2mqtt.js/.github/workflows/release.yml). No long-lived npm token.                                                                                                                                                                    |
| D-11 | **Changelog: hand-written Keep-a-Changelog `CHANGELOG.md`** + a small `release-notes.js` that extracts the tag's section for the GitHub release (hm2mqtt pattern). Closes [#87](https://github.com/rdmtc/node-red-contrib-ccu/issues/87). Preferred over the ptweety fork's `auto-changelog` — entries should explain user-visible symptoms, not list commits.                                                                                                                                    |
| D-12 | **Keep the unscoped name `node-red-contrib-ccu`.** Existing unscoped names are grandfathered by the 2022 naming rules; the ptweety scoped fork was never actually published to npm and is dormant since Oct 2022 — this repo remains canonical.                                                                                                                                                                                                                                                   |
| D-13 | **Scorecard compliance before the next publish**: `engines.node`, `node-red.version`, an `examples/` directory with importable flows, refreshed deps. A new release instantly regenerates the missing scorecard — cheap, high-visibility win.                                                                                                                                                                                                                                                     |
| D-14 | **Add CCU-Jack as a supported interface** (PR [#162](https://github.com/rdmtc/node-red-contrib-ccu/pull/162), independently validated by ptweety commit `718ff65`; closes [#164](https://github.com/rdmtc/node-red-contrib-ccu/issues/164)). Expose port/path in config instead of hardcoding.                                                                                                                                                                                                    |
| D-15 | **No flow-breaking config-schema changes in 4.0.** Existing flows must import cleanly; the major bump is for engines/Node-RED floors, not node semantics. Anything touching node config schemas needs a migration story (RedMatic installs).                                                                                                                                                                                                                                                      |

## 4. Phase 1 — tooling groundwork (no behavior change)

**✅ done 2026-09-01** — moved to
[roadmap-archive/phase-1.md](roadmap-archive/phase-1.md). Shipped as
`4.0.0-dev.1` … `4.0.0-dev.4`: CI matrix (Node 20/22/24 × Node-RED 4/5)
plus the OIDC release pipeline, ESLint 9 + Prettier, runtime deps 10 → 4,
mocha 11 / test-helper 0.3.6 / c8, CHANGELOG bootstrap. The engines /
node-red.version floors (D-1/D-13) were pulled forward from Phase 2.

## 5. Phase 2 — compatibility release 4.0.0

**✅ done 2026-09-02** — moved to
[roadmap-archive/phase-2.md](roadmap-archive/phase-2.md). Released as
v4.0.0 on npm (OIDC provenance) and GitHub; first release since
Jan 2022. Editor fix, rega/xmlrpc 2.0, binrpc 3.3.2, CCU-Jack, payload
guard, examples — all verified in the 2026-09-02 smoke test.

## 6. Phase 3 — refactor & tests

Goal: make `ccu-connection.js` maintainable and the logic testable
without booting Node-RED. hm2mqtt already proved this decomposition
reproduces the behavior field-for-field (overnight compare, 1486 items).

1. Split `ccu-connection.js` (2953 lines) along hm2mqtt's `lib/` seams:
   rpc, metadata/paramsets, rega, values/createMessage, cast, topics,
   queue, admin endpoint. Target ~300-line modules; pure functions where
   possible.
2. Unit tests (`node --test`) for the pure modules: `createMessage`,
   `paramCast`, topic templates, sysvar casting (D-8) — this is the real
   answer to [#81](https://github.com/rdmtc/node-red-contrib-ccu/issues/81).
3. Migrate callbacks/`.then` chains to async/await as modules are
   touched (no big-bang rewrite).
4. Editor HTML cleanup: shared loader helper for the 9 near-identical
   `oneditprepare` implementations (see §8.1's fix shape), proper error
   handling on every `$.getJSON`.
5. i18n/help consolidation: move the 13 inline `data-help-name` help
   texts into `locales/`, add missing `ccu-alexa`/`ccu-mqtt`/`ccu-switch`
   locale files (ptweety's restructure is the reference; this closes the
   long-standing "documentation, i18n" todo).

## 7. Phase 4 — features & device backlog

| ID   | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Source                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| B-1  | Update `paramsets.json` for newer HmIP devices — first make `tools/paramsets-join.js` a documented, repeatable job against a live CCU/OpenCCU (OQ-5 decision), then regenerate ([#112](https://github.com/rdmtc/node-red-contrib-ccu/issues/112) ACTIVE_PROFILE clamped by stale MAX=3, HmIP-BSL 2.0.2 [#177](https://github.com/rdmtc/node-red-contrib-ccu/issues/177), LEVEL_2 blinds [#175](https://github.com/rdmtc/node-red-contrib-ccu/issues/175)/[#154](https://github.com/rdmtc/node-red-contrib-ccu/issues/154)/[#136](https://github.com/rdmtc/node-red-contrib-ccu/issues/136), CuxD DIR [#159](https://github.com/rdmtc/node-red-contrib-ccu/issues/159), forum reports: HmIP-eTRV-3, HmIP-BROLL-2, HmIP-ESI ch. 2–4)                                                                                                                              | tracker + forum                |
| B-2  | Dynamic node configuration via msg — recurring theme [#172](https://github.com/rdmtc/node-red-contrib-ccu/issues/172), [#71](https://github.com/rdmtc/node-red-contrib-ccu/issues/71), [#103](https://github.com/rdmtc/node-red-contrib-ccu/issues/103), [#80](https://github.com/rdmtc/node-red-contrib-ccu/issues/80), [#56](https://github.com/rdmtc/node-red-contrib-ccu/issues/56), plus [#148](https://github.com/rdmtc/node-red-contrib-ccu/issues/148) (SOUNDFILE_LIST via msg), [#158](https://github.com/rdmtc/node-red-contrib-ccu/issues/158) (subflow env config) and [#133](https://github.com/rdmtc/node-red-contrib-ccu/issues/133) — the latter confirmed still broken in 4.0.0: `setValues()` writes msg values into `config` permanently, so the first message's filters stick. Design properly rather than merging PR #173's auto-subscribe | tracker                        |
| B-3  | Fix the ccu-mqtt node bugs verified in hm2mqtt ROADMAP §1.3 (see §8.2); also [#115](https://github.com/rdmtc/node-red-contrib-ccu/issues/115) get/update method (fresh user interest Apr 2026), [#22](https://github.com/rdmtc/node-red-contrib-ccu/issues/22) missing RPC-topic GUI, [#167](https://github.com/rdmtc/node-red-contrib-ccu/issues/167) stale rooms/functions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | hm2mqtt                        |
| B-4  | Fix/remove the dead `isLocal` detection (`/etc/lighttpd/conf.d/proxy.conf` grep, `ccu-connection.js:346` — file is a stub on firmware ≥ 3.87, so local installs silently go through the proxy)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | hm2mqtt §15.4                  |
| B-5  | Configurable ping checks ([#44](https://github.com/rdmtc/node-red-contrib-ccu/issues/44)), sysvar node property/status improvements ([#54](https://github.com/rdmtc/node-red-contrib-ccu/issues/54), [#56](https://github.com/rdmtc/node-red-contrib-ccu/issues/56), [#52](https://github.com/rdmtc/node-red-contrib-ccu/issues/52) last-event status, [#124](https://github.com/rdmtc/node-red-contrib-ccu/issues/124) re-read descriptions on poll, [#166](https://github.com/rdmtc/node-red-contrib-ccu/issues/166) immediate sysvar echo, [#96](https://github.com/rdmtc/node-red-contrib-ccu/issues/96) uncertain-filter option)                                                                                                                                                                                                                           | tracker                        |
| B-6  | binrpc 4.0 rewrite without abandoned `binary`/`put` deps                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | deferred, mirrors hm2mqtt §6.4 |
| B-7  | Triage the remaining ~60 open issues (snapshot in §12) against phases; close what 4.0 fixes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | tracker                        |
| B-8  | Global object: expose CCU metadata/values via a global context object (old todo item)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | old TODO                       |
| B-9  | Value node: datapoint autocomplete / multiselect (rpc and rpc-event already have it)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | old TODO                       |
| B-10 | Submit/display node polish (old todo items): submit autocomplete, limit list to 10 cmds, fix display LED, display beep, payload via msg                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | old TODO                       |
| B-11 | Re-init robustness after a CCU outage (found live in the 2026-09-02 smoke test): (a) `rpcCheckInit` returns without rescheduling itself when the interface has no devices in the metadata cache, so interfaces without paired devices (e.g. BidCos-RF on an HmIP-only CCU) never ping and never re-init — after a CCU reboot they stay dead until Node-RED is restarted; (b) a failed `rpcInit` (e.g. the shutting-down CCU answers XML-RPC with an HTML error page → "Unknown XML-RPC tag 'TITLE'") has no retry of its own, so combined with (a) one failed re-init is final; (c) the hardcoded 600 s HmIP-RF pingTimeout means up to 10 min of silent event loss after a CCU reboot — make it configurable together with B-5/#44. Fix shape: arm the watchdog regardless of metadata, retry failed inits with backoff.                                       | smoke test                     |
| B-12 | Complete the [#27](https://github.com/rdmtc/node-red-contrib-ccu/issues/27) checklist: authentication and TLS for all interface connections (two of four items from 2019 still open; ptweety's TLS-warning reactivation in §9 is related groundwork)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | tracker                        |
| B-13 | Party/holiday mode support ([#161](https://github.com/rdmtc/node-red-contrib-ccu/issues/161), [#156](https://github.com/rdmtc/node-red-contrib-ccu/issues/156)): PARTY_TIME_START/END must be written atomically (putParamset/combined parameter); possibly a dedicated node                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | tracker                        |

## 8. Bug inventory (diagnosed, not yet fixed)

### 8.1 Node-RED 4.x: config selects stay empty until dialog reopened

**Largely fixed 2026-09-01 (`4.0.0-dev.5`)** — defects 1 and 2 below are
fixed in all 9 files: the initial load is now triggered explicitly at the
end of `oneditprepare` instead of relying on the config select's `change`
event, the `ifacesPending` latch is cleared in a `.fail()` handler with up
to 5 retries (1 s apart), and the `_ADD_` code path no longer leaves the
latch stuck in the two files that had that variant (ccu-get-value,
ccu-switch). Defect 3 (cold start can return an empty channel list with no
retry) remains open — fold it into the Phase 3 editor-loader
consolidation (§6.4). Verified 2026-09-02 in a real Node-RED 5.0.6
editor (smoke test); CI still has no editor tests.

Same pattern in 9 editor files (`ccu-value`, `ccu-set-value`,
`ccu-get-value`, `ccu-rpc`, `ccu-rpc-event`, `ccu-signal`, `ccu-display`,
`ccu-switch`, `ccu-alexa`). Three compounding defects in the
`loadIfaces`/`loadConfig` chain (see `nodes/ccu-value.html:56-107`):

1. The whole load chain hangs off a single jQuery `change` handler on the
   config-node select — if Node-RED 4's dialog build sets the value
   without firing `change` (or before the handler attaches), nothing ever
   loads. Fix: trigger the initial load explicitly at the end of
   `oneditprepare` (three nodes already do this trick for the _iface_
   select, none for the _config_ select).
2. `ifacesPending` is a one-way latch: only the `$.getJSON` success path
   clears it. When the `/ccu` admin endpoint answers 500 (config node not
   yet instantiated — just deployed, disabled, still starting), no retry
   within the open dialog can ever succeed. Fix: `.fail()` handlers, a
   request-in-flight promise instead of a boolean.
3. Even a 200 can return `{}`: `type=channels|tree` only emit channels
   whose paramset descriptions are already cached
   (`ccu-connection.js:91-108`); on cold start the first open yields empty
   lists with no error and no retry. Fix: retry/poll or surface a
   "still loading" state.

Add a Node-RED 4.x leg to the test matrix so this class of regression is
caught (the devDep pin to `^1.1.2` is why it never was).

### 8.2 Verified in the hm2mqtt 3.0 rewrite (free, confirmed findings)

- `nodes/ccu-mqtt.js`: the writeable check `!(OPERATIONS) && 2` is always
  false; `putParamset` casts with `description[filter.param]` which is
  `undefined`, so values pass uncast.
- Empty-name topic bug: devices without a rega name produce
  `hm/status//STATE`-style topics.
- `datapointEnum`/`valueEnum` in outgoing messages read
  `description.ENUM`, which the interface processes never send — both
  have always been `undefined`.

### 8.3 Misc

- PR #173 as submitted contains `message.cache || true` (always truthy)
  and loose `!= undefined` — fix when taking the guard.
- Editor HTML ships `console.log` debug leftovers.

## 9. What to take from forks and PRs

- **PR [#162](https://github.com/rdmtc/node-red-contrib-ccu/pull/162)**
  (CCU-Jack): take, with configurable port/path (D-14).
- **PR [#173](https://github.com/rdmtc/node-red-contrib-ccu/pull/173)**:
  take the undefined-payload guard only (§5.6); auto-subscribe → B-2.
- **[ptweety fork](https://github.com/ptweety/node-red-contrib-ccu)**
  (v3.5.0–3.6.2, Oct 2022, dormant since, never on npm): cherry-pick
  ideas, not commits — CCU-Jack (≡ PR #162), dep pruning/vendoring
  (D-6/D-7), nyc→c8, TLS-warning reactivation (`9fb3466`), MIGRATION.md/
  CONTRIBUTING.md docs idea. Skip: its `src/` build split (hm2mqtt's
  newer answer is "ship sources, no build step"), auto-changelog (D-11),
  xo bump (we leave xo entirely). It contains **no** Node-RED 3/4-era
  fixes — it predates them.
- All other forks (11, all 0 stars, none pushed since 2022): nothing to
  take beyond the two PRs above.
- **[binrpc#10](https://github.com/hobbyquaker/binrpc/pull/10)**: merge
  upstream (D-5).

## 10. Ecosystem context (2026)

- **RaspberryMatic → OpenCCU** (renamed May 2026). RedMatic remains a
  third-party addon; the [rdmtc/RedMatic](https://github.com/rdmtc/RedMatic)
  revival strips it down to node-red-contrib-ccu only and targets Node 24 /
  Node-RED 5.x with a self-built armv7l runtime (Alpine musl repackage,
  hm2mqtt H-39) — this roadmap's Phase 2 is its prerequisite.
- **Community**: RedMatic subforum still very active, but running on
  community patches (Node-RED current + Node 20/22 on OpenCCU). These
  users are the first adopters of 4.0.0.
- **Competition**: CCU-Jack + plain MQTT nodes is the most-cited
  migration path; [openccu-loom](https://github.com/SukramJ/node-red-contrib-openccu-loom)
  (2026, SukramJ of Home Assistant Homematic(IP) Local fame, NR ≥ 4.1.9 /
  Node ≥ 22.9) is the modern benchmark. Differentiator to keep: direct
  BINRPC/XMLRPC + ReGa without any extra daemon, and RedMatic packaging.
- **Node-RED 4.x maintenance ends 2026-12-31**; 5.x is the active line,
  and with the bundled Alpine-musl Node 24 runtime it reaches CCU3
  hardware despite the official 32-bit ARM drop. Supporting 4.x and 5.x
  from one CJS codebase (D-1/D-2) covers the whole user base.

## 11. Open questions

| ID   | Question                                                                                                                                                                                                                                                 | Proposal                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| OQ-1 | **answered 2026-09-01** — Node floor 20 or 22? Floor stays `>=20` (homematic-rega/xmlrpc 2.0 requirement, keeps standalone NR 4.x users); the primary target is Node 24 + Node-RED 5, which RedMatic bundles via its own armv7l runtime (hm2mqtt H-39).  | Revisit the floor when NR 4.x maintenance ends (2026-12-31).                                                        |
| OQ-2 | **answered 2026-09-01** — `node-red-node-test-helper` 0.3.6 runs the full suite cleanly under both targets: 23/23 specs on Node-RED 4.1 and on Node-RED 5.0.5, both on Node 24 (also on Node 20 / NR 4.1 earlier).                                       | Closed. Only the editor UI itself (§8.1 fix) still needs a manual smoke test — the specs don't exercise the editor. |
| OQ-3 | **answered 2026-09-01** (user decision) — vendor only the dormant three (`hm-discover`, `nextport`, `buffer-base62`, done in dev.2); `mqtt-wildcard` stays a normal dependency (maintained, same author).                                                | Closed.                                                                                                             |
| OQ-4 | **answered 2026-09-01** (user decision) — 4.0.0 releases first, as soon as its blockers (§5.4, editor smoke test) are done; RedMatic bundles it whenever its own Node 24 / Node-RED 5 modernization lands. No release coupling.                          | Closed.                                                                                                             |
| OQ-5 | **answered 2026-09-01** (user decision) — paramsets.json becomes scripted from a live CCU: revive `tools/paramsets-join.js` as a documented, repeatable job against the CCU/OpenCCU with current firmware, rerun on firmware updates and as part of B-1. | Closed — implementation folded into B-1 (Phase 4).                                                                  |
| OQ-6 | **closed 2026-09-01** (user decision) — SPECIAL paramset key handling is dropped; no device using it was ever identified. Reopen only if a real device report needs it.                                                                                  | Closed.                                                                                                             |

## 12. GitHub issue snapshot

Imported from <https://github.com/rdmtc/node-red-contrib-ccu/issues> on
2026-07-16 (60 open issues at the time; latest is #178 from 2025-08).
**Triaged 2026-09-02 after the 4.0.0 release (B-7): 23 issues and both
open PRs closed with signed comments (5 fixed by 4.0.0 or earlier, 18
resolved/obsolete/wrong-repo), 4 got retest requests and stay open
(#111, #145, #146, #151), 32 remain valid and are annotated with their
roadmap item below.** Wrong annotations found during triage were
corrected in place (#178, #119, #148).

- [#22](https://github.com/rdmtc/node-red-contrib-ccu/issues/22) MQTT Node: No GUI for node-input-topicInputRpc
- [#27](https://github.com/rdmtc/node-red-contrib-ccu/issues/27) Anpassungen an CCU Firmware >= 3.41 → B-12 (Auth/TLS halves still open)
- [#39](https://github.com/rdmtc/node-red-contrib-ccu/issues/39) topic handling vereinheitlichen
- [#44](https://github.com/rdmtc/node-red-contrib-ccu/issues/44) Configuration Option to deactivate Ping Checks → B-5
- [#51](https://github.com/rdmtc/node-red-contrib-ccu/issues/51) switch node casts boolean payloads to numbers
- [#52](https://github.com/rdmtc/node-red-contrib-ccu/issues/52) RPC Event: Zeitpunkt des letzten Events und ggf. letztes Topic
- [#54](https://github.com/rdmtc/node-red-contrib-ccu/issues/54) ccu-sysvar node: aktueller Status und ggf. Zeitpunkt von wann der Status stammt unter dem node → B-5
- [#56](https://github.com/rdmtc/node-red-contrib-ccu/issues/56) make property for sysvar-node configurable → B-2/B-5
- [#58](https://github.com/rdmtc/node-red-contrib-ccu/issues/58) Hilfe Texte → §6.5
- [#71](https://github.com/rdmtc/node-red-contrib-ccu/issues/71) Set value node: allow to set filter properties with incoming msg → B-2
- [#80](https://github.com/rdmtc/node-red-contrib-ccu/issues/80) Signal Node: allow to overwrite settings via msg/context/env → B-2
- [#81](https://github.com/rdmtc/node-red-contrib-ccu/issues/81) increase test coverage → §6.2
- [#87](https://github.com/rdmtc/node-red-contrib-ccu/issues/87) Changelog → D-11 — ✅ closed 2026-09-02
- [#96](https://github.com/rdmtc/node-red-contrib-ccu/issues/96) uncertain Flag das gesetzt wird wenn Rega Zeitstempel 1970-01-01 01:00:00 zurückgibt
- [#103](https://github.com/rdmtc/node-red-contrib-ccu/issues/103) switch node params via msg → B-2
- [#105](https://github.com/rdmtc/node-red-contrib-ccu/issues/105) ccu-value Node: Weiterbenutzung des Input-msg-Objects, statt Neuinstaziierung — ✅ closed 2026-09-02
- [#106](https://github.com/rdmtc/node-red-contrib-ccu/issues/106) Statusänderung eines Kanals wird nicht übermittelt — ✅ closed 2026-09-02
- [#110](https://github.com/rdmtc/node-red-contrib-ccu/issues/110) Node-RED: v1.0.4 & CCU3-3.51.6 / Error: getaddrinfo ENOTFOUND — ✅ closed 2026-09-02
- [#111](https://github.com/rdmtc/node-red-contrib-ccu/issues/111) ON_TIME wird nicht initial befüllt
- [#112](https://github.com/rdmtc/node-red-contrib-ccu/issues/112) Nur drei Heizungsprofile verfügbar (# 4-6 stehen nicht zur Auswahl) → B-1 (stale MAX=3 in paramset)
- [#114](https://github.com/rdmtc/node-red-contrib-ccu/issues/114) Possible to use "localfilesystem" for Context Store — ✅ closed 2026-09-02
- [#115](https://github.com/rdmtc/node-red-contrib-ccu/issues/115) add get/update method to mqtt node
- [#116](https://github.com/rdmtc/node-red-contrib-ccu/issues/116) Google Home Anbindung: State von CCU wird nicht zurück an Google Home übermittelt — ✅ closed 2026-09-02
- [#117](https://github.com/rdmtc/node-red-contrib-ccu/issues/117) Einbinden HmIP-FCI6 → B-1
- [#119](https://github.com/rdmtc/node-red-contrib-ccu/issues/119) HmIP-BROLL wird nicht gefunden (resolved: port misconfiguration) — ✅ closed 2026-09-02
- [#121](https://github.com/rdmtc/node-red-contrib-ccu/issues/121) rpc-event STICKY_UNREACH — ✅ closed 2026-09-02
- [#124](https://github.com/rdmtc/node-red-contrib-ccu/issues/124) poll variable description
- [#126](https://github.com/rdmtc/node-red-contrib-ccu/issues/126) Context store property name dot replacement — ✅ closed 2026-09-02
- [#128](https://github.com/rdmtc/node-red-contrib-ccu/issues/128) CCU Switch node - wrong resize in settings dialog (fix in v3.4.2?) — ✅ closed 2026-09-02
- [#129](https://github.com/rdmtc/node-red-contrib-ccu/issues/129) ccu-get-value node: bei einer Werteliste wird nur der value zurückgegeben (fix in v3.4.2?) — ✅ closed 2026-09-02
- [#132](https://github.com/rdmtc/node-red-contrib-ccu/issues/132) Ports — ✅ closed 2026-09-02
- [#133](https://github.com/rdmtc/node-red-contrib-ccu/issues/133) ccu-set-value "remembers" previous events
- [#136](https://github.com/rdmtc/node-red-contrib-ccu/issues/136) HmIP-FBL → B-1
- [#138](https://github.com/rdmtc/node-red-contrib-ccu/issues/138) Failed at the grpc@1.19.0 install script — ✅ closed 2026-09-02
- [#139](https://github.com/rdmtc/node-red-contrib-ccu/issues/139) CCU Node error message in the log (IoBroker) — ✅ closed 2026-09-02
- [#140](https://github.com/rdmtc/node-red-contrib-ccu/issues/140) "Error: unknown datapoint BidCos-RF.OEQxxxxxxx:1.STATE" — ✅ closed 2026-09-02
- [#143](https://github.com/rdmtc/node-red-contrib-ccu/issues/143) Ich bekomme mit get-value nur Fehlermeldungen und keinen Status — ✅ closed 2026-09-02
- [#144](https://github.com/rdmtc/node-red-contrib-ccu/issues/144) Signal Node: Integration of HmIP-WRCD → B-1
- [#145](https://github.com/rdmtc/node-red-contrib-ccu/issues/145) CCU value Node CUX16 no Output
- [#146](https://github.com/rdmtc/node-red-contrib-ccu/issues/146) CCU different / changing Nodes with "unknown Datapoint"
- [#148](https://github.com/rdmtc/node-red-contrib-ccu/issues/148) Signal Node: HmIP-MP3P Dynamisches Setzen von SOUNDFILE_LIST → B-2
- [#149](https://github.com/rdmtc/node-red-contrib-ccu/issues/149) XML-RPC fault mit falscher value? — ✅ closed 2026-09-02
- [#151](https://github.com/rdmtc/node-red-contrib-ccu/issues/151) FROLL: Cache geht nicht mit Geräten mit 2 Kanälen für Soll/Ist bei Handbedienung
- [#154](https://github.com/rdmtc/node-red-contrib-ccu/issues/154) HmIP-BBL datapoint LEVEL_2 cannot be set → B-1
- [#155](https://github.com/rdmtc/node-red-contrib-ccu/issues/155) Error: Local address XXX not available. Using YYY instead. — ✅ closed 2026-09-02
- [#156](https://github.com/rdmtc/node-red-contrib-ccu/issues/156) Set PARTY_TIME_START and PARTY_TIME_END not working → B-13
- [#158](https://github.com/rdmtc/node-red-contrib-ccu/issues/158) using in SubFlows
- [#159](https://github.com/rdmtc/node-red-contrib-ccu/issues/159) Fehlender CuxD datapoint "DIR" → B-1
- [#160](https://github.com/rdmtc/node-red-contrib-ccu/issues/160) Node-RED Absturz bei Verbindungsverlust zur CCU → D-5 — ✅ closed 2026-09-02
- [#161](https://github.com/rdmtc/node-red-contrib-ccu/issues/161) Feature Request: Node "Party Mode" → B-13
- [#164](https://github.com/rdmtc/node-red-contrib-ccu/issues/164) Support CCU-Jack → D-14
- [#166](https://github.com/rdmtc/node-red-contrib-ccu/issues/166) Mehrere Variablen sofort schreiben und triggern
- [#167](https://github.com/rdmtc/node-red-contrib-ccu/issues/167) updated function values in ccu and functions in ccu-mqtt node
- [#169](https://github.com/rdmtc/node-red-contrib-ccu/issues/169) "Error: XML-RPC fault: Generic error (UNREACH)" — ✅ closed 2026-09-02
- [#170](https://github.com/rdmtc/node-red-contrib-ccu/issues/170) Auslesen System-Variable — ✅ closed 2026-09-02
- [#172](https://github.com/rdmtc/node-red-contrib-ccu/issues/172) Configure CCU-Value through message → B-2
- [#175](https://github.com/rdmtc/node-red-contrib-ccu/issues/175) HmIP-DRBLI4 Level_2 not working → B-1
- [#176](https://github.com/rdmtc/node-red-contrib-ccu/issues/176) Deprecated dependencies → D-4/D-6/D-7 — ✅ closed 2026-09-02
- [#177](https://github.com/rdmtc/node-red-contrib-ccu/issues/177) HmIP-BSL 2.0.2 & Signal Node: Color Behaviour missing → B-1
- [#178](https://github.com/rdmtc/node-red-contrib-ccu/issues/178) HmIP-SWDO visible in device list but HmIP-SWDO-PL-2 not (redmatic-homekit issue, wrong repo) — ✅ closed 2026-09-02
