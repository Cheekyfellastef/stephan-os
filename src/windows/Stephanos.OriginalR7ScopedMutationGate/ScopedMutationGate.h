#pragma once
#include <fltKernel.h>

typedef struct _R7_MUTATION_GATE R7_MUTATION_GATE, *PR7_MUTATION_GATE;

typedef struct _R7_RECOVERY_BINDING {
    UCHAR AdoptedBindingDigest[32];
    GUID AttemptId;
} R7_RECOVERY_BINDING, *PR7_RECOVERY_BINDING;

/* The enclosing minifilter must reserve FILE and STREAM context slots for
 * this core and register these arrays. There is no DriverEntry, user port,
 * path selector, installer, signing endpoint or whole-estate claim here. */
extern const FLT_CONTEXT_REGISTRATION R7GateContexts[];
extern const FLT_OPERATION_REGISTRATION R7GateOperations[];

/* Lifecycle calls are serialized by the trusted kernel owner, outside its
 * I/O callbacks. The owner must keep the gate until its separate custody/
 * issuance obligations have stopped. A real kernel read handle is required;
 * serialized claims and caller-supplied paths cannot enroll an object.
 * The owner MUST supply ordinarily opened, share-tracked handles without
 * IO_IGNORE_SHARE_ACCESS_CHECK. FILE_OBJECT flags cannot prove provenance. */
_IRQL_requires_(PASSIVE_LEVEL)
NTSTATUS R7GateEnrollFile(
    _In_ PFLT_FILTER Filter, _In_ PFLT_INSTANCE Instance,
    _In_ HANDLE RetainedKernelReadHandle, _In_ ULONG MaximumStreams,
    _Outptr_result_nullonfailure_ PR7_MUTATION_GATE *Gate);

/* Named data streams on directories are included. The stream FO must report
 * a non-directory stream and match the same native file ID/file context;
 * passing the directory's own index FO is rejected. */
_IRQL_requires_(PASSIVE_LEVEL)
NTSTATUS R7GateEnrollStream(
    _Inout_ PR7_MUTATION_GATE Gate, _In_ HANDLE RetainedKernelReadHandle);

/* Trusted-owner native relative open. No request-supplied root/absolute path,
 * create disposition, access mask, share bypass, EAs or reparse traversal.
 * One existing immediate child is opened read-only and enrolled. The parent
 * must stay installed until every child retires. All tree lifecycle calls
 * are serialized together, including child enrollment and parent retirement.
 * LeafName and ExpectedNativeIdentity come from the owner's authenticated
 * native scope traversal. The actual opened ID is checked before enrollment;
 * this does not authenticate that traversal or establish namespace closure. */
_IRQL_requires_(PASSIVE_LEVEL)
NTSTATUS R7GateEnrollChild(
    _Inout_ PR7_MUTATION_GATE ParentDirectory,
    _In_ PCUNICODE_STRING LeafName,
    _In_ const FILE_ID_INFORMATION *ExpectedNativeIdentity,
    _In_ BOOLEAN Directory,
    _In_ ULONG MaximumStreams,
    _Outptr_result_nullonfailure_ PR7_MUTATION_GATE *Child);

/* Fixed per-object native security transaction, callable only by the trusted
 * kernel commissioning owner after independent policy/estate authorization.
 * This API is NOT that authorization. Do not use on shared ancestors/control
 * objects whose denial would affect unrelated work. MetadataHandle must be a
 * genuine admitted commissioner's READ_CONTROL|WRITE_DAC|WRITE_OWNER kernel
 * capability for this exact retained object. Read guards gain no write rights.
 * Source SIDs/custodian come from authenticated adopted configuration, not wire
 * input. Source principals must be a complete proven non-bypass estate.
 * RecoveryJournalHandle is a separately admitted preprovisioned EMPTY file
 * outside the source estate, on the same NTFS instance. It must grant read/
 * append/control/synchronize without overwrite/metadata/delete capability;
 * the trusted owner authenticates its protected store and unique attempt.
 * The core persists the ACTUAL original and intended descriptors, native IDs
 * and captured binding before any set. A caller checkpoint cannot replace it.
 * Before the first journal write, recovery ownership stays with Gate, even on
 * error; retirement refuses until explicit verified recovery. No auto rollback.
 * A journal record is recovery evidence, never custody or restart authority. */
_IRQL_requires_(PASSIVE_LEVEL)
NTSTATUS R7GateSealSourceDacl(_Inout_ PR7_MUTATION_GATE Gate,
    _In_ HANDLE CommissionerMetadataHandle, _In_ PSID TrustedCustodian,
    _In_ ULONG SourceCount, _In_reads_(SourceCount) PSID const *SourceSids,
    _In_ HANDLE RecoveryJournalHandle,
    _In_ const R7_RECOVERY_BINDING *TrustedRecoveryBinding);

/* Explicit trusted recovery only, before/after separately admitted custody
 * retirement as appropriate. Never invoke on a fault after lease release to
 * make an old writer writable. Failed restore keeps all recovery ownership. */
_IRQL_requires_(PASSIVE_LEVEL)
NTSTATUS R7GateRestoreSourceDacl(_Inout_ PR7_MUTATION_GATE Gate);

/* One native EMPTY observation for one independently identified RM root.
 * The read handle may share writes/deletes: it is an observation capability,
 * never a source guard. Unknown/failed/truncated/nonempty results refuse.
 * SUCCESS is NOT whole-estate TxF closure or readiness. The producer must
 * prove every relevant primary/secondary RM is covered, establish persistent
 * effective source barriers and old/in-flight capability closure FIRST, and
 * subsequently re-enumerate tree AND ADS against its retained sealed manifest.
 * Never disable TxF, abort an unrelated transaction or pause other applications. */
_IRQL_requires_(PASSIVE_LEVEL)
NTSTATUS R7GateObserveEmptyResourceManager(_In_ PR7_MUTATION_GATE Gate,
    _In_ HANDLE RetainedResourceManagerReadHandle,
    _In_ const FILE_ID_INFORMATION *ExpectedNativeRoot,
    _In_ const GUID *ExpectedResourceManagerId);

/* One-way operation policy change, NOT an ARM/readiness proof. A complete
 * producer must first close namespace/write creates, exclude writable FOs
 * and views/MDLs, perform real native flush/quiescence, and retain all streams.
 * Instance detach/teardown must revoke the enclosing issuance session first. */
_IRQL_requires_(PASSIVE_LEVEL)
NTSTATUS R7GateDenyPagingWrites(_Inout_ PR7_MUTATION_GATE Gate);

/* Sticky observation, never a readiness result. FALSE cannot prove that old
 * MDLs do not exist. TRUE invalidates any enclosing custody session; polling
 * alone cannot synchronize issuance with callbacks or instance teardown. */
_IRQL_requires_max_(APC_LEVEL)
BOOLEAN R7GateObservedMdlDrain(_In_ PR7_MUTATION_GATE Gate);

/* Explicit trusted-owner retirement, never automatic fault recovery.
 * Refuses while children remain; on refusal the gate is unchanged. */
_IRQL_requires_(PASSIVE_LEVEL)
NTSTATUS R7GateRetire(_Inout_ PR7_MUTATION_GATE Gate);
