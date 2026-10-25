# Worktree-aware canonical Git source proof

## Structural review before another repair

Goal #2961 retains maintenance cycle `0a23c41a-124f-4776-97e8-e45ab0309b0b`. At protected main `b15087f7d2e23a917227094a5b852b0f75a6411d`, the canonical source reader refuses `extensions.worktreeconfig=true`. The existing one-key repair intentionally requires no linked registrations. Native observation instead finds legitimate registered worktrees and three worktree configuration files containing only Codex advisory `localEnvironmentConfigPath=__none__`; the canonical main worktree has no config.worktree file. Neither worktree presence nor advisory metadata is evidence of an active conflicting writer. No worktree/config/lease has been removed or changed.

Repeated diagnostic/sole-worktree corrections have not established source admission on this machine. Stop adding registration exceptions. Review the execution-policy boundary first.

## Proposed invariant

Canonical authority-bearing Git commands must execute against the fixed canonical common .git directory and work tree, with a closed, enforced configuration policy. Their execution must not consume any worktree-specific configuration. The repository configuration and registrations remain unchanged for other checkouts and applications. A source observation does not release the maintenance hold or attest another writer's exclusion.

Extend the existing `resolveBattleBridgeGitExecution()` policy with a command-scoped `extensions.worktreeConfig=false` override in both fixed argv and minimal child environment. This is not a persistent Git configuration edit. Retain all existing hook/fsmonitor/filter/transport/replacement/graft/index/topology guards. The current source collector must present its actual resolved execution policy to configuration validation. Default validation without that proven policy must continue refusing the extension.

Permit exactly one syntactically valid boolean worktree-configuration declaration only when the concrete fixed executable, argument overrides and environment prove worktree configuration suppression. Duplicate/malformed declarations, unproven/mismatched execution policy, caller-supplied override attempts and every other rejected configuration category remain denied. Canonical origin count/value and all before/after source identity/config/index/topology checks remain mandatory. Do not convert unknown evidence to source authorization.

## Required adversarial evidence

- Real Git fixtures with extension enabled, registered linked worktrees, and hostile current or linked config.worktree files: commands using the fixed policy must observe only canonical common configuration and must not execute helpers, filters or alternate transports.
- Repository and worktree files remain byte-identical after observation; no registration, index, source lease, maintenance custody or service changes.
- Default configuration validation still refuses the extension; only the verified actual execution context admits its bounded declaration.
- Duplicate/malformed booleans, missing argv override, missing/contradictory environment override, foreign executable, noncanonical/multiple origins and other unsafe keys stay denied.
- Environment injection cannot re-enable worktree config. Source collector supplies the same concrete policy at both existing configuration boundaries; mid-observation source/config/index/topology changes remain denied.
- Native Windows readback must prove source admission using the exact protected installed head without deleting metadata or unsetting the repository option. Linux/Windows regressions and independent exact-head Windows/security review precede protected integration.

## Review questions

Does command-scoped suppression actually prevent loading config.worktree before any authority-bearing Git operation, on the installed Windows Git and supported hosted Git versions? If Git initializes this extension before the proposed command/environment overrides are applied, reject the design and require a different closed read boundary. Are any existing fixed-boundary callers dependent on per-worktree configuration such that this policy change would misrepresent source/index truth? What complete execution-context predicate is required before allowing the otherwise rejected declaration?

No implementation, source-admission waiver, global config change, worktree deletion, custody transition, merge, installation, service restart or PC restart is authorized by this design record. The normal frontend currently responds on4173; maintenance recovery remains incomplete.
