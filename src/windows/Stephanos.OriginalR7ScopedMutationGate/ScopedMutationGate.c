#include "ScopedMutationGate.h"
#include "OperationPolicy.h"

#define R7_POOL_TAG 0x37474d52u
#define R7_CONTEXT_SIGNATURE 0x37435458u
#define R7_MAX_STREAMS 4096u

typedef struct _R7_GATE_CONTEXT {
    ULONG Signature;
    PR7_MUTATION_GATE Gate;
    PFILE_OBJECT RetainedProtocolObject;
} R7_GATE_CONTEXT, *PR7_GATE_CONTEXT;

typedef struct _R7_STREAM_NODE {
    LIST_ENTRY Entry;
    PR7_GATE_CONTEXT Context;
    HANDLE KernelReadHandle;
} R7_STREAM_NODE, *PR7_STREAM_NODE;

struct _R7_MUTATION_GATE {
    volatile LONG References;
    volatile LONG Retiring;
    volatile LONG DenyPaging;
    volatile LONG UnexpectedMdlDrain;
    EX_RUNDOWN_REF Operations;
    PFLT_FILTER Filter;
    PFLT_INSTANCE Instance;
    FILE_ID_INFORMATION Identity;
    BOOLEAN Directory;
    ULONG MaximumStreams;
    ULONG StreamCount;
    PR7_GATE_CONTEXT FileContext;
    HANDLE KernelReadHandle;
    LIST_ENTRY Streams;
};

C_ASSERT(IRP_MJ_WRITE == R7GateWrite);
C_ASSERT(IRP_MJ_SET_INFORMATION == R7GateSetInformation);
C_ASSERT(IRP_MJ_SET_EA == R7GateSetEa);
C_ASSERT(IRP_MJ_FILE_SYSTEM_CONTROL == R7GateFileSystemControl);
C_ASSERT(IRP_MJ_SET_SECURITY == R7GateSetSecurity);
C_ASSERT(FilePositionInformation == 14);
C_ASSERT(IRP_MJ_PREPARE_MDL_WRITE == R7GatePrepareMdlWrite);
C_ASSERT(IRP_MJ_MDL_WRITE_COMPLETE == R7GateMdlWriteComplete);
C_ASSERT(IRP_MN_MDL == 2 && IRP_MN_COMPLETE == 4 && IRP_MN_DPC == 1);

static VOID R7Reference(PR7_MUTATION_GATE gate)
{
    InterlockedIncrement(&gate->References);
}

static VOID R7Dereference(PR7_MUTATION_GATE gate)
{
    if (InterlockedDecrement(&gate->References) == 0) {
        FltObjectDereference(gate->Instance);
        FltObjectDereference(gate->Filter);
        ExFreePoolWithTag(gate, R7_POOL_TAG);
    }
}

static VOID FLTAPI R7Cleanup(PFLT_CONTEXT value, FLT_CONTEXT_TYPE type)
{
    PR7_GATE_CONTEXT context = value;
    UNREFERENCED_PARAMETER(type);
    if (context->Signature == R7_CONTEXT_SIGNATURE) {
        ObDereferenceObject(context->RetainedProtocolObject);
        R7Dereference(context->Gate);
    }
}

const FLT_CONTEXT_REGISTRATION R7GateContexts[] = {
    { FLT_FILE_CONTEXT, 0, R7Cleanup, sizeof(R7_GATE_CONTEXT), R7_POOL_TAG },
    { FLT_STREAM_CONTEXT, 0, R7Cleanup, sizeof(R7_GATE_CONTEXT), R7_POOL_TAG },
    { FLT_CONTEXT_END }
};

static NTSTATUS R7AllocateContext(PR7_MUTATION_GATE gate,
    FLT_CONTEXT_TYPE type, PFILE_OBJECT file, PR7_GATE_CONTEXT *result)
{
    NTSTATUS status;
    PR7_GATE_CONTEXT context = NULL;
    *result = NULL;
    status = FltAllocateContext(gate->Filter, type, sizeof(*context),
        NonPagedPoolNx, (PFLT_CONTEXT *)&context);
    if (!NT_SUCCESS(status)) return status;
    RtlZeroMemory(context, sizeof(*context));
    R7Reference(gate);
    ObReferenceObject(file);
    context->Gate = gate;
    context->RetainedProtocolObject = file;
    context->Signature = R7_CONTEXT_SIGNATURE;
    *result = context;
    return STATUS_SUCCESS;
}

