# Stephanos Ignition Cockpit Runbook

## Battle Bridge proof command

```bash
npm run stephanos:ignite
```

## Reading the cockpit

- **Green** means build passed, verify passed, the 4173 server is started, the served runtime marker matches the expected dist metadata, and module MIME probes passed. Only this state enables **Enter Stephanos**.
- **Blue** means ignition is actively working on a stage such as source update, build, verify, restart, or served proof.
- **Amber** means the server has started but final served-runtime proof is still pending or unavailable. Do not treat build/verify as browser proof; wait for marker and MIME proof or rerun the proof command.
- **Red** means a blocker exists. Follow the cockpit's exact next operator action before retrying.

## Stage/proof cards

- **Source update** shows whether local main was behind `origin/main`, the pull result, and before/after commits when available.
- **Build** shows running/passed/failed state plus runtime marker and git commit after build metadata exists.
- **Verify** shows running/passed/failed state from the canonical verify command.
- **Restart 4173** shows restart requested, server stopped/started, and health probe result.
- **Served runtime proof** shows served runtime marker match/mismatch and module MIME proof result.

## Local proof commands

```bash
npm run stephanos:ignite
node --test scripts/ignite-stephanos-local.test.mjs
node --test scripts/stephanos-ignition-preflight.test.mjs
node --test scripts/serve-stephanos-dist.test.mjs
node --test scripts/*ignition*.test.mjs
node --test shared/agents/ignition*.test.mjs
```

## Safety boundaries

Ignition must not use arbitrary shell beyond source-controlled ignition scripts, kill arbitrary processes, run `git reset --hard`, delete source, fake live proof, or treat build/verify success as served-browser proof.

## Restart contention and preflight failure

The 18 November 2026 restart failed before the supervisor started: the sync
preflight reported `BLOCKED_INSTALL_OR_PERMISSION_REQUIRED` without a source
head. The launcher then waited five minutes and replaced that cause with a
supervisor timeout. The retained 10 November supervisor denial was historical;
it does not establish this restart's inner cause.

The sync executor also uses that generic classification when another invocation
owns its lock. Ignition now waits at most 30 seconds and 30 polls only for the
complete nonowner `SYNC_ALREADY_RUNNING` refusal, then re-enters the existing
executor for fresh source and runtime-debt checks. It never removes that owner's
lock, treats elapsed time as success, or retries an uncertain mutation or an
actual permission failure. Existing runtime and Spatial obligations remain held.

Each launcher helper has unique stdout/stderr logs. After that helper exits, its
latest typed preflight refusal is shown even when Windows has not populated the
exit code. A successful retry supersedes an earlier refusal, but preflight
success alone cannot satisfy service, source, served-runtime or browser proof.
Only closed refusal codes reach the preflight projection; raw failure details
and other launches' logs cannot become current failure evidence.

Regression coverage: `scripts/windows-ignition-preflight-recovery.test.mjs`,
`scripts/battle-bridge-github-sync-and-refresh.test.mjs`, and
`scripts/battle-bridge-ignition-sync-preflight.test.mjs` exercise current/stale
failure identity, Windows exit-code timing, bounded contention, owner preservation
and retained runtime debt. A future normal boot still needs its own live receipt;
fixture success does not prove unattended reboot acceptance.

Desktop cockpit startup still attempts the launcher, AI Core and OpenClaw
windows. Only the canonical launcher and AI Core IDs participate in the final
retained browser observation and required-window receipt check. OpenClaw is
optional, matching the service supervisor contract; its unavailable service or
failed browser opening is reported separately and cannot block proven core
readiness. No caller optional flag may demote a Stephanos window. Earlier
OpenClaw window receipts remain historical, and its current window proof remains
explicitly unproven rather than borrowing the core windows' final proof.

## Actual desktop entry and scoped native holds

For this acceptance, the existing `Stephanos Local.lnk` must point to
`windows/Launch-Stephanos-Local.cmd`, whose default mode is `launcher-root` /
`cockpit`. Verify the installed link's target, fixed
`-Mode launcher-root -BootMode cockpit -Unattended` arguments and repository
working directory; opening a different helper is not proof that this entry
works. This existing unattended path defers optional native commissioning and
dialogs; it does not waive required process-owner or runtime qualification.
A front-end-only local wrapper does not request AI Core or OpenClaw.

The reviewed `scripts/windows/retarget-stephanos-local-shortcut.ps1` adapter
previews a change without writing or qualifying it. Applying it requires the
exact approved source head, current shortcut preimage hash and the existing
qualified installation route. It preserves the original link bytes and verifies
the saved link. It does not launch anything, change tasks, replace the local
wrapper or prove startup. Do not substitute a worktree path or another desktop
link when identity or source proof is unavailable.

Ordinary startup may report native commissioning held for Spatial and the
desktop plugin host while its own mandatory source and managed proofs pass.
The full canonical native debt remains held. Unpaid target, Governor, relay,
approval, unknown or unsafe obligations still block startup. Failure reporting
retains the full residual list and source cohort, rather than showing the first
optional blocker as the entire cause. A stale launch receipt is historical.

Cold acceptance observes services stopped under their existing qualified owner,
invokes this actual installed entry once, and verifies current served source
plus the front-end, AI Core and OpenClaw windows. No port/PID-only stop is
authorized. Report manual recovery after another press separately from
unattended recovery through the existing owner; each needs its own fresh
pickup and outcome receipt. Source tests, task presence and warm HTTP probes
are preparation evidence, not either live acceptance result.
