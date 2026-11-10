# Isolated R7 native smoke test: source preparation only

The existing recovery decoder remains inspection-only. These scripts add a
concrete disposable Windows test setup for the retained-object native component.
Pull-request CI never starts a guest, accepts evaluation terms, signs or loads a driver.
The existing proof workflow runs an actual admission contract on pull requests;
its guest path is enabled only by explicit owner dispatch. Its
fixed host entrypoint independently authenticates an immutable fresh approval
for that exact actual hosted run and attempt1 before any guest mutation.
The existing native proof job builds an unsigned test package, runs refusal and
ownership fixtures, and retains only that package and its public digest pins.
It never uploads Windows media, disks, private certificates or credentials.

## Fixed inputs and execution boundary

`prepare-r7-isolated-windows-media.py` accepts the official Server2022 English
ISO, the pinned pycdlib1.22.0 wheel, and a new private output directory. It uses
no network, mount or global installation. It checks the full ISO SHA256
`3e4fa6d8507b554856fc9ca6079cc402df11a8b79344871669f0251535255325`,
selects index1 (ServerStandardEval, Server Core, x64, en-US,20348.587), and
extracts only install.wim. The exact4,340,202,461-byte WIM must hash to
`e073fe38d47d9832608ec4dff061cd5358f3924650dcd5c1b13456abc34eaac9`.
Parser wheel SHA256 is
`bfa0b3631345a14b2741fe088398b6b8dc2838442ea607fd07d027dcc67b9e94`.
These hashes bind bytes, not license acceptance or production authority.

A separately approved invocation of `invoke-r7-hosted-native-smoke.ps1` needs
that WIM path, a genuine successful exact-head CI package, and its genuine successful exact-head CI package. The fixed adapter derives
the package, unsigned driver and client SHA256 values from independently
verified artifact bytes and the authenticated owner approval. The adapter reads the actual GitHub Actions run/actor/attempt, merged original
PR and retained branch/head/tree, successful native proof and immutable artifact,
then uses the fixed bounded package reader. No caller-created pins file,
environment flag or standalone pure-projector result grants authority.

An owner-authenticated manual dispatch of the existing native proof workflow,
using the retained PR branch and successful native artifact ID, performs
read-only preparation and fixed media acquisition. It publishes a public
preparation artifact containing its actual run ID. The existing canonical
mailbox must then contain one fresh immutable owner approval fenced with
`stephanos-r7-isolated-native-lab-approval`, schema
`stephanos.r7-isolated-native-lab-approval.v1`, operation
`RUN_R7_DISPOSABLE_NATIVE_SMOKE`. It binds the actual run ID, attempt1, exact
source/tree, CI run/attempt/artifact and all package/component/media hashes, a
bounded expiry and explicit evaluation-terms acceptance. Unknown fields fail.
The source-defined active canonical mailbox is independently read from current
protected main; a rotation holds this old source. A second run or rerun cannot
reuse the approval. The fixed adapter rereads the actual comment before consuming
it locally once. It polls at most15minutes, then stops without a guest if consent
is absent. Preparation is never consent. The controller must post this approval
only within the human's explicit exact-operation authority.

There is no new scheduler, worker, mailbox or production authority database.
The existing workflow is the disposable test adapter. Native execution cannot
occur in pull-request CI, on self-hosted runners or on Battle Bridge.

## Bounded physical experiment

The script refuses ordinary local execution, Battle Bridge, non-hosted runners,
non-Windows2022 contexts, a rerun attempt, absent existing Hyper-V, and insufficient
capacity. These checks prevent accidents; environment variables and a hostname
are not authentication. Actual nested guest boot remains unproven until observed.
It never enables a host feature or changes outer-host boot/code-integrity policy.

It creates one uniquely named Generation2 VM under a new RUNNER_TEMP directory,
with2vCPU, fixed4GiB RAM, one64GiB dynamic OS VHDX, no network adapters, no
checkpoints, and no automatic startup. It verifies the actual file-backed RAW
disk is neither boot nor system before partitioning. DISM applies only the pinned
index1 WIM. BCDBoot always names the guest EFI partition with `/s`, avoiding an
outer NVRAM entry. Evaluation terms must be read and accepted in the separate
execution approval; unattended OOBE hides the page only within that approved
installation. Guest credentials are random, confined to the disposable disk and
in-memory credential object, and never included in public output.

PowerShell Direct addresses only the newly observed VM GUID. The guest-only
script requires its fixed computer name, random nonce, virtual hardware and no
hardware network adapter. It checks the approved component digests, generates a
non-exportable one-day guest test certificate, signs only R7NativeQualification.sys,
and enables test signing plus Driver Verifier for that image only. Secure Boot
is disabled only on this disposable guest. A real second guest boot must be
observed before testing. No production key or production trust root is created.

One2GiB guest-local VHD is attached. Only the single newly observed RAW,
file-backed, non-boot/non-system disk of that exact size may be formatted, with
NTFS label R7_NATIVE_TEST_ONLY. The minifilter uses a fixed lab-only altitude
385999.3123; a collision fails the experiment. This is not a production altitude
allocation. The fixed client runs once, without arguments. Success requires
status0, all511 stage bits, six causal pass and two causal denied callbacks,
testOnly=true, custodyProven=false, leaseChanged=false, and normal filter unload.
Driver Verifier must name the actually loaded image. This is a first native
smoke test, not full production qualification.

Host calls have finite deadlines. The110-minute experiment deadline starts
at the actual workflow creation time, leaving10minutes of the120-minute job
for cleanup; approval does not reset that budget. An unknown native call is never retried. The
VM is turned off and removed by its retained GUID after name/path checks, then
only the verified private directory may be removed. A remaining attachment or
reparse point refuses recursive cleanup. An incomplete cleanup is a failure,
not a disposal receipt; hosted-runner teardown remains the outer safety boundary.
Do not publish raw disks, dumps, unattended files or guest-private keys.

## Remaining production work

Namespace/ADS, paging/MDL, TxF, partial enrollment, allocation failure, callback
and unload races, protected-journal recovery and issuer revocation remain
unexercised. The real current-claim witness producer, continuous production
containment, isolated/enrolled independent signing authority and authenticated
post-quarantine per-goal reauthorization remain separate unfinished work. The
existing prospective consumer is already wired; adding fixture signatures or
another consumer would not close those gaps. The held original1574 claim is not
changed by any script here. Historical execution stays UNKNOWN.

Primary references: [official evaluation media](https://www.microsoft.com/en-us/evalcenter/download-windows-server-2022),
[PowerShell Direct](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/powershell-direct),
[BCDBoot /s behavior](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/bcdboot-command-line-options-techref-di),
[test-signing](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/test-signing-driver-packages),
[Driver Verifier](https://learn.microsoft.com/en-us/windows-hardware/drivers/devtest/driver-verifier).

The PR admission job must report its real executed contract tests as successful.
A skipped manual-only job is not neutral under the protected merge policy. The
regression exercises that unchanged validator: a real successful PR contract is
admitted, while the prior unrequested skipped smoke job remains blocked. All
preparation, download, approval consumption and guest/result steps require the
explicit owner-dispatch event; no PR event can execute them.
