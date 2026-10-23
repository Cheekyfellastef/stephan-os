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

_IRQL_requires_(PASSIVE_LEVEL)
NTSTATUS R7GateEnrollStream(
    _Inout_ PR7_MUTATION_GATE Gate, _In_ HANDLE RetainedKernelReadHandle);

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

/* Explicit trusted-owner retirement, never automatic fault recovery. */
_IRQL_requires_(PASSIVE_LEVEL)
VOID R7GateRetire(_Inout_ PR7_MUTATION_GATE Gate);
