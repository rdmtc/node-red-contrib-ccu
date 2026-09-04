# Roadmap archive

Completed and closed roadmap items — one file per item, named after its
ID (e.g. `B-1.md`). Open items live in [../ROADMAP.md](../ROADMAP.md);
IDs are stable and never reused, so an archived item stays findable from
the roadmap's contents index (marked ✅ there, linking here).

## Contents

**Phases**

- [phase-2.md](phase-2.md) — Phase 2: compatibility release 4.0.0 ✅
  2026-09-02 (editor fix, rega/xmlrpc 2.0, binrpc 3.3.2, CCU-Jack,
  released to npm with OIDC provenance).
- [phase-1.md](phase-1.md) — Phase 1: tooling groundwork ✅ 2026-09-01
  (CI + OIDC release pipeline, ESLint 9 + Prettier, dependency pruning
  10 → 4, mocha 11 / test-helper 0.3.6 / c8, CHANGELOG bootstrap).

**Backlog items**

- [B-5.md](B-5.md) — ping toggle, value/age status lines, uncertain
  filter, trailing sysvar re-poll, RSSI guard ✅ 2026-09-04 (4.3.0;
  #44/#54/#52/#96/#166/#183/#124).
- [B-4.md](B-4.md) — local-CCU detection via a /proc/net/tcp listener
  probe instead of the lighttpd config grep that had stopped matching ✅
  2026-09-04 (4.3.0).
- [B-3.md](B-3.md) — ccu-mqtt fixes plus the `get` and `rpc` commands and
  the VALUE_LIST enum names ✅ 2026-09-04 (4.3.0; #115/#22/#167 and the
  §8.2 findings).
- [B-2.md](B-2.md) — dynamic node configuration via `msg.config` ✅
  2026-09-04 (4.3.0; #172/#71/#103/#80/#56/#148/#185/#133/#158).
- [B-14.md](B-14.md) — COMBINED_PARAMETER mapping for HmIP slat writes ✅
  2026-09-02 (#136/#154/#175, pending hardware confirmation).
- [B-6.md](B-6.md) — binrpc rewrite without abandoned deps ✅ 2026-09-02
  (delivered upstream as binrpc 4.1/4.2, picked up as ^4.2.0).

**Pre-roadmap history**

- [todo-history.md](todo-history.md) — items completed under the old
  TODO.md (3.x development era) before ROADMAP.md and its ID scheme
  existed.
