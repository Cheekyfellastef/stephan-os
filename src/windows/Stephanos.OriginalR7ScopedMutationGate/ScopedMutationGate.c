#include "ScopedMutationGate.h"
#include "OperationPolicy.h"

#define R7_POOL_TAG 0x37474d52u
#define R7_CONTEXT_SIGNATURE 0x37435458u
#define R7_MAX_STREAMS 4096u
#define R7_MAX_SOURCE_SIDS 16u
#define R7_MAX_SECURITY_BYTES 65536u

typedef struct _R7_DACL_SEAL {
    HANDLE MetadataHandle;
    PFILE_OBJECT MetadataObject;
    PSECURITY_DESCRIPTOR Original;
    PACL ExpectedAcl;
    BOOLEAN Verified;
    UCHAR Custodian[SECURITY_MAX_SID_SIZE];
} R7_DACL_SEAL, *PR7_DACL_SEAL;

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
    volatile LONG SecurityRecoveryStarted;
    EX_RUNDOWN_REF Operations;
    PFLT_FILTER Filter;
    PFLT_INSTANCE Instance;
    FILE_ID_INFORMATION Identity;
    BOOLEAN Directory;
    ULONG MaximumStreams;
    ULONG StreamCount;
    ULONG ActiveChildren;
    PR7_MUTATION_GATE Parent;
    PR7_DACL_SEAL Seal;
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
static NTSTATUS R7DuplicateCheckedHandle(HANDLE source, ACCESS_MASK required,
    ACCESS_MASK forbidden, PHANDLE duplicate, PFILE_OBJECT *file)
{
    NTSTATUS status;
    PUBLIC_OBJECT_BASIC_INFORMATION information;
    ULONG returned = 0;
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

static NTSTATUS R7DuplicateReadHandle(HANDLE source, PHANDLE duplicate,
    PFILE_OBJECT *file)
{
    return R7DuplicateCheckedHandle(source, FILE_READ_DATA,
        FILE_WRITE_DATA | FILE_APPEND_DATA | FILE_WRITE_EA
        | FILE_WRITE_ATTRIBUTES | FILE_DELETE_CHILD | DELETE
        | WRITE_DAC | WRITE_OWNER | ACCESS_SYSTEM_SECURITY, duplicate, file);
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
        || gate->SecurityRecoveryStarted
        || (gate->Seal != NULL && !gate->Seal->Verified)
        || gate->StreamCount >= gate->MaximumStreams)
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
        || gate->SecurityRecoveryStarted
        || (!gate->Directory && gate->StreamCount == 0))
        return STATUS_INVALID_DEVICE_STATE;
    if (gate->Seal != NULL && !gate->Seal->Verified)
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

static NTSTATUS R7ReadSecurity(PR7_MUTATION_GATE gate, PFILE_OBJECT file,
    PSECURITY_DESCRIPTOR *result)
{
    NTSTATUS status;
    ULONG needed = 0, returned = 0;
    PSECURITY_DESCRIPTOR descriptor;
    const SECURITY_INFORMATION information = OWNER_SECURITY_INFORMATION
        | DACL_SECURITY_INFORMATION;
    *result = NULL;
    status = FltQuerySecurityObject(gate->Instance, file, information,
        NULL, 0, &needed);
    if (status != STATUS_BUFFER_TOO_SMALL) return NT_SUCCESS(status)
        ? STATUS_INVALID_SECURITY_DESCR : status;
    if (needed < sizeof(SECURITY_DESCRIPTOR_RELATIVE)
        || needed > R7_MAX_SECURITY_BYTES) return STATUS_INVALID_SECURITY_DESCR;
    descriptor = ExAllocatePool2(POOL_FLAG_PAGED, needed, R7_POOL_TAG);
    if (descriptor == NULL) return STATUS_INSUFFICIENT_RESOURCES;
    status = FltQuerySecurityObject(gate->Instance, file, information,
        descriptor, needed, &returned);
    if (NT_SUCCESS(status) && (returned > needed
        || returned < sizeof(SECURITY_DESCRIPTOR_RELATIVE)
        || !RtlValidRelativeSecurityDescriptor(descriptor, returned, information)))
        status = STATUS_INVALID_SECURITY_DESCR;
    if (!NT_SUCCESS(status)) ExFreePoolWithTag(descriptor, R7_POOL_TAG);
    else *result = descriptor;
    return status;
}

