# Phase 2 — compatibility release 4.0.0

**Completed 2026-09-02** — released as
[v4.0.0 on npm](https://www.npmjs.com/package/node-red-contrib-ccu)
(dist-tag latest, SLSA provenance via OIDC trusted publishing) and
[GitHub](https://github.com/rdmtc/node-red-contrib-ccu/releases/tag/v4.0.0),
the first release since v3.4.2 (Jan 2022). Shipped as
`4.0.0-dev.5` … `4.0.0-dev.10` on master; CI (Node 22/24 ×
Node-RED 4/5) green on the release commit.

Per user decision there was no homematic-forum announcement — the
release stands on its own; community adoption is welcome but not
pursued.

Item state at completion:

1. **done 2026-09-01 (dev.5), verified 2026-09-02** — Node-RED 4.x
   editor select-population bug fixed (§8.1) and confirmed in a real
   Node-RED 5.0.6 editor (node-red-dev smoke test): interface/channel/
   datapoint selects and autocomplete populate on first open. The
   cold-start empty-list case stays open for the Phase 3 loader
   consolidation.
2. **done 2026-09-01 (dev.1)** — engines `^20.19 || ^22.12 || >=24`
   (require(esm), tightened in dev.6), `node-red.version >=4.0.0`
   (D-1, D-13).
3. **done 2026-09-01 (dev.6)** — `homematic-xmlrpc` 2.0 +
   `homematic-rega` 2.0 (D-4): rega loaded via require(esm), call sites
   fed through promise→callback adapters, timestamps now epoch ms from
   the lib (the #96 uncertain marker is `ts === 0`), the `httpServer`
   reach-in remains only for binrpc. `request` and the xmlbuilder
   tarball are out of the runtime tree.
4. **done 2026-09-01 (dev.9)** — binrpc 3.3.2 published (with
   provenance, via binrpc's own new OIDC release workflow) and picked up
   here through the `^3.3.1` range: adds the missing socket error
   listener from
   [hobbyquaker/binrpc#10](https://github.com/hobbyquaker/binrpc/pull/10)
   (a late response after a timeout crashed the whole Node-RED process)
   plus a fix for the methodCall callback firing twice on failed
   connections. Addresses the #160 crash class (D-5).
5. **done 2026-09-01 (dev.7)** — CCU-Jack interface (D-14): port
   configurable (2121 / 2122 TLS), discovery probes it; closes #164.
6. **done 2026-09-01 (dev.8)** — undefined-payload guard from PR
   [#173](https://github.com/rdmtc/node-red-contrib-ccu/pull/173) (the
   guard only; the auto-subscribe half is a feature redesign, see B-2).
7. **done 2026-09-01 (dev.8)** — `examples/` with three importable
   flows (D-13).
8. Release via the new OIDC pipeline (D-10). Announce in the
   homematic-forum RedMatic subforum — the community patching RedMatic by
   hand is the audience, and coordination with the RedMatic revival
   (rdmtc/RedMatic ROADMAP) makes 4.0.0 the version it bundles.

Verification: 2026-09-02 smoke test on node-red-dev (Debian bookworm,
Node 24.20, Node-RED 5.0.6, nginx/TLS in front, real CCU3): all 15 node
sets registered, editor dialogs populate on first open, all interfaces
connect sub-second once the CCU→Node-RED callback firewall rule exists,
CCU reboot survived crash-free. Findings fed back: ccu-alexa help-block
fix, protocol logging, first-start log downgrades, B-11 (re-init
robustness) backlogged.