/* A FILE_OBJECT reference alone does not prevent IRP_MJ_CLEANUP when the
 * last HANDLE closes. Keep our own real kernel handle for the entire gate.
 * No caller handle is closed, no rights are added, no user handle is admitted. */
static NTSTATUS R7DuplicateReadHandle(HANDLE source, PHANDLE duplicate,
    PFILE_OBJECT *file)
{
    NTSTATUS status;
    PUBLIC_OBJECT_BASIC_INFORMATION information;
    ULONG returned = 0;
    const ACCESS_MASK required = FILE_READ_DATA;
    const ACCESS_MASK forbidden = FILE_WRITE_DATA | FILE_APPEND_DATA
        | FILE_WRITE_EA | FILE_WRITE_ATTRIBUTES | FILE_DELETE_CHILD | DELETE
        | WRITE_DAC | WRITE_OWNER | ACCESS_SYSTEM_SECURITY;
    *duplicate = NULL; *file = NULL;
    if (KeGetCurrentIrql() != PASSIVE_LEVEL || ExGetPreviousMode() != KernelMode
        || !ObIsKernelHandle(source)) return STATUS_INVALID_PARAMETER;
    status = ZwDuplicateObject(NtCurrentProcess(), source, NtCurrentProcess(),
        duplicate, 0, OBJ_KERNEL_HANDLE, DUPLICATE_SAME_ACCESS);
    if (!NT_SUCCESS(status)) return status;
    status = ObReferenceObjectByHandle(*duplicate, 0,
        *IoFileObjectType, KernelMode, (PVOID *)file, NULL);
    if (NT_SUCCESS(status)) {
        RtlZeroMemory(&information, sizeof(information));
        status = ZwQueryObject(*duplicate, ObjectBasicInformation,
            &information, sizeof(information), &returned);
        if (NT_SUCCESS(status) && returned != sizeof(information))
            status = STATUS_INFO_LENGTH_MISMATCH;
        /* KernelMode skips DesiredAccess checking. Inspect actual grants
         * through the documented query, not HandleInformation (reserved). */
        if (NT_SUCCESS(status)
            && ((information.GrantedAccess & required) != required
                || (information.GrantedAccess & forbidden) != 0))
            status = STATUS_ACCESS_DENIED;
    }
    if (!NT_SUCCESS(status)) {
        if (*file != NULL) { ObDereferenceObject(*file); *file = NULL; }
        ZwClose(*duplicate); *duplicate = NULL;
    }
    return status;
}

/* No path query, token alteration or I/O-share-check bypass. These facts
 * describe one real retained ordinary tracked read FO, not its provenance. */
static NTSTATUS R7Inspect(PFLT_FILTER filter, PFLT_INSTANCE instance, PFILE_OBJECT file,
    PFILE_ID_INFORMATION identity, PBOOLEAN directory)
{
    NTSTATUS status;
    FLT_FILESYSTEM_TYPE filesystem;
    FILE_STANDARD_INFORMATION standard;
    FILE_ATTRIBUTE_TAG_INFORMATION attributes;
    PFLT_VOLUME instanceVolume = NULL, fileVolume = NULL;
    ULONG returned = 0;
    if (KeGetCurrentIrql() != PASSIVE_LEVEL || KeAreAllApcsDisabled()
        || IoGetTopLevelIrp() != NULL || file == NULL
        || !file->ReadAccess || file->WriteAccess || file->DeleteAccess
        || file->SharedWrite || file->SharedDelete
        || FlagOn(file->Flags, FO_VOLUME_OPEN | FO_STREAM_FILE))
        return STATUS_INVALID_PARAMETER;
    status = FltGetVolumeFromInstance(instance, &instanceVolume);
    if (!NT_SUCCESS(status)) return status;
    status = FltGetVolumeFromFileObject(filter, file, &fileVolume);
    if (NT_SUCCESS(status) && fileVolume != instanceVolume)
        status = STATUS_WRONG_VOLUME;
    if (fileVolume != NULL) FltObjectDereference(fileVolume);
    FltObjectDereference(instanceVolume);
    if (!NT_SUCCESS(status)) return status;
    status = FltGetFileSystemType(instance, &filesystem);
    if (!NT_SUCCESS(status)) return status;
    if (filesystem != FLT_FSTYPE_NTFS || !FltSupportsFileContexts(file))
        return STATUS_NOT_SUPPORTED;
    status = FltQueryInformationFile(instance, file, &standard,
        sizeof(standard), FileStandardInformation, &returned);
    if (!NT_SUCCESS(status)) return status;
    if (returned != sizeof(standard) || standard.DeletePending
        || standard.NumberOfLinks != 1) return STATUS_NOT_SUPPORTED;
    status = FltQueryInformationFile(instance, file, &attributes,
        sizeof(attributes), FileAttributeTagInformation, &returned);
    if (!NT_SUCCESS(status)) return status;
    if (returned != sizeof(attributes)
        || FlagOn(attributes.FileAttributes, FILE_ATTRIBUTE_REPARSE_POINT))
        return STATUS_NOT_SUPPORTED;
    status = FltQueryInformationFile(instance, file, identity,
        sizeof(*identity), FileIdInformation, &returned);
    if (!NT_SUCCESS(status)) return status;
    if (returned != sizeof(*identity)) return STATUS_INFO_LENGTH_MISMATCH;
    *directory = standard.Directory;
    return STATUS_SUCCESS;
}

