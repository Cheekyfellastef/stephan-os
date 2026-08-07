# Stephanos Forge Shadow Deployment Plan V1

Issue: #1671

## Purpose

This source slice defines the admission contract for the first isolated, read-only Forgejo shadow beside GitHub.

It is deliberately not an installer. It cannot start a service, pull an image, create a credential, register a runner, expose a listener, schedule a mirror, mutate a repository or publish a ref. A valid result produces only a bounded runtime request that still requires separate exact-head runtime authorization.

GitHub remains the canonical public ledger, final review boundary and merge authority.

The repository identity is fixed to exactly `Cheekyfellastef/stephan-os`; no alternate `owner/repo` value is admissible in either deployment planning or parity proof.

## Accepted boundary

The plan accepts one of three isolation classes:

- rootless container;
- unprivileged WSL2 boundary;
- unprivileged virtual machine.

The boundary must have:

- no host source mount;
- no host socket mount;
- no privileged mode;
- no caller-supplied path, command, executable, environment or secret;
- an opaque bounded boundary identity.

## Immutable service identity

The Forgejo component must be bound to an immutable `sha256:` image digest. Mutable tags such as `latest` cannot satisfy the plan.

The source contract does not choose or download an image. That remains a later bounded runtime operation with its own exact digest proof.

## Network posture

The read-only shadow is admitted only with:

- listener address `127.0.0.1`;
- loopback-only inbound access;
- outbound mode limited to GitHub fetch;
- public exposure disabled;
- Tailscale exposure disabled.

Any later private proxy or Tailscale route requires a separate source-controlled adapter and authorization. M2 does not inherit exposure authority from existing Battle Bridge services.

## Service posture

The service must remain in `read-only-shadow` mode with all of these disabled:

- signup;
- repository creation;
- Git push;
- Forgejo Actions;
- runner registration;
- webhooks;
- federation;
- package registry.

Internal database and repository storage are runtime implementation details, not source-write authority. The shadow may ingest public Git data only after the later runtime operation is authorized.

## Mirror posture

The mirror contract is exact and fetch-only:

- repository identity must equal the canonical GitHub repository;
- source head must equal the exact canonical `main` head;
- authentication mode is anonymous public read;
- automatic synchronization is disabled;
- push is disabled;
- force update is disabled;
- pruning is disabled.

This prevents M2 from becoming a second scheduler, writer or branch-deletion surface. A later bounded synchronization loop may be proposed only after the first manual parity and backup proof succeeds.

## Backup-before-start posture

A valid plan requires:

- a bounded opaque backup target identity;
- backup before first service start;
- a restore drill requirement;
- content-addressed backup evidence;
- retention between 3 and 30 snapshots.

The runtime may not be described as ready until the existing `stephanos.forge-shadow-parity.v1` contract proves exact object/tree parity and a current restorable backup.

## Shared Workspace truth

The later runtime operation must publish:

- `status/forge-shadow-runtime.json`
- `proofs/forge-shadow-parity.json`

The planner does not write those records. It only fixes their identities in the runtime request so a future publisher cannot invent alternate truth locations.

## Fixed phases

A valid plan emits six non-mutating phases:

1. exact repository, main-head and image-digest preflight;
2. isolated rootless boundary preparation;
3. backup and restore preflight;
4. loopback read-only service configuration;
5. fetch-only shadow configuration;
6. separate exact runtime authorization and parity proof.

Every phase declares `mutationAllowed: false` because this module is a planner, not an executor.

## Authority projection

The V1 plan grants zero authority for:

- source mutation;
- GitHub or Forge ref writes;
- force-push;
- branch deletion;
- merge;
- deployment;
- runtime mutation;
- runner registration;
- credential creation;
- public exposure;
- scheduler creation;
- arbitrary command execution;
- arbitrary filesystem access.

A ready plan always states `requiresSeparateRuntimeAuthorization: true` and carries null command, executable, environment and credential fields.

## Validation

`shared/agents/forgeShadowDeploymentPlanV1.test.mjs` covers:

- valid zero-authority planning;
- immutable image identity;
- rootless and unprivileged isolation;
- loopback-only networking;
- complete service write-surface disablement;
- exact anonymous fetch-only mirror identity;
- backup and restore prerequisites;
- fixed Shared Workspace records;
- rejection of unexpected command, path, environment and secret fields.

The existing shared-agent hosted regression workflow executes this test automatically.

## Next step

After this contract is merged and reviewed, a separate exact-head runtime slice may implement one fixed M2 installer for a single chosen isolation boundary. That operation must prove the immutable image digest, backup target, listener identity, exact Git object/tree parity and clean teardown before the shadow can be called installed or ready.
