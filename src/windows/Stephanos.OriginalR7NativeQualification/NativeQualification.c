/* DISPOSABLE GUEST ONLY. Real loadable test filter, not a custody producer.
 * Never install on Battle Bridge. No seal, paging transition, signer or lease.
 * Fixed fixtures are deliberately left on the disposable VHD for inspection. */
#include "../Stephanos.OriginalR7ScopedMutationGate/ScopedMutationGate.h"
#include <ntddstor.h>
#include "Protocol.h"

#define R7Q_TAG 'qN7R'
#define R7Q_MAX_SD 65536u
C_ASSERT(sizeof(R7Q_REQUEST) == 16);
C_ASSERT(sizeof(R7Q_RESULT) == 32);
static PFLT_FILTER R7QFilter;
static PFLT_PORT R7QServer, R7QClient;
static PFLT_INSTANCE R7QInstance;
static EX_RUNDOWN_REF R7QMessages;
static EX_RUNDOWN_REF R7QAttachments;
static EX_RUNDOWN_REF R7QInstanceReads;
static volatile LONG R7QAdmissionCloseClaimed;
static volatile LONG R7QStopping, R7QRunClaimed, R7QRevoked;
static volatile LONG R7QFilteringStarted;
/* 0=not finalized, 2=historical test finalized, 3=teardown won. */
static volatile LONG R7QTerminal;
static volatile LONG R7QPass, R7QDeny;
static PFILE_OBJECT R7QProbeObject;
static PETHREAD R7QProbeThread;
static R7Q_RESULT R7QResult;
static FLT_OPERATION_REGISTRATION R7QOperations[8];

static FLT_PREOP_CALLBACK_STATUS FLTAPI R7QPreOperation(
    PFLT_CALLBACK_DATA data, PCFLT_RELATED_OBJECTS objects, PVOID *completion)
{
    ULONG i;
    FLT_PREOP_CALLBACK_STATUS disposition = FLT_PREOP_SUCCESS_NO_CALLBACK;
    for (i = 0; R7GateOperations[i].MajorFunction != IRP_MJ_OPERATION_END; i++) {
        if (R7GateOperations[i].MajorFunction == data->Iopb->MajorFunction) {
            disposition = R7GateOperations[i].PreOperation(data, objects, completion);
            break;
        }
    }
    /* Worker owns both referenced objects until its synchronous call returns.
     * Only this worker's exact metadata FO can contribute causal observations. */
    if (objects->FileObject == R7QProbeObject && R7QProbeObject != NULL
        && PsGetCurrentThread() == R7QProbeThread
        && (data->Iopb->MajorFunction == IRP_MJ_SET_EA
            || data->Iopb->MajorFunction == IRP_MJ_SET_SECURITY)) {
        if (disposition == FLT_PREOP_COMPLETE
            && data->IoStatus.Status == STATUS_ACCESS_DENIED)
            InterlockedIncrement(&R7QDeny);
        if (disposition == FLT_PREOP_SUCCESS_NO_CALLBACK)
            InterlockedIncrement(&R7QPass);
    }
    return disposition;
}

/* No test or wait occurs during instance setup. Manual attachment alone does
 * not admit any fixture mutation. The worker independently checks the volume. */
