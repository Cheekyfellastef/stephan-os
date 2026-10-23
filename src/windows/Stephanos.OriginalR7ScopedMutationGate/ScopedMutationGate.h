#pragma once
#include <fltKernel.h>

typedef struct _R7_MUTATION_GATE R7_MUTATION_GATE, *PR7_MUTATION_GATE;

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
 * Once a set is attempted, recovery ownership stays with Gate, even on error;
 * retirement refuses until explicit successful restore. No automatic rollback. */
_IRQL_requires_(PASSIVE_LEVEL)
NTSTATUS R7GateSealSourceDacl(_Inout_ PR7_MUTATION_GATE Gate,
    _In_ HANDLE CommissionerMetadataHandle, _In_ PSID TrustedCustodian,
    _In_ ULONG SourceCount, _In_reads_(SourceCount) PSID const *SourceSids);

/* Explicit trusted recovery only, before/after separately admitted custody
 * retirement as appropriate. Never invoke on a fault after lease release to
 * make an old writer writable. Failed restore keeps all recovery ownership. */
_IRQL_requires_(PASSIVE_LEVEL)
NTSTATUS R7GateRestoreSourceDacl(_Inout_ PR7_MUTATION_GATE Gate);

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