static NTSTATUS R7MetadataMatches(PR7_MUTATION_GATE gate, PFILE_OBJECT file)
{
    NTSTATUS status;
    ULONG returned = 0;
    FILE_ID_INFORMATION identity;
    PR7_GATE_CONTEXT context = NULL;
    status = FltGetFileContext(gate->Instance, file, (PFLT_CONTEXT *)&context);
    if (!NT_SUCCESS(status)) return status;
    if (context != gate->FileContext) status = STATUS_OBJECT_TYPE_MISMATCH;
    FltReleaseContext(context);
    if (!NT_SUCCESS(status)) return status;
    status = FltQueryInformationFile(gate->Instance, file, &identity,
        sizeof(identity), FileIdInformation, &returned);
    if (NT_SUCCESS(status) && (returned != sizeof(identity)
        || !RtlEqualMemory(&identity, &gate->Identity, sizeof(identity))))
        status = STATUS_FILE_INVALID;
    return status;
}

static VOID R7FreeSeal(PR7_DACL_SEAL seal)
{
    if (seal->ExpectedAcl != NULL) ExFreePoolWithTag(seal->ExpectedAcl, R7_POOL_TAG);
    if (seal->Original != NULL) ExFreePoolWithTag(seal->Original, R7_POOL_TAG);
    if (seal->MetadataObject != NULL) ObDereferenceObject(seal->MetadataObject);
    if (seal->MetadataHandle != NULL) ZwClose(seal->MetadataHandle);
    ExFreePoolWithTag(seal, R7_POOL_TAG);
}

static BOOLEAN R7AclEquivalent(PACL actual, PACL expected)
{
    ULONG index;
    if (actual->AclRevision != expected->AclRevision
        || actual->AceCount != expected->AceCount) return FALSE;
    /* ACL allocation padding is not access policy. NTFS may compact it.
     * Compare every ordered used ACE, including its exact flags/mask/SID. */
    for (index = 0; index < expected->AceCount; index++) {
        PACE_HEADER left = NULL, right = NULL;
        if (!NT_SUCCESS(RtlGetAce(actual, index, (PVOID *)&left))
            || !NT_SUCCESS(RtlGetAce(expected, index, (PVOID *)&right))
            || left->AceSize != right->AceSize
            || !RtlEqualMemory(left, right, left->AceSize)) return FALSE;
    }
    return TRUE;
}

static NTSTATUS R7DescriptorMatches(PR7_MUTATION_GATE gate,
    PFILE_OBJECT file, PSID expectedOwner, PACL expectedAcl, BOOLEAN protected)
{
    NTSTATUS status;
    PSECURITY_DESCRIPTOR readback = NULL;
    PSID owner = NULL;
    PACL acl = NULL;
    BOOLEAN defaulted = FALSE, present = FALSE;
    status = R7MetadataMatches(gate, file);
    if (!NT_SUCCESS(status)) return status;
    status = R7ReadSecurity(gate, file, &readback);
    if (!NT_SUCCESS(status)) return status;
    status = RtlGetOwnerSecurityDescriptor(readback, &owner, &defaulted);
    if (NT_SUCCESS(status)) status = RtlGetDaclSecurityDescriptor(readback,
        &present, &acl, &defaulted);
    if (NT_SUCCESS(status) && (!present || acl == NULL || owner == NULL
        || !RtlEqualSid(owner, expectedOwner) || !R7AclEquivalent(acl, expectedAcl)
        || (!!FlagOn(((PISECURITY_DESCRIPTOR_RELATIVE)readback)->Control,
            SE_DACL_PROTECTED)) != !!protected)) status = STATUS_INVALID_SECURITY_DESCR;
    ExFreePoolWithTag(readback, R7_POOL_TAG);
    return status;
}

