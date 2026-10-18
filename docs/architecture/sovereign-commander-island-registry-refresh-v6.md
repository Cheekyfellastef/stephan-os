# Sovereign Commander v6, Rescue Island fixed registry refresh

Canonical owners: existing Rescue Island Goal #3109 and Sovereign Commander Goal #2573. No duplicate daemon, scheduler, lane or lease.

## Live fault and exact boundary

On 18 October 2026, [authenticated Battle Bridge fast-mailbox receipt #6243594048](https://github.com/Cheekyfellastef/stephan-os/issues/2808#issuecomment-6243594048) reported `ISLAND_NATIVE_FIXED_ACTION_NOT_REGISTERED` for the read-only `rescue-island-readonly-boundary` process. The registered fixed ID and `rescue-island-boundary-probe.mjs` are already on protected main in `shared/agents/sovereignCommanderV1.mjs`. The server imports the fixed registry when it starts, not on every request.

Post-sync refresh already classifies `shared/agents/sovereignCommanderV1.mjs` as a Commander runtime change, but the watchdog checks a *static generation string*. A healthy older process with the same prior generation can therefore survive a Git sync with an outdated fixed registry.

## Guarded version change

Advance **all** existing boot, post-sync, health, repair, watchdog, control-plane and test callers coherently from `2026-10-13-private-mcp-batch-metadata-v5` to `2026-10-18-island-registry-refresh-v6`. Advance the Windows runner's legacy default requirement from v4 to v6 so watchdogs do not ping-pong at boot. The existing independent post-sync refresh already invokes the runner with an exact required capability generation. A v5 server cannot satisfy v6, so the current guarded Windows watchdog may recycle only the known Commander server process and start the pinned current source. Do not add an arbitrary process or mutation route.

No new action ID is granted; the Island action was already allowlisted and is read-only, with no writer pickup, protected-merge authority, original R7 lease release, or separate seed/fleet ownership. This version bump is not evidence the daemon restarted. **Do not merge without qualified independent review of Windows service-lifecycle changes.**

## Acceptance after protected merge

- CI and security review at exact head, then accepted guarded merge;
- actual Battle Bridge post-sync receipt showing the v6 process version at current protected main, not an asserted source string;
- independently completed terminal read-only island action on the fixed registry, replacing `ISLAND_NATIVE_FIXED_ACTION_NOT_REGISTERED`;
- no gaming governor regression, no interference with original held `critical-2962-elastic-goal-r7-lease`.

A still-running process reporting v5 must remain a typed HOLD; do not bypass it or kill arbitrary processes.
