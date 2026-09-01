# Agent Instructions

Instructions for AI coding agents (Claude Code, etc.) working in this repository.

## Project overview

`node-red-contrib-ccu` provides Node-RED nodes to connect to a Homematic CCU
(BidCos/HmIP/CUxD home automation hardware from eQ-3). It talks to the CCU
via BINRPC/XMLRPC (`nodes/ccu-connection.js` holds the bulk of the connection
and RPC logic) and via ReGaHSS remote scripts.

Layout:
- `nodes/` — one `.js` (server-side logic) + `.html` (editor UI/registration)
  pair per node type. `nodes/lib/` has shared helpers, `nodes/icons/` and
  `nodes/locales/` are editor assets/i18n.
- `test/` — mocha specs (`*_spec.js`), plus `test/simulator-data` and
  `test/simulator-behaviors` used with `hm-simulator` to fake a CCU for tests.
- `tools/` — one-off scripts, not part of the published package.
- `paramsets.json` — large generated/vendored data file describing CCU device
  paramsets (datapoints). Treat as data, not something to hand-edit.
- `docs/` — images referenced from README.md.

## Roadmap

Planned work lives in ROADMAP.md (stable IDs: `D-n` decisions, `B-n`
backlog, `OQ-n` open questions — never reuse an ID). When an item is
completed, move its content to `roadmap-archive/<ID>.md` (one file per
item), list it in `roadmap-archive/README.md`, and mark its line in the
ROADMAP.md contents with ✅ linking to the archive file. Read ROADMAP.md
before starting work that might overlap with a decision recorded there.

## Reference documentation

For anything involving HomematicIP (HmIP) devices, channels, or datapoints
(paramset names, value ranges, units, ENUM meanings, which channel a
datapoint belongs to, etc.), consult the official eQ-3 documentation:

https://www.eq-3.de/Downloads/eq3/download%20bereich/hm_web_ui_doku/HmIP_Device_Documentation.pdf

This PDF is the authoritative source for HmIP device/channel/datapoint
definitions — prefer it over guessing when adding or fixing paramset
handling, value casting, or device-specific logic.

For CUxD-specific devices/channels/datapoints, consult the docs in the
cuxd project itself:

https://github.com/jens-maus/cuxd/tree/master/docs

## Related fork worth checking

https://github.com/ptweety/node-red-contrib-ccu is an active fork of this
repo (currently at v3.6.2 vs. our v3.4.2). Not all of its direction is
necessarily wanted here, but it has diverged with changes that may be worth
cherry-picking individually — evaluate case by case rather than bulk-merging.
Known differences as of 2026-07:

- Added CCU-Jack as a supported interface.
- Dropped dependencies: `mqtt-wildcard`, `nextport`, `hm-discover`, and a
  `promise.prototype.finally` polyfill.
- Split build into separate JS/HTML build steps; moved node help texts into
  a restructured `locales/` layout.
- Tooling churn: `nyc` → `c8` for coverage, bumped `xo`/`eslint`/`mocha`/
  `husky`/`node-red` devDependency versions, added `auto-changelog`.
- Added `MIGRATION.md`/contribution guidelines docs.

When a task here touches an area also changed upstream in that fork (e.g.
interface handling, build/lint tooling, locale structure), check what they
did before implementing from scratch — but confirm it still fits this
repo's Node-RED ≥ 1.0 / RedMatic compatibility constraints before porting.

## Conventions

- Code style is enforced by `xo` (ESLint-based) with 4-space indentation —
  see the `xo` config in `package.json`. Run `npm run lintonly` (or
  `npm run lintfix` to auto-fix) before considering JS changes done.
- Tests: `npm run testonly` runs mocha over `test/**/*_spec.js`. Full
  `npm test` also purges camo/nedb data, lints, and computes coverage —
  usually `testonly` + `lintonly` is enough during development.
- Husky pre-commit runs `lintonly`; pre-push runs `lintonly` + `testonly`.
  Keep changes passing both.
- Each node's `.js` and `.html` files must stay in sync — the `.html`
  defines the editor palette entry, config form, and help text; the `.js`
  registers the runtime node type with the same name.
- `nodes/ccu-switch.js`/`.html` and `paramsets-join.js` are excluded from
  `xo` linting (see `package.json`).

## Working here

- Do not hand-edit `paramsets.json`; if it needs updating, look at how
  `tools/paramsets-join.js` produces it.
- This addon is also shipped inside RedMatic (a Node-RED distribution for
  CCU3/RaspberryMatic) — avoid breaking changes to node config schemas
  without considering migration for existing flows.
- Minimum supported Node-RED version is 1.0 (see README.md); avoid relying
  on newer Node-RED APIs without checking compatibility.