static NTSTATUS FLTAPI R7QSetup(PCFLT_RELATED_OBJECTS objects,
    FLT_INSTANCE_SETUP_FLAGS flags, DEVICE_TYPE device, FLT_FILESYSTEM_TYPE fs)
{
    NTSTATUS status;
    KeEnterCriticalRegion();
    if (!ExAcquireRundownProtection(&R7QAttachments)) {
        KeLeaveCriticalRegion(); return STATUS_FLT_DO_NOT_ATTACH;
    }
    if (flags != FLTFL_INSTANCE_SETUP_MANUAL_ATTACHMENT
        || device != FILE_DEVICE_DISK_FILE_SYSTEM || fs != FLT_FSTYPE_NTFS
        || InterlockedCompareExchange(&R7QFilteringStarted, 0, 0) == 0
        || InterlockedCompareExchange(&R7QRevoked, 0, 0) != 0
        || InterlockedCompareExchange(&R7QStopping, 0, 0) != 0)
        { ExReleaseRundownProtection(&R7QAttachments); KeLeaveCriticalRegion(); return STATUS_FLT_DO_NOT_ATTACH; }
    status = FltObjectReference(objects->Instance);
    if (!NT_SUCCESS(status)) { ExReleaseRundownProtection(&R7QAttachments); KeLeaveCriticalRegion(); return status; }
    if (InterlockedCompareExchangePointer((PVOID volatile *)&R7QInstance,
        objects->Instance, NULL) != NULL) {
        FltObjectDereference(objects->Instance);
        ExReleaseRundownProtection(&R7QAttachments);
        KeLeaveCriticalRegion();
        return STATUS_FLT_DO_NOT_ATTACH;
    }
    ExReleaseRundownProtection(&R7QAttachments);
    KeLeaveCriticalRegion();
    return STATUS_SUCCESS;
}

static NTSTATUS FLTAPI R7QQueryTeardown(PCFLT_RELATED_OBJECTS objects,
    FLT_INSTANCE_QUERY_TEARDOWN_FLAGS flags)
{
    UNREFERENCED_PARAMETER(objects); UNREFERENCED_PARAMETER(flags);
    /* This single-shot image retains its instance until filter unload. */
    return STATUS_FLT_DO_NOT_DETACH;
}

static VOID R7QCloseInstanceAdmission(VOID)
{
    PFLT_INSTANCE instance;
    if (InterlockedCompareExchange(&R7QAdmissionCloseClaimed, 1, 0) != 0) return;
    /* Permanently stop reattachment and drain late Setup publication before
     * removing the one global reference. Setup holds no worker/I/O lifetime. */
    ExWaitForRundownProtectionRelease(&R7QAttachments);
    /* Only pointer acquisition runs under this rundown, never worker I/O. */
    ExWaitForRundownProtectionRelease(&R7QInstanceReads);
    instance = InterlockedExchangePointer((PVOID volatile *)&R7QInstance, NULL);
    if (instance != NULL) FltObjectDereference(instance);
}

static VOID FLTAPI R7QTeardownStart(PCFLT_RELATED_OBJECTS objects,
    FLT_INSTANCE_TEARDOWN_FLAGS flags)
{
    UNREFERENCED_PARAMETER(objects); UNREFERENCED_PARAMETER(flags);
    /* Teardown before historical completion refuses qualification. Drop only
     * global admission ownership here; worker/gate own their local references. */
    InterlockedExchange(&R7QRevoked, 1);
    InterlockedCompareExchange(&R7QTerminal, 3, 0);
    R7QCloseInstanceAdmission();
}

static NTSTATUS R7QOpen(PUNICODE_STRING name, HANDLE parent,
    ACCESS_MASK access, ULONG share, ULONG disposition, BOOLEAN directory,
    PHANDLE handle, PFILE_OBJECT *file)
{
    OBJECT_ATTRIBUTES attributes;
    IO_STATUS_BLOCK io;
    *handle = NULL; if (file != NULL) *file = NULL;
    InitializeObjectAttributes(&attributes, name,
        OBJ_KERNEL_HANDLE | OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE, parent, NULL);
    /* NULL instance intentionally starts at the TOP of the stack. Using the
     * tested instance here would bypass our own callbacks on generated I/O. */
    return FltCreateFileEx2(R7QFilter, NULL, handle, file, access, &attributes,
        &io, NULL, FILE_ATTRIBUTE_NORMAL, share, disposition,
        FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT
            | (directory ? FILE_DIRECTORY_FILE : FILE_NON_DIRECTORY_FILE),
        NULL, 0, 0, NULL);
}

