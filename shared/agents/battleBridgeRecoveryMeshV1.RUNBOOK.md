# Battle Bridge Recovery Mesh V1

## Invariant

Stephanos has five recovery entrances and exactly one recovery coordinator. The coordinator may inspect or start only the canonical watchdog, GitHub mailbox, backend and OpenClaw Gateway Scheduled Tasks. It cannot accept a command, path, URL, task name or executable from an ingress request.

The Mission Orchestrator Worker, GitHub mailbox, source-update lock and source-mutation lease remain the execution authorities. The recovery mesh only restores their availability.

## Recovery entrances

1. `LOCAL_WINDOWS_SUPERVISOR` — the hidden `Stephanos Battle Bridge Recovery Mesh` task runs at logon and every minute.
2. `GITHUB_MAILBOX` — the owner-authored, expiring `WAKE_BATTLE_BRIDGE_RECOVERY_MESH` command on issue #1507.
3. `TAILSCALE_CONTROL` — an authenticated Tailnet/SSH session invokes only `request-battle-bridge-recovery.ps1 -Route TAILSCALE_CONTROL` on the canonical Battle Bridge.
4. `OPENCLAW_WHATSAPP` — authenticated `/stephanos-ignite wake` invokes the fixed OpenClaw adapter.
5. `AUTHENTICATED_BREAK_GLASS` — issue a five-minute nonce, then confirm that exact nonce when every automatic route is unavailable.

Every entrance creates the same bounded ingress schema. Simultaneous requests are deduplicated or coalesced behind one lock and one two-minute recovery lease.

Each non-local adapter must also write a bounded authentication receipt. The coordinator reopens that receipt through a no-follow, single-link, identity-stable handle and checks its route, issuer, subject, upstream proof and expiry before accepting the request. GitHub evidence is additionally rebound to the canonical accepted mailbox receipt; Tailscale identity is derived from the active SSH connection and live Tailnet peer status; OpenClaw evidence can only be issued by the host-authenticated fixed command; and break glass is bound to the consumed nonce record.

## Install and rollback

Installation is source-controlled and exact-head gated through `INSTALL_BATTLE_BRIDGE_RECOVERY_MESH`. It registers one limited, hidden, `IgnoreNew` Scheduled Task and may start it immediately.

The hidden Windows launcher holds the OS named mutex `Local\StephanosBattleBridgeRecoveryMeshV1` for the complete Node coordinator lifetime. An abandoned mutex is the only production path allowed to reclaim a dead runner's fixed lock. The Node lock also carries a random ownership token and refuses to unlink a stale lock itself or release a lock owned by another process.

Rollback uses `uninstall-battle-bridge-recovery-mesh.ps1`. It removes only the coordinator task. It preserves the worker, mailbox, backend, OpenClaw, source checkout and Shared Workspace evidence.

## Break glass

Break glass is never automatic and never restarts the PC.

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\scripts\windows\request-battle-bridge-recovery.ps1 -IssueBreakGlassNonce
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\scripts\windows\request-battle-bridge-recovery.ps1 -Route AUTHENTICATED_BREAK_GLASS -ConfirmationNonce <exact-16-character-nonce>
```

The nonce is single-use and expires after five minutes. This action can only wake the canonical coordinator.
Nonce confirmation first creates a nonce-specific file with `CreateNew` and no sharing; concurrent confirmations therefore have exactly one winner before any request is queued.

## Acceptance

Source tests are necessary but do not prove the mesh live. `BATTLE_BRIDGE_RECOVERY_MESH_BULLETPROOF` requires real Windows evidence that:

- all five routes independently produced identity-bound receipts from five distinct failure domains;
- concurrent route requests produced one coordinator lease and no duplicate worker or mailbox execution;
- killing the worker was detected and recovered by the existing watchdog;
- stopping the mailbox task was detected and recovered, then the previously queued request was claimed exactly once;
- backend and OpenClaw Gateway loss were recovered only through their fixed canonical tasks;
- stale, forged, symlinked, hard-linked and oversized ingress files were rejected;
- a stale coordinator lock was recovered only after its owner was proven dead;
- rollback removed only the mesh task;
- no visible PowerShell window, arbitrary shell, source mutation, merge, credential read/export or PC restart occurred.

Until all five independent route receipts pass, status must remain `DEGRADED` or `UNAVAILABLE`; source completeness must never be reported as live Windows proof.