NTSTATUS R7GateSealSourceDacl(PR7_MUTATION_GATE gate, HANDLE metadataHandle,
    PSID custodian, ULONG sourceCount, PSID const *sources)
{
    NTSTATUS status;
    PR7_DACL_SEAL seal;
    PACL originalAcl = NULL;
    PSID originalOwner = NULL;
    BOOLEAN present = FALSE, defaulted = FALSE;
    ULONG index, prior, length, aclBytes;
    UCHAR captured[R7_MAX_SOURCE_SIDS][SECURITY_MAX_SID_SIZE];
    SECURITY_DESCRIPTOR desired;
    if (KeGetCurrentIrql() != PASSIVE_LEVEL || ExGetPreviousMode() != KernelMode
        || KeAreAllApcsDisabled() || IoGetTopLevelIrp() != NULL || gate == NULL
        || gate->Retiring || gate->DenyPaging || gate->SecurityRecoveryStarted
        || gate->ActiveChildren != 0
        || gate->Seal != NULL || sources == NULL || custodian == NULL
        || sourceCount == 0 || sourceCount > R7_MAX_SOURCE_SIDS
        || !RtlValidSid(custodian)) return STATUS_INVALID_PARAMETER;
    seal = ExAllocatePool2(POOL_FLAG_PAGED, sizeof(*seal), R7_POOL_TAG);
    if (seal == NULL) return STATUS_INSUFFICIENT_RESOURCES;
    status = RtlCopySid(sizeof(seal->Custodian), seal->Custodian, custodian);
    if (!NT_SUCCESS(status)) goto FailBeforeSet;
    for (index = 0; index < sourceCount; index++) {
        if (sources[index] == NULL || !RtlValidSid(sources[index])) {
            status = STATUS_INVALID_SID; goto FailBeforeSet;
        }
        status = RtlCopySid(sizeof(captured[index]), captured[index], sources[index]);
        if (!NT_SUCCESS(status)) goto FailBeforeSet;
        if (RtlEqualSid(captured[index], seal->Custodian)) {
            status = STATUS_INVALID_SID; goto FailBeforeSet;
        }
        for (prior = 0; prior < index; prior++) {
            if (RtlEqualSid(captured[index], captured[prior])) {
                status = STATUS_INVALID_SID; goto FailBeforeSet;
            }
        }
    }
    status = R7DuplicateCheckedHandle(metadataHandle,
        READ_CONTROL | WRITE_DAC | WRITE_OWNER,
        FILE_WRITE_DATA | FILE_APPEND_DATA | FILE_WRITE_EA
            | FILE_WRITE_ATTRIBUTES | FILE_DELETE_CHILD | DELETE | ACCESS_SYSTEM_SECURITY,
        &seal->MetadataHandle, &seal->MetadataObject);
    if (!NT_SUCCESS(status)) goto FailBeforeSet;
    status = R7MetadataMatches(gate, seal->MetadataObject);
    if (!NT_SUCCESS(status)) goto FailBeforeSet;
    status = R7ReadSecurity(gate, seal->MetadataObject, &seal->Original);
    if (!NT_SUCCESS(status)) goto FailBeforeSet;
    status = RtlGetOwnerSecurityDescriptor(seal->Original, &originalOwner, &defaulted);
    if (NT_SUCCESS(status)) status = RtlGetDaclSecurityDescriptor(seal->Original,
        &present, &originalAcl, &defaulted);
    if (!NT_SUCCESS(status)) goto FailBeforeSet;
    if (!present || originalAcl == NULL || originalOwner == NULL
        || (originalAcl->AclRevision != ACL_REVISION
            && originalAcl->AclRevision != ACL_REVISION_DS)) {
        status = STATUS_INVALID_SECURITY_DESCR; goto FailBeforeSet;
    }
    aclBytes = sizeof(ACL);
    for (index = 0; index < originalAcl->AceCount; index++) {
        PACE_HEADER ace = NULL;
        status = RtlGetAce(originalAcl, index, (PVOID *)&ace);
        if (!NT_SUCCESS(status)) goto FailBeforeSet;
        if ((PUCHAR)ace < (PUCHAR)originalAcl + sizeof(ACL)
            || ace->AceSize < sizeof(ACE_HEADER)
            || (PUCHAR)ace + ace->AceSize > (PUCHAR)originalAcl + originalAcl->AclSize) {
            status = STATUS_INVALID_ACL; goto FailBeforeSet;
        }
        aclBytes += ace->AceSize;
    }
    for (index = 0; index < sourceCount; index++)
        aclBytes += FIELD_OFFSET(ACCESS_DENIED_ACE, SidStart) + RtlLengthSid(captured[index]);
    if (aclBytes > MAXUSHORT || aclBytes < sizeof(ACL)) {
        status = STATUS_ALLOTTED_SPACE_EXCEEDED; goto FailBeforeSet;
    }
    seal->ExpectedAcl = ExAllocatePool2(POOL_FLAG_PAGED, aclBytes, R7_POOL_TAG);
    if (seal->ExpectedAcl == NULL) { status = STATUS_INSUFFICIENT_RESOURCES; goto FailBeforeSet; }
    status = RtlCreateAcl(seal->ExpectedAcl, aclBytes, originalAcl->AclRevision);
    if (!NT_SUCCESS(status)) goto FailBeforeSet;
    for (index = 0; index < sourceCount; index++) {
        UCHAR bytes[FIELD_OFFSET(ACCESS_DENIED_ACE, SidStart) + SECURITY_MAX_SID_SIZE];
        PACCESS_DENIED_ACE ace = (PACCESS_DENIED_ACE)bytes;
        length = FIELD_OFFSET(ACCESS_DENIED_ACE, SidStart) + RtlLengthSid(captured[index]);
        RtlZeroMemory(bytes, sizeof(bytes));
        ace->Header.AceType = ACCESS_DENIED_ACE_TYPE;
        /* Per-object explicit denial. No new inherited denial is installed on
         * an unenumerated child; parent mutation rights block new entries. */
        ace->Header.AceSize = (USHORT)length;
        ace->Mask = FILE_ALL_ACCESS;
        status = RtlCopySid(RtlLengthSid(captured[index]), &ace->SidStart, captured[index]);
        if (NT_SUCCESS(status)) status = RtlAddAce(seal->ExpectedAcl,
            originalAcl->AclRevision, MAXULONG, ace, length);
        if (!NT_SUCCESS(status)) goto FailBeforeSet;
    }
    for (index = 0; index < originalAcl->AceCount; index++) {
        PACE_HEADER ace = NULL;
        status = RtlGetAce(originalAcl, index, (PVOID *)&ace);
        if (NT_SUCCESS(status)) status = RtlAddAce(seal->ExpectedAcl,
            originalAcl->AclRevision, MAXULONG, ace, ace->AceSize);
        if (!NT_SUCCESS(status)) goto FailBeforeSet;
    }
    status = RtlCreateSecurityDescriptor(&desired, SECURITY_DESCRIPTOR_REVISION);
    if (NT_SUCCESS(status)) status = RtlSetOwnerSecurityDescriptor(&desired,
        seal->Custodian, FALSE);
    if (NT_SUCCESS(status)) status = RtlSetDaclSecurityDescriptor(&desired,
        TRUE, seal->ExpectedAcl, FALSE);
    if (!NT_SUCCESS(status)) goto FailBeforeSet;
    /* Publish recovery ownership BEFORE any possible filesystem mutation.
     * No caller can retire this gate, even if set/readback later fails. */
    gate->Seal = seal;
    status = FltSetSecurityObject(gate->Instance, seal->MetadataObject,
        OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION
            | PROTECTED_DACL_SECURITY_INFORMATION, &desired);
    if (NT_SUCCESS(status)) status = R7DescriptorMatches(gate,
        seal->MetadataObject, seal->Custodian, seal->ExpectedAcl, TRUE);
    seal->Verified = NT_SUCCESS(status);
    return status;
FailBeforeSet:
    R7FreeSeal(seal);
    return status;
}

