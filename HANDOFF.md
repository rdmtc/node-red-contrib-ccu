# Session handoff — 2026-09-04

Context for continuing on another machine. Delete this file once its
content is consumed (state that outlives the day belongs in ROADMAP.md).
Lab addresses and credentials are intentionally **not** in this file
(nor in the wiki or issues).

## State

- **4.0.0 released 2026-09-02** (npm latest, OIDC provenance, GitHub
  release). Master is at `4.1.0-dev.5`+, **CI fully green** (lint + Node
  22/24 × Node-RED 4/5).
- In the Unreleased (4.1.0) changelog: binrpc 4.2.0, B-14
  (LEVEL_2 → COMBINED_PARAMETER, unverified on hardware), paramsets
  fetch/join tooling. Phase 3: cast/topic/message/castSysvar extracted,
  43 unit tests (`npm run test:pure`).
- Issue tracker fully triaged; B-6/B-14 archived; roadmap is current.

## Decisions (2026-09-04)

- **The production CCU3 stays on firmware 3.87.6.** No update for the
  sake of the paramsets regeneration. The regen runs against it as-is;
  what matters is the set of _paired_ device types, and 3.87.6 already
  reports the current descriptions for those (verified for the heating
  group / eTRV in docs/paramsets.md §4).
- **Two lab systems exist** (set up for the RedMatic 9.0.0 work, see
  `../RedMatic/HANDOFF.md`): x86_64 OpenCCU 3.89.8 and an armv7l CCU3
  on original firmware 3.89.8, both running a RedMatic dev install with
  node-red-contrib-ccu 4.0.0. Use them for anything risky or
  destructive (firmware-3.89 behavior, install/update paths, B-14
  style hardware pokes if a suitable device gets paired there). They
  have few/no devices paired, so they **cannot replace the production
  dump** — at most they add the group-type (VirtualDevices) keys on
  3.89.8 and serve as a diff reference.

## Plan (blocks 4.1.0)

1. ~~Full paramsets regeneration~~ **done 2026-09-04** (4.1.0-dev.7):
   lab CCUs (3.89.8) joined first (+58 keys), then the production CCU
   (3.87.6, fetched read-only from WSL with `--delay 600`, ~25 min for
   962 keys: +547 new, 32 refreshed — BidCos-RF, BidCos-Wired, HmIP and
   the HmIP-HEATING 2.0.0 group). Rules for the production box, given by
   the user: read-only, slow request rate (it overloads easily), and its
   RPC callbacks only reach the Node-RED test box (firewall) — a live
   node-red-contrib-ccu connection against it must run there, never from
   WSL or a lab CCU. Procedure: docs/paramsets.md §3.
2. **B-14 hardware check** (with the user's OK — it physically moves a
   blind): on the Node-RED test box, write a slat value to the paired
   HmIP-FBL's virtual-receiver channel (`:4`) via a ccu-value node with
   datapoint LEVEL_2; the debug log should show `setValue LEVEL_2 <v> ->
COMBINED_PARAMETER L2=<pct>` and the slats should move. Deploy
   procedure below.
3. **Release 4.1.0**: CHANGELOG heading `## Unreleased (4.1.0)` →
   `## 4.1.0 (<date>)`, `npm pkg set version=4.1.0`, commit
   (`4.1.0: <short title>`), push, wait for CI green, `git tag v4.1.0 &&
git push origin v4.1.0` — release.yml publishes via OIDC and creates
   the GitHub release from the CHANGELOG.

## Infrastructure (this does not travel via git; addresses live outside the repo)

- **Node-RED test box** (Debian bookworm, Node 24, Node-RED 5.0.6, ssh as
  root with key auth): `systemctl {restart,status} node-red`,
  `journalctl -u node-red`, user dir `/root/.node-red`, nginx TLS in
  front with internal CA certs. Deploy: `npm pack` → scp tarball →
  `cd /root/.node-red && npm install /tmp/<tarball> && systemctl restart
node-red`. Verify: `curl -s http://localhost:1880/nodes -H "Accept:
application/json"`.
- **Production CCU3** (fw 3.87.6, stays there, other VLAN): read-only ssh
  as root works; XML-RPC 2001/2010/9292 answer client calls from WSL.
  Contrary to the earlier note it is _not_ HmIP-only: the 2026-09-04
  dump lists ~35 BidCos-RF, 3 BidCos-Wired and ~30 HmIP device types
  plus heating groups. Gotcha that cost hours: the CCU firewall must
  allow the CCU → Node-RED callback port, otherwise inits hang for
  minutes and metadata never arrives — only the Node-RED test box is
  allowed through.
- **Lab CCUs**: see Decisions above and `../RedMatic/HANDOFF.md`
  ("Building and testing locally") for the scripted-check recipes
  (Node-RED token via `POST /addons/red/auth/token`, CCU session via the
  JSON-API).
- **Firmware image** `ccu3-3.89.8.tgz` lives in a temp dir on the old
  Mac only — if needed again, re-download from the official CCU3
  firmware page. Its analysis is preserved in docs/paramsets.md.
- **gh CLI**: needs auth on the new machine (`gh auth login`,
  account hobbyquaker). Issue/PR comments are signed
  "Claude (Fable 5) … on behalf of @hobbyquaker" (German or English
  matching the issue).

## Waiting on externals (do not gate 4.1.0)

- Reporter dumps: #177 (BSL-V2), #144 (WRCD), #159 (CuxD) — for B-15 +
  paramsets; requested in the issues 2026-09-02.
- Retest answers: #111, #145, #146, #151 (close ~2026-12 if silent);
  #112, #117 (retest comments posted).
- Hardware confirmation for B-14 from reporters (#136/#154/#175).

## After 4.1.0 (queue)

1. Editor loader consolidation (Phase 3 §6.4 + §8.1 defect 3, shared
   `resources/` script for the 9 dialogs) — needs a user smoke test on
   the Node-RED test box afterwards.
2. Remaining Phase 3: split rpc/rega/queue out of ccu-connection.js,
   async/await as touched, i18n/help consolidation (#58).
3. 4.2.0 headline: B-2 dynamic config via msg (7 issues; #133 has the
   confirmed setValues config-mutation bug as the sharpest target).