static NTSTATUS R7QAdmitVolume(PFLT_INSTANCE instance, PHANDLE root)
{
    WCHAR nameBuffer[512];
    UNICODE_STRING name, systemRoot = RTL_CONSTANT_STRING(L"\\SystemRoot");
    const WCHAR label[] = L"R7_NATIVE_TEST_ONLY";
    union { ULONGLONG Alignment; UCHAR Bytes[256]; } volumeBuffer;
    union { ULONGLONG Alignment; UCHAR Bytes[1024]; } storageBuffer;
    PFILE_FS_VOLUME_INFORMATION info = (PFILE_FS_VOLUME_INFORMATION)volumeBuffer.Bytes;
    PSTORAGE_DEVICE_DESCRIPTOR descriptor = (PSTORAGE_DEVICE_DESCRIPTOR)storageBuffer.Bytes;
    STORAGE_PROPERTY_QUERY query = { StorageDeviceProperty, PropertyStandardQuery, { 0 } };
    PFLT_VOLUME volume = NULL, osVolume = NULL;
    PFILE_OBJECT rootFile = NULL, osFile = NULL;
    HANDLE osHandle = NULL;
    HANDLE volumeHandle = NULL;
    OBJECT_ATTRIBUTES attributes;
    IO_STATUS_BLOCK io;
    NTSTATUS status;
    ULONG returned = 0, required = 0;
    *root = NULL;
    if (InterlockedCompareExchange(&R7QRevoked, 0, 0))
        return STATUS_INVALID_DEVICE_STATE;
    status = FltGetVolumeFromInstance(instance, &volume);
    if (!NT_SUCCESS(status)) goto Exit;
    /* Compare actual volumes, not a caller's drive-letter claim. Read-only
     * SystemRoot resolution intentionally follows the OS object-manager link. */
    InitializeObjectAttributes(&attributes, &systemRoot,
        OBJ_KERNEL_HANDLE | OBJ_CASE_INSENSITIVE, NULL, NULL);
    status = ZwOpenFile(&osHandle, FILE_READ_ATTRIBUTES | SYNCHRONIZE,
        &attributes, &io, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        FILE_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT);
    if (!NT_SUCCESS(status)) goto Exit;
    status = ObReferenceObjectByHandle(osHandle, 0, *IoFileObjectType,
        KernelMode, (PVOID *)&osFile, NULL);
    if (!NT_SUCCESS(status)) goto Exit;
    status = FltGetVolumeFromFileObject(R7QFilter, osFile, &osVolume);
    if (!NT_SUCCESS(status)) goto Exit;
    if (osVolume == volume) { status = STATUS_ACCESS_DENIED; goto Exit; }
    RtlInitEmptyUnicodeString(&name, nameBuffer, sizeof(nameBuffer));
    status = FltGetVolumeName(volume, &name, &required);
    if (!NT_SUCCESS(status)) goto Exit;
    /* A real volume-device handle, not the directory root used for fixtures.
     * FltCreateFileEx2 must not be used to acquire a direct storage handle. */
    InitializeObjectAttributes(&attributes, &name,
        OBJ_KERNEL_HANDLE | OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE, NULL, NULL);
    status = ZwOpenFile(&volumeHandle, FILE_READ_ATTRIBUTES | SYNCHRONIZE,
        &attributes, &io, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        FILE_SYNCHRONOUS_IO_NONALERT);
    if (!NT_SUCCESS(status)) goto Exit;
    status = RtlAppendUnicodeToString(&name, L"\\");
    if (!NT_SUCCESS(status)) goto Exit;
    status = R7QOpen(&name, NULL, FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, FILE_OPEN, TRUE,
        root, &rootFile);
    if (!NT_SUCCESS(status)) goto Exit;
    RtlZeroMemory(&volumeBuffer, sizeof(volumeBuffer));
    status = FltQueryVolumeInformationFile(instance, rootFile, info,
        sizeof(volumeBuffer), FileFsVolumeInformation, &returned);
    if (status != STATUS_SUCCESS) goto Exit;
    if (returned < (ULONG)FIELD_OFFSET(FILE_FS_VOLUME_INFORMATION, VolumeLabel)
        || info->VolumeLabelLength != sizeof(label) - sizeof(WCHAR)
        || returned < (ULONG)FIELD_OFFSET(FILE_FS_VOLUME_INFORMATION, VolumeLabel) + info->VolumeLabelLength
        || !RtlEqualMemory(info->VolumeLabel, label, sizeof(label) - sizeof(WCHAR)))
        { status = STATUS_ACCESS_DENIED; goto Exit; }
    RtlZeroMemory(&storageBuffer, sizeof(storageBuffer));
    /* Fixed read-only storage query through the retained native volume handle.
     * No FltGetDiskDeviceObject outside an I/O-related callback is needed. */
    io.Status = STATUS_UNSUCCESSFUL; io.Information = 0;
    status = ZwDeviceIoControlFile(volumeHandle, NULL, NULL, NULL, &io,
        IOCTL_STORAGE_QUERY_PROPERTY, &query, sizeof(query), descriptor, sizeof(storageBuffer));
    if (status == STATUS_PENDING) {
        status = ZwWaitForSingleObject(volumeHandle, FALSE, NULL);
        if (status != STATUS_SUCCESS) goto Exit;
        status = io.Status;
    }
    if (status != STATUS_SUCCESS) goto Exit;
    if (io.Status != STATUS_SUCCESS || io.Information > sizeof(storageBuffer))
        { status = STATUS_DATA_ERROR; goto Exit; }
    returned = (ULONG)io.Information;
    if (returned < sizeof(STORAGE_DEVICE_DESCRIPTOR)
        || descriptor->Version < sizeof(STORAGE_DEVICE_DESCRIPTOR)
        || descriptor->Size < sizeof(STORAGE_DEVICE_DESCRIPTOR)
        || descriptor->Size > returned || descriptor->BusType != BusTypeFileBackedVirtual)
        status = STATUS_NOT_SUPPORTED;
Exit:
    if (volumeHandle != NULL) ZwClose(volumeHandle);
    if (rootFile != NULL) ObDereferenceObject(rootFile);
    if (osFile != NULL) ObDereferenceObject(osFile);
    if (osHandle != NULL) ZwClose(osHandle);
    if (osVolume != NULL) FltObjectDereference(osVolume);
    if (volume != NULL) FltObjectDereference(volume);
    if (!NT_SUCCESS(status) && *root != NULL) { FltClose(*root); *root = NULL; }
    return status;
}

