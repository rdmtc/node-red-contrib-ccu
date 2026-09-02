# Session handoff — 2026-09-02

Context for continuing on another machine. Delete this file once its
content is consumed (state that outlives the day belongs in ROADMAP.md).

## State

- **4.0.0 released 2026-09-02** (npm latest, OIDC provenance, GitHub
  release). Master is at `4.1.0-dev.5`+, **CI fully green** (lint + Node
  22/24 × Node-RED 4/5).
- In the Unreleased (4.1.0) changelog: binrpc 4.2.0, B-14
  (LEVEL_2 → COMBINED_PARAMETER, unverified on hardware), paramsets
  fetch/join tooling. Phase 3: cast/topic/message/castSysvar extracted,
  43 unit tests (`npm run test:pure`).
- Issue tracker fully triaged; B-6/B-14 archived; roadmap is current.

## Plan for tomorrow (blocks 4.1.0)

1. **User updates the CCU** (homematic-ccu3.lan.raff.rocks, currently
   fw 3.87.6 → 3.89.x).
2. **Full paramsets regeneration**:
   ```
   node tools/paramsets-fetch.js --host homematic-ccu3.lan.raff.rocks --out /tmp/ccu_dump.json
   node tools/paramsets-join.js /tmp/ccu_dump.json
   node -e "JSON.parse(require('fs').readFileSync('paramsets.json'))"
   npm test
   ```
   Throttled ~200 ms/call, a few minutes; CCU gets overloaded easily —
   don't run anything else against it. Procedure details:
   docs/paramsets.md §3. Add a CHANGELOG entry ("device descriptions
   refreshed from CCU firmware 3.89.x") and note which new keys arrived
   (join prints added/changed counts).
3. **B-14 hardware check** (with the user's OK — it physically moves a
   blind): on node-red-dev, write a slat value to the paired HmIP-FBL's
   virtual-receiver channel (`:4`) via a ccu-value node with datapoint
   LEVEL_2; the debug log should show `setValue LEVEL_2 <v> ->
COMBINED_PARAMETER L2=<pct>` and the slats should move. Deploy
   procedure below.
4. **Release 4.1.0**: CHANGELOG heading `## Unreleased (4.1.0)` →
   `## 4.1.0 (<date>)`, `npm pkg set version=4.1.0`, commit
   (`4.1.0: <short title>`), push, wait for CI green, `git tag v4.1.0 &&
git push origin v4.1.0` — release.yml publishes via OIDC and creates
   the GitHub release from the CHANGELOG.

## Infrastructure (this does not travel via git)

- **Test box**: `ssh root@node-red-dev.lan.raff.rocks` (key auth).
  Debian bookworm, Node 24, Node-RED 5.0.6 (`systemctl
{restart,status} node-red`, `journalctl -u node-red`), user dir
  `/root/.node-red`, nginx TLS in front (internal step-ca certs).
  Deploy: `npm pack` → scp tarball → `cd /root/.node-red && npm install
/tmp/<tarball> && systemctl restart node-red`. Verify:
  `curl -s http://localhost:1880/nodes -H "Accept: application/json"`.
- **CCU**: homematic-ccu3.lan.raff.rocks (172.16.24.145), read-only ssh
  as root works. HmIP-only (no legacy BidCos devices paired). Gotcha
  that cost hours: the CCU firewall must allow the CCU → Node-RED
  callback port, otherwise inits hang for minutes and metadata never
  arrives.
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
   node-red-dev afterwards.
2. Remaining Phase 3: split rpc/rega/queue out of ccu-connection.js,
   async/await as touched, i18n/help consolidation (#58).
3. 4.2.0 headline: B-2 dynamic config via msg (7 issues; #133 has the
   confirmed setValues config-mutation bug as the sharpest target).
