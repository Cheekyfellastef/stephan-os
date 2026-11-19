# Starfield paired-source observation and fixed native build

This is the next source increment after the accepted native-output monitor capture. The capture established two native output resource candidates. It did not establish game-image capture, an immutable simulation update, GPU completion or headset presentation.

The new observer associates each retained source with its actual D3D12 resource identity, fresh command-list generations, source-specific transitions and render targets, known native draw scopes, and complete execution brackets. The portable recorder has no image-copy or submission authority. Observations can identify the missing capture condition; even a complete observation journal remains diagnostic.

## Existing owner and delivery route

The product remains under #1591 (Starfield VR), #1769 (operator test readiness) and #1595 (Battle Bridge VR research worker), with #2707 retaining the AER source programme. This change uses the retained `feature/starfield-native-monitor-splash-20261106` branch and the canonical Battle Bridge mailbox. It creates no scheduler, controller, service, remote shell or replacement launcher.

The historical `starfield-vr-1595-post-merge-proof-v1` task was limited to read-only proof. Its old grant is not a compiler grant. The new closed `BUILD_STARFIELD_VR_PAIRED_OBSERVER` operation is a separately reviewed build step within the same owners, authorized by the operator's request to build the machinery needed for the native Hybrid route. It does not load a DLL, launch a game, change a provider or replay a consumed capture.

## Private source reconstruction

`reconstruct_paired_observer.py` checks the exact original compile closure before creating a fresh directory. It uses symbolic function anchors to derive a private owner header locally, applies the bounded integration changes, and adds the reviewed generic overlays. Raw game instruction manifests, addresses, assembly, old binaries, journals and the original archive are not republished here.

The original package identity is SHA-256 `1ea602071f2452f0afc70de1b9a63e6e99ef765f9edccb160b1c8a8f9ffca951`. Original files and consumed monitor records remain immutable. The reviewed paired ledger retains SHA-256 `27473c981eeeb6584263241aa5d88c0e44131ad2850b8cbf524f0a06e4583452`; the existing legacy fixture is unchanged.

## Fixed build boundary

The operation accepts the existing mailbox envelope and expected protected-main head. It has no caller-selected recipe, executable, path, URL or command arguments. The adapter independently verifies the protected head and rehashes its Git commit, traversed tree objects and source blobs, with replace references and inherited Git configuration disabled.

The fixed Windows bootstrap authenticates the complete PSF Python 3.14.10 x64 embeddable package before executing Python. The runtime has one source-owned location, `C:\Program Files\Stephanos\BuildRuntimes\Python-3.14.10-amd64-v1`. The ordinary build operation only verifies and retains that existing runtime. It cannot install it, alter its permissions, repair it, elevate itself, or select an interpreter through installed Python registrations or inherited PATH.

The executable, interpreter DLL, standard-library ZIP, extension modules and import-path configuration are verified against the complete 37-member manifest, with no additional or missing entries accepted. Retained file and directory handles protect the admitted namespace through execution. The official archive is 12,619,664 bytes, SHA-256 `90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159`; its publisher provenance is recorded in the runtime manifest.

### Separate protected runtime installation

A separate, parameterless administrator installer provisions only that fixed runtime. Its bootstrap authenticates the reviewed module and manifest from an immutable repository commit before evaluating them. It does not elevate a mutable adjacent PowerShell file. The installer authenticates the fixed PSF archive and every member, creates the custom namespace with protected administrator/SYSTEM ownership and access control, and publishes the complete runtime by a no-replace rename. Ordinary users receive read/execute access. A pre-existing invalid target is refused rather than overwritten or reclaimed. No PATH, registry, default Python, game or provider setting is changed.