static NTSTATUS R7QReadDacl(HANDLE handle, PSECURITY_DESCRIPTOR *descriptor)
{
    ULONG needed = 0;
    NTSTATUS status;
    *descriptor = NULL;
    status = ZwQuerySecurityObject(handle, DACL_SECURITY_INFORMATION, NULL, 0, &needed);
    if (status != STATUS_BUFFER_TOO_SMALL || needed < SECURITY_DESCRIPTOR_MIN_LENGTH
        || needed > R7Q_MAX_SD) return STATUS_INVALID_SECURITY_DESCR;
    *descriptor = ExAllocatePool2(POOL_FLAG_PAGED, needed, R7Q_TAG);
    if (*descriptor == NULL) return STATUS_INSUFFICIENT_RESOURCES;
    status = ZwQuerySecurityObject(handle, DACL_SECURITY_INFORMATION, *descriptor,
        needed, &needed);
    if (status != STATUS_SUCCESS) { ExFreePoolWithTag(*descriptor, R7Q_TAG); *descriptor = NULL; }
    return status;
}

static NTSTATUS R7QProbe(HANDLE metadata, PFILE_OBJECT file,
    PSECURITY_DESCRIPTOR original, BOOLEAN deny)
{
    union { ULONG Alignment; UCHAR Bytes[16]; } eaBuffer;
    union { ULONG Alignment; UCHAR Bytes[64]; } readbackBuffer;
    PFILE_FULL_EA_INFORMATION ea = (PFILE_FULL_EA_INFORMATION)eaBuffer.Bytes;
    PFILE_FULL_EA_INFORMATION readback = (PFILE_FULL_EA_INFORMATION)readbackBuffer.Bytes;
    IO_STATUS_BLOCK io;
    NTSTATUS status;
    LONG passBefore = R7QPass, denyBefore = R7QDeny;
    RtlZeroMemory(&eaBuffer, sizeof(eaBuffer));
    ea->EaNameLength = 3; ea->EaValueLength = 1;
    RtlCopyMemory(ea->EaName, "R7Q\0", 4); ea->EaName[4] = deny ? '2' : '1';
    R7QProbeObject = file;
    status = ZwSetEaFile(metadata, &io, ea,
        FIELD_OFFSET(FILE_FULL_EA_INFORMATION, EaName) + 5);
    if (status != (deny ? STATUS_ACCESS_DENIED : STATUS_SUCCESS)) goto Exit;
    status = ZwSetSecurityObject(metadata, DACL_SECURITY_INFORMATION, original);
    if (status != (deny ? STATUS_ACCESS_DENIED : STATUS_SUCCESS)) goto Exit;
    if (deny ? (R7QDeny - denyBefore != 2 || R7QPass != passBefore)
             : (R7QPass - passBefore != 2 || R7QDeny != denyBefore))
        { status = STATUS_DATA_ERROR; goto Exit; }
    RtlZeroMemory(&readbackBuffer, sizeof(readbackBuffer));
    status = ZwQueryEaFile(metadata, &io, readback, sizeof(readbackBuffer),
        TRUE, NULL, 0, NULL, TRUE);
    if (status != STATUS_SUCCESS) goto Exit;
    if (io.Information < FIELD_OFFSET(FILE_FULL_EA_INFORMATION, EaName) + 5
        || io.Information > sizeof(readbackBuffer)
        || readback->NextEntryOffset != 0 || readback->Flags != 0
        || readback->EaNameLength != 3 || readback->EaValueLength != 1
        || !RtlEqualMemory(readback->EaName, "R7Q\0" "1", 5))
        { status = STATUS_DATA_ERROR; goto Exit; }
    status = STATUS_SUCCESS;
Exit:
    R7QProbeObject = NULL;
    /* Unexpected STATUS_SUCCESS must never turn a failed denial into success. */
    if ((deny && R7QDeny - denyBefore != 2) || (!deny && R7QPass - passBefore != 2))
        return STATUS_DATA_ERROR;
    return status;
}