NTSTATUS R7GateEnrollFile(PFLT_FILTER filter, PFLT_INSTANCE instance,
    HANDLE readHandle, ULONG maximumStreams, PR7_MUTATION_GATE *result)
{
    NTSTATUS status;
    PR7_MUTATION_GATE gate;
    PR7_GATE_CONTEXT context = NULL;
    FILE_ID_INFORMATION identity;
    BOOLEAN directory = FALSE;
    HANDLE duplicate = NULL;
    PFILE_OBJECT file = NULL;
    if (result == NULL) return STATUS_INVALID_PARAMETER;
    *result = NULL;
    if (filter == NULL || instance == NULL || maximumStreams == 0
        || maximumStreams > R7_MAX_STREAMS) return STATUS_INVALID_PARAMETER;
    status = R7DuplicateReadHandle(readHandle, &duplicate, &file);
    if (!NT_SUCCESS(status)) return status;
    status = R7Inspect(filter, instance, file, &identity, &directory);
    if (!NT_SUCCESS(status)) goto FailHandle;
    status = FltObjectReference(filter);
    if (!NT_SUCCESS(status)) goto FailHandle;
    status = FltObjectReference(instance);
    if (!NT_SUCCESS(status)) { FltObjectDereference(filter); goto FailHandle; }
    gate = ExAllocatePool2(POOL_FLAG_NON_PAGED, sizeof(*gate), R7_POOL_TAG);
    if (gate == NULL) {
        FltObjectDereference(instance); FltObjectDereference(filter);
        status = STATUS_INSUFFICIENT_RESOURCES; goto FailHandle;
    }
    gate->References = 1;
    gate->Filter = filter;
    gate->Instance = instance;
    gate->Identity = identity;
    gate->Directory = directory;
    gate->MaximumStreams = maximumStreams;
    InitializeListHead(&gate->Streams);
    ExInitializeRundownProtection(&gate->Operations);
    status = R7AllocateContext(gate, FLT_FILE_CONTEXT, file, &context);
    if (NT_SUCCESS(status)) {
        /* Never replace another retained object's ownership. */
        status = FltSetFileContext(instance, file,
            FLT_SET_CONTEXT_KEEP_IF_EXISTS, context, NULL);
    }
    if (!NT_SUCCESS(status)) {
        if (context != NULL) FltReleaseContext(context);
        R7Dereference(gate);
        goto FailHandle;
    }
    gate->FileContext = context; /* Retain allocation reference until retire. */
    gate->KernelReadHandle = duplicate;
    ObDereferenceObject(file);
    *result = gate;
    return STATUS_SUCCESS;
FailHandle:
    ObDereferenceObject(file);
    ZwClose(duplicate);
    return status;
}