NTSTATUS R7GateRestoreSourceDacl(PR7_MUTATION_GATE gate)
{
    NTSTATUS status;
    PR7_DACL_SEAL seal;
    PACL originalAcl = NULL;
    PSID owner = NULL;
    BOOLEAN present = FALSE, defaulted = FALSE, protected;
    if (KeGetCurrentIrql() != PASSIVE_LEVEL || ExGetPreviousMode() != KernelMode
        || KeAreAllApcsDisabled() || IoGetTopLevelIrp() != NULL || gate == NULL
        || gate->Retiring || gate->ActiveChildren != 0 || gate->Seal == NULL)
        return STATUS_INVALID_DEVICE_STATE;
    seal = gate->Seal;
    /* Explicit recovery permanently ends this gate's forward-policy lifetime,
     * including after successful restore frees Seal. It cannot be re-armed. */
    InterlockedExchange(&gate->SecurityRecoveryStarted, 1);
    seal->Verified = FALSE;
    status = R7MetadataMatches(gate, seal->MetadataObject);
    if (!NT_SUCCESS(status)) return status;
    status = RtlGetOwnerSecurityDescriptor(seal->Original, &owner, &defaulted);
    if (NT_SUCCESS(status)) status = RtlGetDaclSecurityDescriptor(seal->Original,
        &present, &originalAcl, &defaulted);
    if (!NT_SUCCESS(status) || !present || originalAcl == NULL || owner == NULL)
        return NT_SUCCESS(status) ? STATUS_INVALID_SECURITY_DESCR : status;
    protected = FlagOn(((PISECURITY_DESCRIPTOR_RELATIVE)seal->Original)->Control,
        SE_DACL_PROTECTED) != 0;
    status = FltSetSecurityObject(gate->Instance, seal->MetadataObject,
        OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION
            | (protected ? PROTECTED_DACL_SECURITY_INFORMATION
                : UNPROTECTED_DACL_SECURITY_INFORMATION), seal->Original);
    if (NT_SUCCESS(status)) status = R7DescriptorMatches(gate,
        seal->MetadataObject, owner, originalAcl, protected);
    if (!NT_SUCCESS(status)) return status; /* Retain recovery state. */
    gate->Seal = NULL;
    R7FreeSeal(seal);
    return STATUS_SUCCESS;
}