static VOID R7QWorker(PVOID parameter)
{
    PFLT_INSTANCE instance = (PFLT_INSTANCE)parameter;
    HANDLE root = NULL, directory = NULL, metadata = NULL, control = NULL;
    HANDLE read = NULL, writer = NULL;
    PFILE_OBJECT metaFile = NULL, controlFile = NULL;
    PSECURITY_DESCRIPTOR original = NULL, controlOriginal = NULL;
    PR7_MUTATION_GATE gate = NULL;
    GUID id;
    UNICODE_STRING directoryName = {0}, leaf = RTL_CONSTANT_STRING(L"retained.dat");
    UNICODE_STRING other = RTL_CONSTANT_STRING(L"control.dat");
    NTSTATUS status, retired;
    const ACCESS_MASK metaAccess = READ_CONTROL | WRITE_DAC | FILE_READ_EA | FILE_WRITE_EA | SYNCHRONIZE;
    const ULONG shareAll = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
    R7QProbeThread = PsGetCurrentThread();
    status = R7QAdmitVolume(instance, &root);
    if (!NT_SUCCESS(status)) goto Exit;
    R7QResult.CompletedStages |= R7Q_VOLUME_ADMITTED;
    status = ExUuidCreate(&id);
    if (status != STATUS_SUCCESS && status != RPC_NT_UUID_LOCAL_ONLY) goto Exit;
    status = RtlStringFromGUID(&id, &directoryName);
    if (!NT_SUCCESS(status)) goto Exit;
    status = R7QOpen(&directoryName, root, FILE_LIST_DIRECTORY | FILE_TRAVERSE | SYNCHRONIZE,
        shareAll, FILE_CREATE, TRUE, &directory, NULL);
    if (!NT_SUCCESS(status)) goto Exit;
    status = R7QOpen(&leaf, directory, metaAccess, shareAll, FILE_CREATE, FALSE, &metadata, &metaFile);
    if (!NT_SUCCESS(status)) goto Exit;
    status = R7QOpen(&other, directory, metaAccess, shareAll, FILE_CREATE, FALSE, &control, &controlFile);
    if (!NT_SUCCESS(status)) goto Exit;
    status = R7QReadDacl(metadata, &original);
    if (!NT_SUCCESS(status)) goto Exit;
    status = R7QReadDacl(control, &controlOriginal);
    if (!NT_SUCCESS(status)) goto Exit;
    status = R7QProbe(metadata, metaFile, original, FALSE);
    if (!NT_SUCCESS(status)) goto Exit;
    R7QResult.CompletedStages |= R7Q_BASELINE_PASSED;
    status = R7QOpen(&leaf, directory, FILE_READ_DATA | READ_CONTROL | SYNCHRONIZE,
        FILE_SHARE_READ, FILE_OPEN, FALSE, &read, NULL);
    if (!NT_SUCCESS(status)) goto Exit;
    status = R7GateEnrollFile(R7QFilter, instance, read, 2, &gate);
    if (!NT_SUCCESS(status)) goto Exit;
    status = R7GateEnrollStream(gate, read);
    if (!NT_SUCCESS(status)) goto Exit;
    R7QResult.CompletedStages |= R7Q_ENROLLED;
    FltClose(read); read = NULL;
    R7QResult.CompletedStages |= R7Q_CALLER_READ_CLOSED;
    status = R7QProbe(metadata, metaFile, original, TRUE);
    if (!NT_SUCCESS(status)) goto Exit;
    R7QResult.CompletedStages |= R7Q_METADATA_DENIED;
    status = R7QProbe(control, controlFile, controlOriginal, FALSE);
    if (!NT_SUCCESS(status)) goto Exit;
    R7QResult.CompletedStages |= R7Q_CONTROL_USABLE;
    status = R7QOpen(&leaf, directory, FILE_WRITE_DATA | SYNCHRONIZE,
        shareAll, FILE_OPEN, FALSE, &writer, NULL);
    if (status != STATUS_SHARING_VIOLATION) { status = STATUS_DATA_ERROR; goto Exit; }
    R7QResult.CompletedStages |= R7Q_RETAINED_SHARE_DENIED;
    status = R7GateRetire(gate);
    if (!NT_SUCCESS(status)) goto Exit;
    gate = NULL; R7QResult.CompletedStages |= R7Q_RETIRED;
    status = R7QProbe(metadata, metaFile, original, FALSE);
    if (!NT_SUCCESS(status)) goto Exit;
    status = R7QOpen(&leaf, directory, FILE_WRITE_DATA | SYNCHRONIZE,
        shareAll, FILE_OPEN, FALSE, &writer, NULL);
    if (!NT_SUCCESS(status)) goto Exit;
    R7QResult.CompletedStages |= R7Q_AFTER_RETIRE_PASSED;
Exit:
    if (gate != NULL) {
        retired = R7GateRetire(gate);
        if (retired != STATUS_SUCCESS) status = retired;
    }
    R7QProbeObject = NULL; R7QProbeThread = NULL;
    if (writer != NULL) FltClose(writer);
    if (read != NULL) FltClose(read);
    if (metaFile != NULL) ObDereferenceObject(metaFile);
    if (controlFile != NULL) ObDereferenceObject(controlFile);
    if (metadata != NULL) FltClose(metadata);
    if (control != NULL) FltClose(control);
    if (directory != NULL) FltClose(directory);
    if (root != NULL) FltClose(root);
    if (original != NULL) ExFreePoolWithTag(original, R7Q_TAG);
    if (controlOriginal != NULL) ExFreePoolWithTag(controlOriginal, R7Q_TAG);
    if (directoryName.Buffer != NULL) RtlFreeUnicodeString(&directoryName);
    FltObjectDereference(instance);
    if (status == STATUS_SUCCESS && R7QResult.CompletedStages != R7Q_ALL_STAGES)
        status = STATUS_DATA_ERROR;
    /* Linearization point for HISTORICAL test completion. Teardown winning
     * first refuses success. Teardown after this point does not rewrite the
     * finished experiment; this result asserts no continuing custody. */
    if (InterlockedCompareExchange(&R7QTerminal, 2, 0) != 0)
        status = STATUS_FLT_DELETING_OBJECT;
    R7QResult.Status = status;
    R7QResult.CausalPassCallbacks = (ULONG)R7QPass;
    R7QResult.CausalDeniedCallbacks = (ULONG)R7QDeny;
    PsTerminateSystemThread(STATUS_SUCCESS);
}