NTSTATUS R7GateEnrollStream(PR7_MUTATION_GATE gate, HANDLE readHandle)
{
    NTSTATUS status;
    FILE_ID_INFORMATION identity;
    BOOLEAN directory = FALSE;
    PR7_GATE_CONTEXT context = NULL, actualFileContext = NULL;
    PR7_STREAM_NODE node;
    HANDLE duplicate = NULL;
    PFILE_OBJECT file = NULL;
    if (gate == NULL || gate->Retiring || gate->DenyPaging
        || gate->Directory || gate->StreamCount >= gate->MaximumStreams)
        return STATUS_INVALID_DEVICE_STATE;
    status = R7DuplicateReadHandle(readHandle, &duplicate, &file);
    if (!NT_SUCCESS(status)) return status;
    status = R7Inspect(gate->Filter, gate->Instance, file, &identity, &directory);
    if (!NT_SUCCESS(status)) goto FailHandle;
    if (directory || !FltSupportsStreamContexts(file)
        || !RtlEqualMemory(&identity, &gate->Identity, sizeof(identity)))
        { status = STATUS_NOT_SUPPORTED; goto FailHandle; }
    status = FltGetFileContext(gate->Instance, file,
        (PFLT_CONTEXT *)&actualFileContext);
    if (!NT_SUCCESS(status)) goto FailHandle;
    if (actualFileContext != gate->FileContext) status = STATUS_OBJECT_TYPE_MISMATCH;
    FltReleaseContext(actualFileContext);
    if (!NT_SUCCESS(status)) goto FailHandle;
    node = ExAllocatePool2(POOL_FLAG_NON_PAGED, sizeof(*node), R7_POOL_TAG);
    if (node == NULL) { status = STATUS_INSUFFICIENT_RESOURCES; goto FailHandle; }
    status = R7AllocateContext(gate, FLT_STREAM_CONTEXT, file, &context);
    if (NT_SUCCESS(status)) status = FltSetStreamContext(gate->Instance, file,
        FLT_SET_CONTEXT_KEEP_IF_EXISTS, context, NULL);
    if (!NT_SUCCESS(status)) {
        if (context != NULL) FltReleaseContext(context);
        ExFreePoolWithTag(node, R7_POOL_TAG);
        goto FailHandle; /* Existing enrollment and denial remain intact. */
    }
    node->Context = context;
    node->KernelReadHandle = duplicate;
    InsertTailList(&gate->Streams, &node->Entry);
    gate->StreamCount++;
    ObDereferenceObject(file);
    return STATUS_SUCCESS;
FailHandle:
    ObDereferenceObject(file);
    ZwClose(duplicate);
    return status;
}

NTSTATUS R7GateDenyPagingWrites(PR7_MUTATION_GATE gate)
{
    if (KeGetCurrentIrql() != PASSIVE_LEVEL || gate == NULL || gate->Retiring
        || (!gate->Directory && gate->StreamCount == 0))
        return STATUS_INVALID_DEVICE_STATE;
    if (InterlockedCompareExchange(&gate->UnexpectedMdlDrain, 0, 0) != 0)
        return STATUS_INVALID_DEVICE_STATE;
    /* Actual operation denial only. No invented native-readiness result. */
    InterlockedExchange(&gate->DenyPaging, 1);
    return STATUS_SUCCESS;
}

BOOLEAN R7GateObservedMdlDrain(PR7_MUTATION_GATE gate)
{
    return InterlockedCompareExchange(&gate->UnexpectedMdlDrain, 0, 0) != 0;
}

VOID R7GateRetire(PR7_MUTATION_GATE gate)
{
    PLIST_ENTRY entry;
    NT_ASSERT(KeGetCurrentIrql() == PASSIVE_LEVEL);
    /* Owner-serialized, exactly once, outside callbacks. Rundown protects
     * OUR active callbacks, not pre-attach I/O or source-estate quiescence. */
    InterlockedExchange(&gate->Retiring, 1);
    ExWaitForRundownProtectionRelease(&gate->Operations);
    while (!IsListEmpty(&gate->Streams)) {
        PR7_STREAM_NODE node;
        entry = RemoveHeadList(&gate->Streams);
        node = CONTAINING_RECORD(entry, R7_STREAM_NODE, Entry);
        FltDeleteContext(node->Context);
        FltReleaseContext(node->Context);
        ZwClose(node->KernelReadHandle);
        ExFreePoolWithTag(node, R7_POOL_TAG);
    }
    FltDeleteContext(gate->FileContext);
    FltReleaseContext(gate->FileContext);
    ZwClose(gate->KernelReadHandle);
    R7Dereference(gate);
}