NTSTATUS R7GateEnrollChild(PR7_MUTATION_GATE parent, PCUNICODE_STRING leaf,
    const FILE_ID_INFORMATION *expectedIdentity, BOOLEAN directory,
    ULONG maximumStreams, PR7_MUTATION_GATE *child)
{
    NTSTATUS status;
    WCHAR captured[255];
    UNICODE_STRING name, supplied;
    OBJECT_ATTRIBUTES attributes;
    IO_STATUS_BLOCK io;
    FILE_ID_INFORMATION expected, actual;
    BOOLEAN actualDirectory = FALSE;
    HANDLE opened = NULL;
    PFILE_OBJECT file = NULL;
    PR7_MUTATION_GATE enrolled = NULL;
    USHORT index, count;
    if (KeGetCurrentIrql() != PASSIVE_LEVEL || ExGetPreviousMode() != KernelMode
        || KeAreAllApcsDisabled() || IoGetTopLevelIrp() != NULL)
        return STATUS_INVALID_PARAMETER;
    if (child == NULL) return STATUS_INVALID_PARAMETER;
    *child = NULL;
    if (leaf == NULL || expectedIdentity == NULL) return STATUS_INVALID_PARAMETER;
    supplied = *leaf;
    expected = *expectedIdentity;
    if (parent == NULL || !parent->Directory || parent->Retiring
        || parent->SecurityRecoveryStarted
        || (parent->Seal != NULL && !parent->Seal->Verified)
        || parent->ActiveChildren == MAXULONG
        || supplied.Buffer == NULL || supplied.Length == 0
        || supplied.Length > sizeof(captured) || (supplied.Length % sizeof(WCHAR)) != 0
        || supplied.Length > supplied.MaximumLength || maximumStreams == 0
        || maximumStreams > R7_MAX_STREAMS)
        return STATUS_INVALID_PARAMETER;
    /* Capture once before validation/use. This is a trusted kernel buffer,
     * never a wire pointer, and is not an independent path authority. */
    name.Length = supplied.Length;
    name.MaximumLength = name.Length;
    name.Buffer = captured;
    RtlCopyMemory(captured, supplied.Buffer, name.Length);
    count = name.Length / sizeof(WCHAR);
    if ((count == 1 && captured[0] == L'.')
        || (count == 2 && captured[0] == L'.' && captured[1] == L'.')
        || captured[count - 1] == L'.' || captured[count - 1] == L' ')
        return STATUS_OBJECT_NAME_INVALID;
    for (index = 0; index < count; index++) {
        WCHAR c = captured[index];
        if (c < 0x20 || c == L'\\' || c == L'/' || c == L':'
            || c == L'*' || c == L'?' || c == L'"' || c == L'<'
            || c == L'>' || c == L'|') return STATUS_OBJECT_NAME_INVALID;
    }
    InitializeObjectAttributes(&attributes, &name, OBJ_KERNEL_HANDLE,
        parent->KernelReadHandle, NULL);
    RtlZeroMemory(&io, sizeof(io));
    status = FltCreateFileEx2(parent->Filter, parent->Instance, &opened, &file,
        FILE_READ_DATA | FILE_READ_ATTRIBUTES | READ_CONTROL | SYNCHRONIZE,
        &attributes, &io, NULL, 0, FILE_SHARE_READ, FILE_OPEN,
        FILE_OPEN_REPARSE_POINT
            | (directory ? FILE_DIRECTORY_FILE : FILE_NON_DIRECTORY_FILE),
        NULL, 0, 0, NULL);
    if (!NT_SUCCESS(status)) return status;
    if (!NT_SUCCESS(io.Status)) { status = io.Status; goto CloseOpen; }
    if (io.Information != FILE_OPENED) {
        status = STATUS_INVALID_DEVICE_STATE; goto CloseOpen;
    }
    status = R7Inspect(parent->Filter, parent->Instance, file,
        &actual, &actualDirectory);
    if (!NT_SUCCESS(status)) goto CloseOpen;
    if (actualDirectory != directory
        || !RtlEqualMemory(&actual, &expected, sizeof(actual))) {
        status = STATUS_FILE_INVALID; goto CloseOpen;
    }
    /* FILE_OPEN cannot create/overwrite. Preserve ordinary share tracking:
     * Flags=0, no IO_IGNORE_SHARE_ACCESS_CHECK, no caller ECPs or EA data. */
    status = R7GateEnrollFile(parent->Filter, parent->Instance, opened,
        maximumStreams, &enrolled);
    if (NT_SUCCESS(status) && !directory)
        status = R7GateEnrollStream(enrolled, opened);
    if (!NT_SUCCESS(status) && enrolled != NULL) {
        NTSTATUS retired = R7GateRetire(enrolled);
        NT_ASSERT(NT_SUCCESS(retired));
        UNREFERENCED_PARAMETER(retired);
        enrolled = NULL;
    }
CloseOpen:
    ObDereferenceObject(file);
    FltClose(opened);
    if (!NT_SUCCESS(status)) return status;
    R7Reference(parent);
    parent->ActiveChildren++;
    enrolled->Parent = parent;
    *child = enrolled;
    return STATUS_SUCCESS;
}

NTSTATUS R7GateRetire(PR7_MUTATION_GATE gate)
{
    PLIST_ENTRY entry;
    PR7_MUTATION_GATE parent;
    if (KeGetCurrentIrql() != PASSIVE_LEVEL || gate == NULL || gate->Retiring
        || gate->ActiveChildren != 0 || gate->Seal != NULL)
        return STATUS_INVALID_DEVICE_STATE;
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
    parent = gate->Parent;
    if (parent != NULL) {
        NT_ASSERT(parent->ActiveChildren != 0);
        parent->ActiveChildren--;
        R7Dereference(parent);
    }
    R7Dereference(gate);
    return STATUS_SUCCESS;
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