static NTSTATUS FLTAPI R7QConnect(PFLT_PORT client, PVOID serverCookie,
    PVOID context, ULONG contextSize, PVOID *cookie)
{
    UNREFERENCED_PARAMETER(serverCookie); UNREFERENCED_PARAMETER(context);
    if (contextSize != 0 || InterlockedCompareExchange(&R7QStopping, 0, 0))
        return STATUS_INVALID_PARAMETER;
    R7QClient = client; *cookie = NULL;
    return STATUS_SUCCESS;
}

static VOID FLTAPI R7QDisconnect(PVOID cookie)
{
    UNREFERENCED_PARAMETER(cookie);
    FltCloseClientPort(R7QFilter, &R7QClient);
}

static NTSTATUS FLTAPI R7QMessage(PVOID cookie, PVOID input, ULONG inputSize,
    PVOID output, ULONG outputSize, PULONG returned)
{
    R7Q_REQUEST request;
    HANDLE thread = NULL;
    PFLT_INSTANCE instance = NULL;
    OBJECT_ATTRIBUTES attributes;
    NTSTATUS status;
    UNREFERENCED_PARAMETER(cookie);
    *returned = 0;
    if (input == NULL || inputSize != sizeof(request) || output == NULL
        || outputSize != sizeof(R7QResult)) return STATUS_INVALID_PARAMETER;
    __try { RtlCopyMemory(&request, input, sizeof(request)); }
    __except (EXCEPTION_EXECUTE_HANDLER) { return GetExceptionCode(); }
    if (request.Version != R7Q_VERSION || request.Command != R7Q_RUN
        || request.Reserved[0] != 0 || request.Reserved[1] != 0)
        return STATUS_INVALID_PARAMETER;
    KeEnterCriticalRegion();
    if (!ExAcquireRundownProtection(&R7QMessages)) {
        KeLeaveCriticalRegion(); return STATUS_DELETE_PENDING;
    }
    if (InterlockedCompareExchange(&R7QStopping, 0, 0)
        || InterlockedCompareExchange(&R7QRunClaimed, 1, 0) != 0) {
        ExReleaseRundownProtection(&R7QMessages);
        KeLeaveCriticalRegion();
        return STATUS_INVALID_DEVICE_STATE;
    }
    status = STATUS_FLT_DELETING_OBJECT;
    if (ExAcquireRundownProtection(&R7QInstanceReads)) {
        instance = InterlockedCompareExchangePointer((PVOID volatile *)&R7QInstance, NULL, NULL);
        if (instance != NULL) status = FltObjectReference(instance);
        ExReleaseRundownProtection(&R7QInstanceReads);
    }
    if (!NT_SUCCESS(status)) {
        ExReleaseRundownProtection(&R7QMessages);
        KeLeaveCriticalRegion();
        return status;
    }
    InitializeObjectAttributes(&attributes, NULL, OBJ_KERNEL_HANDLE, NULL, NULL);
    status = PsCreateSystemThread(&thread, SYNCHRONIZE, &attributes, NULL, NULL, R7QWorker, instance);
    if (NT_SUCCESS(status)) {
        /* Join the THREAD, not an event signaled before the worker returns.
         * No timeout/disconnect can free job state while driver code runs. */
        status = ZwWaitForSingleObject(thread, FALSE, NULL);
        ZwClose(thread);
        if (status == STATUS_SUCCESS) {
            __try {
                RtlCopyMemory(output, &R7QResult, sizeof(R7QResult));
                *returned = sizeof(R7QResult);
            } __except (EXCEPTION_EXECUTE_HANDLER) { status = GetExceptionCode(); }
        }
    } else FltObjectDereference(instance);
    ExReleaseRundownProtection(&R7QMessages);
    KeLeaveCriticalRegion();
    return status;
}