static BOOLEAN R7ReadOnlyControl(ULONG control)
{
    switch (control) {
    case FSCTL_GET_REPARSE_POINT:
    case FSCTL_GET_COMPRESSION:
    case FSCTL_GET_INTEGRITY_INFORMATION:
    case FSCTL_QUERY_ALLOCATED_RANGES:
    case FSCTL_GET_RETRIEVAL_POINTERS:
    case FSCTL_GET_OBJECT_ID:
    case FSCTL_READ_FILE_USN_DATA:
        return TRUE;
    default: return FALSE;
    }
}

static FLT_PREOP_CALLBACK_STATUS FLTAPI R7PreOperation(
    PFLT_CALLBACK_DATA data, PCFLT_RELATED_OBJECTS objects, PVOID *completion)
{
    NTSTATUS status;
    PR7_GATE_CONTEXT context = NULL;
    PR7_MUTATION_GATE gate;
    BOOLEAN acquired, paging, fastIo;
    ULONG major, information = 0, control = 0;
    enum R7GateDisposition disposition;
    *completion = NULL;
    if (objects->Instance == NULL || objects->FileObject == NULL)
        return FLT_PREOP_SUCCESS_NO_CALLBACK;
    /* Paging-safe context/state lookup only: no name/file query, allocation,
     * process-attribution guess or user-mode round trip in this path. */
    status = FltGetStreamContext(objects->Instance, objects->FileObject,
        (PFLT_CONTEXT *)&context);
    if (!NT_SUCCESS(status)) status = FltGetFileContext(objects->Instance,
        objects->FileObject, (PFLT_CONTEXT *)&context);
    if (!NT_SUCCESS(status)) return FLT_PREOP_SUCCESS_NO_CALLBACK;
    gate = context->Gate;
    acquired = ExAcquireRundownProtection(&gate->Operations);
    major = data->Iopb->MajorFunction;
    paging = FlagOn(data->Iopb->IrpFlags, IRP_PAGING_IO) != 0;
    fastIo = FLT_IS_FASTIO_OPERATION(data);
    if (major == IRP_MJ_SET_INFORMATION)
        information = data->Iopb->Parameters.SetFileInformation.FileInformationClass;
    if (major == IRP_MJ_FILE_SYSTEM_CONTROL)
        control = data->Iopb->Parameters.FileSystemControl.Common.FsControlCode;
    disposition = R7GateDecide(major, data->Iopb->MinorFunction, TRUE, !acquired || gate->Retiring,
        gate->DenyPaging != 0, paging, fastIo, information,
        R7ReadOnlyControl(control), control == FSCTL_REQUEST_OPLOCK
            && objects->FileObject == context->RetainedProtocolObject);
    if (disposition == R7GateDrainAndInvalidate)
        InterlockedExchange(&gate->UnexpectedMdlDrain, 1);
    if (acquired) ExReleaseRundownProtection(&gate->Operations);
    FltReleaseContext(context);
    if (disposition == R7GatePass || disposition == R7GateDrainAndInvalidate)
        return FLT_PREOP_SUCCESS_NO_CALLBACK;
    if (disposition == R7GateForceIrp) return FLT_PREOP_DISALLOW_FASTIO;
    data->IoStatus.Status = STATUS_ACCESS_DENIED;
    data->IoStatus.Information = 0;
    return FLT_PREOP_COMPLETE;
}

/* Flags zero deliberately includes cached, Fast I/O and paging writes. */
const FLT_OPERATION_REGISTRATION R7GateOperations[] = {
    { IRP_MJ_WRITE, 0, R7PreOperation, NULL },
    { IRP_MJ_PREPARE_MDL_WRITE, 0, R7PreOperation, NULL },
    { IRP_MJ_MDL_WRITE_COMPLETE, 0, R7PreOperation, NULL },
    { IRP_MJ_SET_INFORMATION, 0, R7PreOperation, NULL },
    { IRP_MJ_SET_SECURITY, 0, R7PreOperation, NULL },
    { IRP_MJ_SET_EA, 0, R7PreOperation, NULL },
    { IRP_MJ_FILE_SYSTEM_CONTROL, 0, R7PreOperation, NULL },
    { IRP_MJ_OPERATION_END }
};
