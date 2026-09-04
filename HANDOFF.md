# Session handoff — 2026-09-04

Context for continuing on another machine. Delete this file once its
content is consumed (state that outlives the day belongs in ROADMAP.md).
Lab addresses and credentials are intentionally **not** in this file
(nor in the wiki or issues).

## State

- **4.0.0 released 2026-09-02, 4.1.0 released 2026-09-04** (npm latest
  = 4.1.0, OIDC provenance, GitHub releases). 4.1.0 = binrpc 4.2.0, B-14
  (LEVEL_2 → COMBINED_PARAMETER, unverified on hardware by decision),
  paramsets fetch/join tooling and the regenerated `paramsets.json`
  (+605 keys from the production CCU and two lab CCUs). Phase 3:
  cast/topic/message/castSysvar extracted, 43 unit tests
  (`npm run test:pure`, 71 on the B-16 branch).
- **4.2.0 released 2026-09-04** (tag v4.2.0, npm latest = 4.2.0): the
  ccu-homeassistant node (B-16, archived). Branch `b-16-homeassistant`
  merged with `--no-ff` and deleted. The lab CCUs run the equivalent
  `4.2.0-dev.1` build with the "B-16 Home Assistant" flow tabs; reporters
  of #136/#154/#175 were asked (2026-09-04) to confirm the LEVEL_2 fix
  on their hardware.
- Issue tracker fully triaged (second pass 2026-09-04, B-7 done): 36
  issues open, all annotated with their roadmap item; 5 closed that day;
  8 newly diagnosed defects recorded in ROADMAP §8.3 — the two cheapest
  are the unguarded RSSI conversion (#183) and the dropped sysvar
  re-poll (#166). B-6/B-14/B-16 archived; roadmap is current.

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
2. ~~B-14 hardware check~~ **skipped by user decision 2026-09-04** — no
   test on the production blind for now; the CHANGELOG says so and the
   reporters of #136/#154/#175 are asked for confirmation. The recipe
   (ccu-value node writing LEVEL_2 to the HmIP-FBL's `:4` channel on
   the Node-RED test box, log shows the COMBINED_PARAMETER remap) stays
   valid if it is ever wanted.
3. ~~Release 4.1.0~~ **done 2026-09-04** (tag v4.1.0, release.yml green,
   npm latest 4.1.0). Follow-up worth doing: comment on #136/#154/#175
   that 4.1.0 contains the LEVEL_2 fix and ask for confirmation on real
   hardware (needs the user's go — outward-facing).
4. **Release 4.2.0 = B-16** — editor smoke test done by the user
   2026-09-04 (ok), released the same day: branch merged into master
   with `--no-ff` (never rebase with `-X theirs` — it silently keeps the
   branch side of conflicting doc hunks, which bit twice today), CHANGELOG
   dated, version 4.2.0, tag v4.2.0. B-16 archived. B-2 is 4.3.0.

## B-16 branch `b-16-homeassistant` (2026-09-04, target 4.2.0)

- Implemented and committed on the branch (not pushed): ccu-homeassistant
  node + `lib/haroles.js` + `lib/hadiscovery.js` (ported from hm2mqtt.js;
  channel TYPE is the primary role key because only ~45 % of the shipped
  VALUES descriptions carry CONTROL hints), 24 unit tests, ccu-mqtt HA
  command words + empty-name
  topic fix, ccu-connection `deregister` fix and `type=devices` admin
  endpoint, README section, `examples/home-assistant.json`, CHANGELOG
  "Unreleased (4.2.0)". Details in ROADMAP B-16.
- Local `npm test`: lint + 71 pure tests green. The mocha integration
  suite cannot run on this WSL machine (hm-simulator's port 8181 →
  EADDRINUSE, identical on master) — push the branch and let CI run it.
- **Lab test done 2026-09-04** on the CCU3 lab box (branch build
  installed into RedMatic, `node-red-contrib-aedes` as broker inside
  Node-RED, flow tab "B-16 Home Assistant" left deployed there) against
  Home Assistant 2026.9.0 in docker on WSL: 3 wired devices discovered
  (232 entities, 47 enabled), switch round trip on/off, DRI16 event
  entities, removal on untick — all good after fixing three payload
  defects HA had rejected (see ROADMAP B-16). Scripts for the whole setup
  (install, deploy, HA onboarding, status via comms websocket) are in
  this session's scratchpad; the lab hand-over note lists the HA
  container and login.
- Second round on the OpenCCU lab box (branch build installed there too,
  flow tab "B-16 Home Assistant" with topic prefix `hm2/` and plain
  payloads, publishing to the CCU3 box's broker): HmIP-PDT light round
  trip with brightness verified, HmIP-WRC2 events discovered, no HA
  warnings.
- she (Smart Home Engine) as consumer: the user moved their she dev
  instance to the test broker, and both lab flows now publish there as
  well (second mqtt-broker config in each flow), so that instance's
  HA-discovery view lists the 5 lab devices (no orphaned/duplicate
  flags) — the quick check for future B-16 changes; a private she on the
  lab broker exists too. Details and addresses in the lab hand-over note.
- Still open: editor smoke test in a browser on a lab box (device table,
  ccu-mqtt select), a real key press (event entity), CI. Cover/climate
  payloads have no lab hardware — unit tests only.
- Merge after 4.1.0 is released (rebase onto master; the CHANGELOG has
  separate Unreleased sections, so this is trivial).

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
3. 4.3.0 headline (moved from 4.2.0, which is B-16): B-2 dynamic config
   via msg (7 issues; #133 has the confirmed setValues config-mutation
   bug as the sharpest target).