The administrator boundary is required by actual Windows evidence. In the earlier unprivileged design, an OWNER_RIGHTS-restricted directory creator received access mask `0x1300ab`, without the requested `WRITE_DAC` permission. Both ACL finalization and child creation beneath an already sealed directory were denied. The corrected native probe is recorded in [Windows run 43966191551](https://github.com/Cheekyfellastef/stephan-os/actions/runs/43966191551). The production design therefore places runtime creation inside the protected Program Files installation boundary; it does not weaken the namespace checks to make the build pass. Installation and ordinary read-only admission require separate Windows qualification, including a real restricted-token mutation-denial fixture.

The Python worker pins original and reconstructed source inputs, checks the existing gaming governor, and builds in a fresh experiment directory using the fixed VS2022 BuildTools recipe. Each native stage is created suspended in an owned Job before it can execute. The Job has no breakaway permission, a process-count bound, finite deadline, bounded output, retained parent identities and kill-on-close behavior. Positive Job accounting and root exit evidence are required before custody can be released. A timeout or parent exit is never itself proof that all descendants stopped.

Compiler logs and native process paths stay in the private experiment directory. Public receipts contain source identities, bounded result fields and artifact hashes. Changed inputs, uncertain process exclusion, incomplete output, an unresolved previous build or gaming preparation all refuse the operation. The helper does not reclaim an old lock or terminate an unrelated process. Artifact consumption requires the authenticated completed worker response; a private disk receipt alone cannot authorize it. Interrupted finalization and write failures remain held even when compiler outputs exist.

### Build-tool helper lifetime

The private build environment explicitly sets `VSCMD_SKIP_SENDTELEMETRY=1`
before the fixed `vcvars64.bat` setup. The installed VS2022 `VsDevCmd.bat`
otherwise launches a background PowerShell telemetry helper using `START /B`.
That helper is unrelated to compilation and can outlive the recipe root. The
setting is confined to this child environment; it changes no user or machine
preference, and inherited values or compiler hooks cannot override it.

A bounded actual Battle Bridge setup-only proof with this fixed environment
completed in 1,018 ms: root exit zero, native Job zero, output EOF, released
custody and no termination request. The installed setup-script hashes remained
unchanged. This proof starts no compiler, game or observation DLL; it does not
substitute for the complete protected native build.

The 18 November build `starfield3536-paired-observer-build-92579c79-v1` completed
all compiler/model/ABI self-test output and exited its root with code zero,
without a gaming cancellation. The owned Job still had a live descendant after
the existing one-second settling window, so it correctly rejected success and
terminated its remaining members. Native zero and released custody were then
proven. The original terminal remains failed and its artifacts are not admitted.
Its receipt did not identify that descendant, so the installed setup's detached
telemetry is an evidence-backed cause to test, not a retroactive success claim.

The repair removes that unnecessary helper at its source. The Job boundary,
settling interval, deadline, output drain, descendant-zero requirement and
kill-on-close protection are unchanged. A repeated live-descendant refusal is
reported as `NATIVE_BUILD_CHILD_EXIT_UNPROVEN`; unresolved custody still takes
precedence as `NATIVE_JOB_TERMINAL_UNPROVEN`. Compiler failure and child-exit
uncertainty must remain distinct. A fresh authenticated build is still required.

Reusable invariant: a build recipe's completion includes every child it starts.
Suppress optional detached setup work before execution instead of extending
timeouts, accepting root exit alone or consuming outputs from a failed receipt.

## Qualification and result boundaries

### Terminal ownership protocol

The reservation remains present from admission through native execution and the complete write, flush, fsync and close of a private terminal proposal. That proposal uses a different schema from a public build receipt, so even a proposed success cannot be consumed as authorization. A duplicated native file handle preserves the same reservation through closing its buffered data stream. Only a durable proposal, observed native Job zero and an unchanged original source permit deletion through that exact retained handle. The authenticated worker response is emitted after release; no terminal file is rewritten after successful release.

Any write, flush, fsync, close or release failure retains the same owner when exclusion is still held, and the public response remains held. A later request cannot reclaim that record. Fault fixtures cover persistent terminal I/O failures, stream-close failure, rejected native release and refusal of a second admission. This protocol separates a private proposal from final publication instead of treating a partially saved result as success.

Portable model tests, source reconstruction tests, real Windows Job and file-pin fixtures, independent Windows/security review, protected merge, current-head sync and a genuine Battle Bridge build receipt are distinct gates. The workflow exercises generic models and disposable process fixtures; it cannot compile the private Starfield integration without the original local workbench.

A successful build produces three model test executables, the native ABI/FLS self-test executable and the separate observation DLL. It grants no injection or headset readiness. A fresh reviewed loader/capture session and original-owner source review are still required before any installed-game experiment. The next renderer stages remain actual source-image copies with legal state and lifetime evidence, persistent per-eye histories, tracked poses, one-update stereo identity, FrameStore integration and OpenXR presentation.

## Qualified compiler-helper retirement

The fresh build at `4cd9b4e26d2c166f40bfd29816c6989bc84995a1` still
refused consumption as `NATIVE_BUILD_CHILD_EXIT_UNPROVEN`. Its compiler and
self-test output passed, its root exited zero, and the resource governor did
not cancel it. The build boundary stopped the remaining owned process and
proved zero before releasing custody. That failed receipt remains immutable.

A separate generic C++ compile, using the unchanged Job boundary and native
Job member enumeration, identified `vctip.exe` as the sole remaining process.
It also survived a 25-second idle observation. This is a different helper
from the optional developer-shell PowerShell telemetry disabled above.
Setup-only proof was insufficient to qualify the complete compiler lifecycle.

The structural correction separates three facts: workload completion,
qualified ancillary-helper retirement, and positive native process exclusion.
The ordinary one-second accounting interval and five-second drain remain
unchanged. Unknown descendants still fail. Only the existing private build
adapter can select the optional retirement profile; the mailbox accepts no
helper, path, hash, command, timeout or termination selector.

The profile pins the exact installed VS2022 MSVC `14.44.35207` x64
`vctip.exe`, SHA-256
`be4e7b09df1e23f386eb610b76ed45272b9fed03ab001ddf0b1d9675f8989437`,
through the existing `NativePins` file and ancestor exclusion. An unqualified
toolchain version or changed helper refuses before compilation. The retained
bytes are revalidated before launch and before retirement.

After the root has exited zero, retirement requires exactly one native Job
member, its retained live process handle, matching native image path, a birth
no earlier than the root, and positive membership in this exact non-inherited
Job. Membership and cumulative native process accounting are checked again.
The existing `TerminateJobObject` authority is then used on that Job alone;
there is no process-name kill, system-wide cleanup or unrelated process handle
with termination rights. A new cumulative process count during retirement
remains a failure even if the new member disappears before final observation.

Success still requires native Job zero, complete pipe output, retained parent
identity, uninterrupted gaming permission, the original finite deadline and
unchanged source. Failed root, changed or closed helper pin, unknown image,
extra member, query failure, cancellation, process-set growth, failed native
termination or incomplete drain cannot become success. The private native
receipt explicitly records the retirement request, helper identity and
cumulative process count; requested termination never itself proves exclusion.
The authenticated worker response remains the only artifact-consumption gate.

Actual generic compiler proof with this profile completed in 2,388 ms with
root exit zero, the qualified helper retirement recorded, native Job zero,
complete output and released custody. It executed no private Starfield source
or observation DLL. The affected Windows suites passed 71 tests with six
existing context-specific skips; real disposable descendants and adversarial
faults cover the refusal rules. A fresh protected-main Starfield build is
still required after independent review and deployment.

Reusable invariant: ancillary toolchain lifetime must be represented explicitly;
neither successful compiler output nor a process name establishes safe terminal
ownership. A future compiler/helper version requires fresh qualification.

## Private loader preparation for the next capture

The authenticated build at `db730e7f9a83e2f5a053b63e89163189acec9719`
passed the complete native build and self-tests, with positive Job zero,
complete output and released custody. Its five artifacts were independently
rehashed. [The terminal build receipt](https://github.com/Cheekyfellastef/stephan-os/issues/3258#issuecomment-6995753681)
admits the observer artifact, not a loader or installed-game experiment.

`reconstruct_paired_loader.py` is a pure offline preparation function. It
authenticates ten original private loader/dependency/manifest inputs and the
exact admitted observer bytes, then returns private candidate bytes and an
explicitly non-authoritative review packet. It neither reads/writes files nor
imports the private loader, opens a process, executes native code or changes
a session. Private game code and instruction manifests remain local.

The generated candidate has one paired-source probe and requires the exact
process creation FileTime. It snapshots and hashes all eight private manifests
before process access, uses those same bytes throughout admission, and checks
the extra draw hook, fourteen allocation spans and original render-target
provenance before remote allocation, writes or loading. Synthetic tests cover
source/artifact substitution, malformed manifests, changed live bytes,
out-of-bounds spans, duplicate anchors and hook collisions. The original
controller's retained input pins and fresh-session checks remain prerequisites
for any eventual execution; this offline function does not supply them.

Actual private preparation authenticated the original closure, parsed the new
loader and checked ordering of the three remote mutation calls without
executing it. The candidate loader is 26,084 bytes, SHA-256
`8bb4794f07a8a5bf3d7726f96e211035c2508fd0ec0bc82e81a42cabebff28fd`.
This identity needs independent private source review; it is not an approval.

The original monitor attempt is consumed. Its November 16 capture passed the
native-output analysis, but the saved outcome remains
`CAPTURE_PASSED_CLEANUP_OR_EXIT_PROVENANCE_INCOMPLETE`; the starter records game
exit and proxy restoration without proving the historical normal exit code.
Preserve these records and their verdict. The next step must extend the existing
Hybrid session owner with a reviewed successor and fresh current-state proof.
Deleting an old session, changing its outcome or merely replacing DLL hashes
cannot authorize another capture. No new launcher or capture route is enabled
by this preparation change.

Reusable invariant: artifact availability, private loader qualification,
one-attempt session admission and headset readiness are separate facts. A
successful native build never reopens a consumed experiment.

## Reuse for other games

The source verification, isolated build, owned-process boundary, paired observation model and typed readiness receipts are reusable machinery. Resource discovery, native draw scopes, simulation identity and engine history ownership belong to each game adapter. Future games should extend the existing provider/catalogue and splash contracts after their own renderer evidence exists. Adding a splash entry alone does not establish VR compatibility.
