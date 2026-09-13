# Remote Codex Battle Bridge Recovery Accelerator V1

Issue: #1822
Umbrella recovery goal: #1814
Provider-routing foundations: #1351, #1293, #1574, #1637

## Purpose

Treat Remote Codex as an opportunistic high-capability Battle Bridge recovery specialist whenever fresh Codex capacity and a verified exact-head Windows attachment are both available, while preserving the same recovery mission when Codex capacity is absent.

Remote Codex is additional capacity, not a recovery root of trust and not a prerequisite for Stephanos continuity.

## Reused machinery

This slice composes existing source contracts only:

- Codex Capacity Governor V1;
- Meter-Aware Codex Dispatcher;
- Execution Surface Routing Policy V1;
- Remote Codex Battle Bridge Handoff V1;
- existing `dispatch_codex_task` / status / result tools;
- existing exact-head/operator-approval/attachment receipts.

It creates no dispatcher, queue, mailbox, worker, recovery plane, truth store or Windows executor.

## Routing doctrine

```text
bounded source repair
  -> CHATGPT_GITHUB_FIRST

Windows recovery specialist task
  + CODEX_DISPATCH_ALLOWED
  + exact approved handoff
  + fresh exact-head Windows attachment
  -> REMOTE_CODEX_BATTLE_BRIDGE

Windows recovery specialist task
  + meter unavailable OR attachment invalid/stale
  -> preserve same mission/task
  -> OPENCLAW_OR_LIFEBOAT / another qualified route
```

Restored Codex capacity may re-enter the provider pool on a later routing evaluation. It never creates a replacement mission or duplicate task merely because it became available again.

## Qualified task classes

The policy distinguishes:

- `SOURCE_REPAIR`
- `WINDOWS_RUNTIME_DIAGNOSIS`
- `WINDOWS_RUNTIME_PROOF`
- `RECOVERY_COORDINATION`

`SOURCE_REPAIR` remains GitHub-first in this slice. The other classes are eligible for Remote Codex only when the existing capacity and Windows attachment contracts both pass.

## Authority boundary

The routing result itself grants no execution authority. A Remote Codex route remains bound to the existing handoff and attachment rules:

- explicit operator-approved handoff receipt;
- exact repository/head proof;
- bounded task and proof commands;
- fresh Windows attachment heartbeat;
- exact dispatch tool inventory;
- no GitHub `@codex` or default Linux substitution for Windows proof;
- no duplicate dispatch;
- no generic shell;
- no source mutation authority from the handoff;
- no destructive Git;
- no merge or deployment;
- no credential access;
- no PC restart.

A later authority-bearing dispatcher must still produce canonical accepted/started/heartbeat/terminal receipts before Stephanos may report active or completed work.

## Any-qualified-route continuity

This slice is one member of the broader #1814 continuity doctrine. Stephanos should use every currently healthy qualified route that adds safe capacity, including GitHub-hosted machinery, Remote Codex, OpenClaw, the independent A/B lifeboat, Tailnet and future qualified providers, while serializing mutation per real shared resource.

Provider availability changes route eligibility, not mission identity, operator intent or completion truth.

## Acceptance

Deterministic tests must prove:

1. ordinary source repair remains GitHub-first even with Codex capacity;
2. fresh Codex capacity plus an exact Windows attachment admits Remote Codex;
3. an empty meter routes the same mission to OpenClaw/lifeboat rather than blocking it;
4. a stale attachment cannot consume available Codex capacity;
5. exact-head attachment mismatch fails over;
6. restored capacity returns Remote Codex to the pool without changing mission/task identity;
7. caller-shaped availability booleans cannot grant authority;
8. all general mutation/merge/deployment/credential/PC-restart authority remains false.

This is source routing/qualification only. It does not dispatch Codex, touch Windows, execute recovery, merge, deploy or restart anything.
