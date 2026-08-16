# Stephanos Forge Shadow M3 Fixed Proof Executors V1

Status: source-built, runtime-unproven

## Purpose

This slice supplies the fixed host executor missing between the M3 runtime plan and the M3 execution/receipt adapter. It does not authorize or claim a live runner installation. A successful runtime receipt is possible only after the complete source chain is merged, the canonical Windows checkout is synced to the exact merged main head, M2 is current and separately approved short-lived M3 authorization is presented.

## Fixed execution estate

The JavaScript adapter accepts only the already-validated call produced by `executeForgeShadowM3RunnerPlan`. It reruns no user-supplied command and derives the sole PowerShell entrypoint from the canonical checkout. Before and after execution it proves:

- branch `main`, exact head and exact tree;
- the committed executor-script blob equals the working file;
- the runtime-plan and artifact-set digests;
- the short-lived runtime authorization, execution surface and M3-only scope; and
- the exact Linux and Windows artifact digests.

The PowerShell executor operates the entire admitted estate once and returns one closed-world observation per fixed runner identity. Subsequent adapter calls read the matching observation from that immutable session receipt; they do not rerun the host lifecycle.

## Disposable Forge lifecycle

Canonical M2 remains sealed with Actions disabled. M3:

1. verifies the content-addressed M2 backup;
2. copies it into one fixed disposable volume;
3. starts a capability-free, no-new-privileges canary Forge on loopback port 3342 with Actions enabled only in that disposable service;
4. registers each runner at repository scope with an independently generated ephemeral secret held only in a short-lived token file;
5. dispatches the fixed canary once per exact runner class and identity;
6. runs each runner with the Forgejo 15 `one-job --url --uuid --token-url ... --wait` interface;
7. negatively reads back the repository runner list after every job, revokes the dispatch token and proves the revoked token no longer authenticates;
8. destroys every runner boundary, exchange, relay, firewall rule, canary container, volume and network; and
9. only then materializes observations and content-addressed proof references.

The exact-runner dispatch is necessary because the admitted Linux pool may contain three identities. A pooled workflow run could prove only whichever runner happened to receive the job; the fixed `runner_class` plus `runner_id` inputs make every observation attributable.

## Linux boundary

Linux runners execute in separate rootless Podman outer containers. Each outer boundary is read-only, capability-free, `no-new-privileges`, resource-limited, joined only to the internal canary network and receives no canonical checkout or container socket. Forgejo Runner's `host` label is therefore host-relative only to the disposable outer container, not to Windows or the Podman machine.

## Windows boundary

The Windows proof runner executes inside Windows Sandbox. The sandbox receives:

- a read-only input folder containing only the digest-proven runner binary and fixed bootstrap;
- one empty disposable writable exchange; and
- no canonical checkout, source tree, credentials or container socket.

After the sandbox reports its exact private address, the host creates a temporary port proxy and firewall rule limited to that address. The runner connects through that relay, executes one job, writes bounded completion evidence, and the owned sandbox process, relay, rule and exchange are destroyed.

## Receipt boundary

The fixed executor receipt is accepted only when:

- every runtime-plan runner identity appears exactly once;
- canonical M2's content-addressed backup digest is unchanged;
- every observation uses the canonical M3 observation schema;
- the canary Forge, private relay, registrations and workspaces are gone; and
- all future execution, source, ref, credential, secret, merge, deployment and arbitrary-command authority is false.

The receipt contains no registration secret, access token, filesystem path, executable, command or environment payload. A host failure throws a bounded blocker and cannot be converted into `FORGE_SHADOW_M3_RUNNER_READY`.

## External contract basis

- Forgejo 15 runner registration: repository scope and server-enforced ephemeral mode.
- Forgejo 15 runner security: ephemeral runners must use `forgejo-runner one-job`; unisolated host execution is unsafe.
- Microsoft Windows Sandbox configuration: read-only mapped inputs, a disposable mapped exchange and one fixed logon command.

References:

- <https://forgejo.org/docs/v15.0/admin/actions/registration/>
- <https://forgejo.org/docs/v15.0/admin/actions/security/>
- <https://forgejo.org/docs/v15.0/admin/actions/configuration/>
- <https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file>