static NTSTATUS FLTAPI R7QUnload(FLT_FILTER_UNLOAD_FLAGS flags)
{
    UNREFERENCED_PARAMETER(flags);
    InterlockedExchange(&R7QStopping, 1);
    if (R7QServer != NULL) FltCloseCommunicationPort(R7QServer);
    ExWaitForRundownProtectionRelease(&R7QAttachments);
    /* Includes the worker thread join. No lock is held across this wait. */
    ExWaitForRundownProtectionRelease(&R7QMessages);
    R7QCloseInstanceAdmission();
    FltUnregisterFilter(R7QFilter);
    return STATUS_SUCCESS;
}

DRIVER_INITIALIZE DriverEntry;
NTSTATUS DriverEntry(PDRIVER_OBJECT driver, PUNICODE_STRING registry)
{
    FLT_REGISTRATION registration = {0};
    PSECURITY_DESCRIPTOR security = NULL;
    OBJECT_ATTRIBUTES attributes;
    UNICODE_STRING portName = RTL_CONSTANT_STRING(R7Q_PORT_NAME);
    NTSTATUS status;
    ULONG i;
    UNREFERENCED_PARAMETER(registry);
    ExInitializeRundownProtection(&R7QMessages);
    ExInitializeRundownProtection(&R7QAttachments);
    ExInitializeRundownProtection(&R7QInstanceReads);
    R7QResult.Version = R7Q_VERSION; R7QResult.Size = sizeof(R7QResult);
    R7QResult.TestOnly = 1; R7QResult.Status = STATUS_UNSUCCESSFUL;
    for (i = 0; i < RTL_NUMBER_OF(R7QOperations); i++) {
        R7QOperations[i] = R7GateOperations[i];
        if (R7GateOperations[i].MajorFunction == IRP_MJ_OPERATION_END) break;
        R7QOperations[i].PreOperation = R7QPreOperation;
    }
    if (i == RTL_NUMBER_OF(R7QOperations)) return STATUS_INVALID_PARAMETER;
    registration.Size = sizeof(registration); registration.Version = FLT_REGISTRATION_VERSION;
    registration.ContextRegistration = R7GateContexts;
    registration.OperationRegistration = R7QOperations;
    registration.FilterUnloadCallback = R7QUnload;
    registration.InstanceSetupCallback = R7QSetup;
    registration.InstanceQueryTeardownCallback = R7QQueryTeardown;
    registration.InstanceTeardownStartCallback = R7QTeardownStart;
    status = FltRegisterFilter(driver, &registration, &R7QFilter);
    if (!NT_SUCCESS(status)) return status;
    status = FltBuildDefaultSecurityDescriptor(&security, FLT_PORT_ALL_ACCESS);
    if (!NT_SUCCESS(status)) goto Fail;
    InitializeObjectAttributes(&attributes, &portName,
        OBJ_KERNEL_HANDLE | OBJ_CASE_INSENSITIVE, NULL, security);
    status = FltCreateCommunicationPort(R7QFilter, &R7QServer, &attributes,
        NULL, R7QConnect, R7QDisconnect, R7QMessage, 1);
    FltFreeSecurityDescriptor(security);
    if (!NT_SUCCESS(status)) goto Fail;
    status = FltStartFiltering(R7QFilter);
    if (NT_SUCCESS(status)) {
        InterlockedExchange(&R7QFilteringStarted, 1);
        return STATUS_SUCCESS;
    }
    InterlockedExchange(&R7QStopping, 1);
    FltCloseCommunicationPort(R7QServer);
    ExWaitForRundownProtectionRelease(&R7QAttachments);
    ExWaitForRundownProtectionRelease(&R7QMessages);
Fail:
    FltUnregisterFilter(R7QFilter);
    return status;
}
