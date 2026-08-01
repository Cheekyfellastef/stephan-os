[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Publish', 'DeleteOwned', 'PromoteOwned', 'EnsureDirectory')]
    [string]$Mode,

    [Parameter(Mandatory = $true)]
    [string]$ParentPath,

    [Parameter(Mandatory = $true)]
    [string]$ArtifactName,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')]
    [string]$Token,

    [ValidatePattern('^[a-f0-9:]*$')]
    [string]$ExpectedOwnershipToken = '',

    [string]$PendingName = '',

    [ValidatePattern('^[A-Za-z0-9+/=]*$')]
    [string]$AncestorPathsBase64 = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

if (-not ('StephanosDreamArtifactIo' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class StephanosDreamArtifactIo {
    [StructLayout(LayoutKind.Sequential)]
    private struct BY_HANDLE_FILE_INFORMATION {
        public uint FileAttributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct UNICODE_STRING {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct OBJECT_ATTRIBUTES {
        public int Length;
        public IntPtr RootDirectory;
        public IntPtr ObjectName;
        public uint Attributes;
        public IntPtr SecurityDescriptor;
        public IntPtr SecurityQualityOfService;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_STATUS_BLOCK {
        public IntPtr Status;
        public UIntPtr Information;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FILE_DISPOSITION_INFO {
        [MarshalAs(UnmanagedType.Bool)]
        public bool DeleteFile;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(
        string name,
        uint access,
        uint share,
        IntPtr security,
        uint creation,
        uint flags,
        IntPtr template
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(
        SafeFileHandle handle,
        out BY_HANDLE_FILE_INFORMATION info
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool WriteFile(
        SafeFileHandle handle,
        byte[] buffer,
        uint bytesToWrite,
        out uint bytesWritten,
        IntPtr overlapped
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FlushFileBuffers(SafeFileHandle handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetFileInformationByHandle(
        SafeFileHandle handle,
        int fileInformationClass,
        ref FILE_DISPOSITION_INFO info,
        uint size
    );

    [DllImport("ntdll.dll")]
    private static extern int NtSetInformationFile(
        SafeFileHandle handle,
        out IO_STATUS_BLOCK ioStatusBlock,
        IntPtr fileInformation,
        uint length,
        int fileInformationClass
    );

    [DllImport("ntdll.dll")]
    private static extern int NtCreateFile(
        out IntPtr fileHandle,
        uint desiredAccess,
        ref OBJECT_ATTRIBUTES objectAttributes,
        out IO_STATUS_BLOCK ioStatusBlock,
        IntPtr allocationSize,
        uint fileAttributes,
        uint shareAccess,
        uint createDisposition,
        uint createOptions,
        IntPtr eaBuffer,
        uint eaLength
    );

    [DllImport("ntdll.dll")]
    private static extern uint RtlNtStatusToDosError(int status);

    private const uint ShareAll = 1 | 2 | 4;
    private const uint ShareRead = 1;
    private const uint OpenExisting = 3;
    private const uint BackupSemantics = 0x02000000;
    private const uint OpenReparsePoint = 0x00200000;
    private const uint Directory = 0x10;
    private const uint ReparsePoint = 0x400;
    private const uint GenericWrite = 0x40000000;
    private const uint DeleteAccess = 0x00010000;
    private const uint ReadAttributes = 0x00000080;
    private const uint Synchronize = 0x00100000;
    private const uint ObjectCaseInsensitive = 0x00000040;
    private const uint FileCreate = 2;
    private const uint FileOpen = 1;
    private const uint FileOpenIf = 3;
    private const uint FileDirectory = 0x00000001;
    private const uint FileNonDirectory = 0x00000040;
    private const uint FileSynchronousIoNonAlert = 0x00000020;
    private const uint FileOpenReparsePoint = 0x00200000;
    private const uint FileAttributeNormal = 0x00000080;

    private static BY_HANDLE_FILE_INFORMATION ReadInfo(SafeFileHandle handle, bool requireDirectory) {
        BY_HANDLE_FILE_INFORMATION info;
        if (!GetFileInformationByHandle(handle, out info)) {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        if ((info.FileAttributes & ReparsePoint) != 0) {
            throw new InvalidOperationException("DREAM_MIGRATION_REPARSE_ENTRY_BLOCKED");
        }
        if (requireDirectory && (info.FileAttributes & Directory) == 0) {
            throw new InvalidOperationException("DREAM_MIGRATION_ANCESTOR_UNSUPPORTED");
        }
        if (!requireDirectory && (info.FileAttributes & Directory) != 0) {
            throw new InvalidOperationException("DREAM_MIGRATION_ENTRY_UNSUPPORTED");
        }
        if (!requireDirectory && info.NumberOfLinks != 1) {
            throw new InvalidOperationException("DREAM_MIGRATION_HARD_LINK_BLOCKED");
        }
        return info;
    }

    private static string Identity(BY_HANDLE_FILE_INFORMATION info) {
        return info.VolumeSerialNumber.ToString("x8")
            + ":" + info.FileIndexHigh.ToString("x8")
            + info.FileIndexLow.ToString("x8")
            + ":" + info.FileSizeHigh.ToString("x8")
            + info.FileSizeLow.ToString("x8")
            + ":" + ((uint)info.LastWriteTime.dwHighDateTime).ToString("x8")
            + ((uint)info.LastWriteTime.dwLowDateTime).ToString("x8")
            + ":" + info.NumberOfLinks.ToString("x8");
    }

    public static SafeFileHandle OpenValidatedParent(string path) {
        string before = ReadPathIdentity(path);
        var handle = CreateFile(
            path,
            0,
            ShareAll,
            IntPtr.Zero,
            OpenExisting,
            BackupSemantics | OpenReparsePoint,
            IntPtr.Zero
        );
        if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            string opened = Identity(ReadInfo(handle, true));
            string after = ReadPathIdentity(path);
            if (!String.Equals(before, opened, StringComparison.Ordinal)
                || !String.Equals(opened, after, StringComparison.Ordinal)) {
                throw new InvalidOperationException("DREAM_MIGRATION_ANCESTOR_CHANGED");
            }
            return handle;
        } catch {
            handle.Dispose();
            throw;
        }
    }

    public static string ReadPathIdentity(string path) {
        using (var handle = CreateFile(
            path,
            0,
            ShareAll,
            IntPtr.Zero,
            OpenExisting,
            BackupSemantics | OpenReparsePoint,
            IntPtr.Zero
        )) {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            return Identity(ReadInfo(handle, true));
        }
    }

    private static SafeFileHandle OpenRelative(
        SafeFileHandle parent,
        string name,
        uint desiredAccess,
        uint disposition,
        uint share,
        uint createOptions
    ) {
        IntPtr nameBuffer = Marshal.StringToHGlobalUni(name);
        IntPtr unicodePointer = IntPtr.Zero;
        try {
            var unicode = new UNICODE_STRING {
                Length = checked((ushort)(name.Length * 2)),
                MaximumLength = checked((ushort)((name.Length + 1) * 2)),
                Buffer = nameBuffer
            };
            unicodePointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(UNICODE_STRING)));
            Marshal.StructureToPtr(unicode, unicodePointer, false);
            var attributes = new OBJECT_ATTRIBUTES {
                Length = Marshal.SizeOf(typeof(OBJECT_ATTRIBUTES)),
                RootDirectory = parent.DangerousGetHandle(),
                ObjectName = unicodePointer,
                Attributes = ObjectCaseInsensitive,
                SecurityDescriptor = IntPtr.Zero,
                SecurityQualityOfService = IntPtr.Zero
            };
            IO_STATUS_BLOCK ioStatus;
            IntPtr rawHandle;
            int status = NtCreateFile(
                out rawHandle,
                desiredAccess,
                ref attributes,
                out ioStatus,
                IntPtr.Zero,
                FileAttributeNormal,
                share,
                disposition,
                createOptions | FileSynchronousIoNonAlert | FileOpenReparsePoint,
                IntPtr.Zero,
                0
            );
            if (status < 0) throw new Win32Exception((int)RtlNtStatusToDosError(status));
            return new SafeFileHandle(rawHandle, true);
        } finally {
            if (unicodePointer != IntPtr.Zero) Marshal.FreeHGlobal(unicodePointer);
            Marshal.FreeHGlobal(nameBuffer);
        }
    }

    public static SafeFileHandle CreateRelativeExclusive(SafeFileHandle parent, string name) {
        return OpenRelative(
            parent,
            name,
            GenericWrite | DeleteAccess | ReadAttributes | Synchronize,
            FileCreate,
            ShareRead,
            FileNonDirectory
        );
    }

    public static SafeFileHandle OpenRelativeForDelete(SafeFileHandle parent, string name) {
        return OpenRelative(
            parent,
            name,
            DeleteAccess | ReadAttributes | Synchronize,
            FileOpen,
            ShareRead,
            FileNonDirectory
        );
    }

    public static SafeFileHandle EnsureRelativeDirectory(SafeFileHandle parent, string name) {
        var handle = OpenRelative(
            parent,
            name,
            ReadAttributes | Synchronize,
            FileOpenIf,
            ShareAll,
            FileDirectory
        );
        try {
            ReadInfo(handle, true);
            return handle;
        } catch {
            handle.Dispose();
            throw;
        }
    }

    public static void RenameRelativeNoReplace(
        SafeFileHandle artifact,
        SafeFileHandle parent,
        string destinationName
    ) {
        byte[] nameBytes = System.Text.Encoding.Unicode.GetBytes(destinationName);
        int handleOffset = IntPtr.Size == 8 ? 8 : 4;
        int lengthOffset = handleOffset + IntPtr.Size;
        int nameOffset = lengthOffset + 4;
        byte[] buffer = new byte[nameOffset + nameBytes.Length + 2];
        if (IntPtr.Size == 8) {
            Buffer.BlockCopy(BitConverter.GetBytes(parent.DangerousGetHandle().ToInt64()), 0, buffer, handleOffset, 8);
        } else {
            Buffer.BlockCopy(BitConverter.GetBytes(parent.DangerousGetHandle().ToInt32()), 0, buffer, handleOffset, 4);
        }
        Buffer.BlockCopy(BitConverter.GetBytes((uint)nameBytes.Length), 0, buffer, lengthOffset, 4);
        Buffer.BlockCopy(nameBytes, 0, buffer, nameOffset, nameBytes.Length);
        var pinned = GCHandle.Alloc(buffer, GCHandleType.Pinned);
        try {
            IO_STATUS_BLOCK ioStatus;
            int status = NtSetInformationFile(
                artifact,
                out ioStatus,
                pinned.AddrOfPinnedObject(),
                (uint)buffer.Length,
                10
            );
            if (status < 0) throw new Win32Exception((int)RtlNtStatusToDosError(status));
        } finally {
            pinned.Free();
        }
    }

    public static string ReadOwnedIdentity(SafeFileHandle handle) {
        return Identity(ReadInfo(handle, false));
    }

    public static string ReadDirectoryIdentity(SafeFileHandle handle) {
        return Identity(ReadInfo(handle, true));
    }

    public static void WriteAndFlush(SafeFileHandle handle, byte[] bytes) {
        uint written;
        if (!WriteFile(handle, bytes, checked((uint)bytes.Length), out written, IntPtr.Zero)) {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        if (written != bytes.Length) throw new InvalidOperationException("DREAM_MIGRATION_SHORT_WRITE");
        if (!FlushFileBuffers(handle)) throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    public static void DeleteByHandle(SafeFileHandle handle) {
        var disposition = new FILE_DISPOSITION_INFO { DeleteFile = true };
        if (!SetFileInformationByHandle(
            handle,
            4,
            ref disposition,
            (uint)Marshal.SizeOf(typeof(FILE_DISPOSITION_INFO))
        )) {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }
}
'@
}

function Assert-SafeArtifactName {
    param([string]$Value)
    $invalid = [string]::IsNullOrWhiteSpace($Value)
    $invalid = $invalid -or $Value -eq '.' -or $Value -eq '..'
    $invalid = $invalid -or [System.IO.Path]::IsPathRooted($Value)
    $invalid = $invalid -or $Value.IndexOf([System.IO.Path]::DirectorySeparatorChar) -ge 0
    $invalid = $invalid -or $Value.IndexOf([System.IO.Path]::AltDirectorySeparatorChar) -ge 0
    $invalid = $invalid -or $Value.IndexOf([char]0) -ge 0
    $invalid = $invalid -or -not [string]::Equals(
        [System.IO.Path]::GetFileName($Value),
        $Value,
        [System.StringComparison]::Ordinal
    )
    if ($invalid) {
        throw 'DREAM_MIGRATION_ARTIFACT_NAME_INVALID'
    }
}

function Assert-BoundedPendingName {
    param(
        [string]$Value,
        [string]$FinalName
    )
    Assert-SafeArtifactName -Value $Value
    $prefix = '.stephanos-pending-'
    $suffix = "-$FinalName"
    if (-not $Value.StartsWith($prefix, [System.StringComparison]::Ordinal) -or
        -not $Value.EndsWith($suffix, [System.StringComparison]::Ordinal)) {
        throw 'DREAM_MIGRATION_PENDING_NAME_INVALID'
    }
    $identity = $Value.Substring($prefix.Length, $Value.Length - $prefix.Length - $suffix.Length)
    $parsed = [Guid]::Empty
    if (-not [Guid]::TryParseExact($identity, 'D', [ref]$parsed)) {
        throw 'DREAM_MIGRATION_PENDING_NAME_INVALID'
    }
}

try {
    Assert-SafeArtifactName -Value $ArtifactName
    $resolvedParent = [System.IO.Path]::GetFullPath($ParentPath)
    if (-not [System.IO.Directory]::Exists($resolvedParent)) {
        throw 'DREAM_MIGRATION_ARTIFACT_PARENT_MISSING'
    }
    $ancestorHandles = [System.Collections.Generic.List[Microsoft.Win32.SafeHandles.SafeFileHandle]]::new()
    $ancestorPaths = @()
    if (-not [string]::IsNullOrWhiteSpace($AncestorPathsBase64)) {
        $ancestorJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($AncestorPathsBase64))
        $ancestorPaths = @($ancestorJson | ConvertFrom-Json)
    }
    foreach ($ancestorPath in $ancestorPaths) {
        $resolvedAncestor = [System.IO.Path]::GetFullPath([string]$ancestorPath)
        $ancestorHandles.Add([StephanosDreamArtifactIo]::OpenValidatedParent($resolvedAncestor))
    }
    function Assert-AncestorChainUnchanged {
        for ($index = 0; $index -lt $ancestorPaths.Count; $index += 1) {
            $openedIdentity = [StephanosDreamArtifactIo]::ReadDirectoryIdentity($ancestorHandles[$index])
            $pathIdentity = [StephanosDreamArtifactIo]::ReadPathIdentity([System.IO.Path]::GetFullPath([string]$ancestorPaths[$index]))
            if (-not [string]::Equals($openedIdentity, $pathIdentity, [System.StringComparison]::Ordinal)) {
                throw 'DREAM_MIGRATION_ANCESTOR_CHANGED'
            }
        }
    }
    Assert-AncestorChainUnchanged
    $parent = [StephanosDreamArtifactIo]::OpenValidatedParent($resolvedParent)
    try {
        if ($Mode -eq 'EnsureDirectory') {
            $directory = [StephanosDreamArtifactIo]::EnsureRelativeDirectory($parent, $ArtifactName)
            try {
                $directoryIdentity = [StephanosDreamArtifactIo]::ReadDirectoryIdentity($directory)
                [Console]::Out.WriteLine("DIRECTORY_READY:$Token`:$directoryIdentity")
                [Console]::Out.Flush()
            } finally {
                $directory.Dispose()
            }
            exit 0
        }

        if ($Mode -eq 'DeleteOwned') {
            if ([string]::IsNullOrWhiteSpace($ExpectedOwnershipToken)) {
                throw 'DREAM_MIGRATION_OWNERSHIP_TOKEN_REQUIRED'
            }
            $artifact = [StephanosDreamArtifactIo]::OpenRelativeForDelete($parent, $ArtifactName)
            try {
                $observed = [StephanosDreamArtifactIo]::ReadOwnedIdentity($artifact)
                if (-not [string]::Equals($observed, $ExpectedOwnershipToken, [System.StringComparison]::Ordinal)) {
                    throw 'DREAM_MIGRATION_OWNERSHIP_IDENTITY_CHANGED'
                }
                [StephanosDreamArtifactIo]::DeleteByHandle($artifact)
            } finally {
                $artifact.Dispose()
            }
            [Console]::Out.WriteLine("DELETED:$Token")
            [Console]::Out.Flush()
            exit 0
        }

        if ($Mode -eq 'PromoteOwned') {
            if ([string]::IsNullOrWhiteSpace($ExpectedOwnershipToken)) {
                throw 'DREAM_MIGRATION_OWNERSHIP_TOKEN_REQUIRED'
            }
            Assert-BoundedPendingName -Value $PendingName -FinalName $ArtifactName
            $pending = [StephanosDreamArtifactIo]::OpenRelativeForDelete($parent, $PendingName)
            $renamed = $false
            try {
                $observed = [StephanosDreamArtifactIo]::ReadOwnedIdentity($pending)
                if (-not [string]::Equals($observed, $ExpectedOwnershipToken, [System.StringComparison]::Ordinal)) {
                    throw 'DREAM_MIGRATION_OWNERSHIP_IDENTITY_CHANGED'
                }
                Assert-AncestorChainUnchanged
                [StephanosDreamArtifactIo]::RenameRelativeNoReplace($pending, $parent, $ArtifactName)
                $renamed = $true
                Assert-AncestorChainUnchanged
                $promoted = [StephanosDreamArtifactIo]::ReadOwnedIdentity($pending)
                if (-not [string]::Equals($observed, $promoted, [System.StringComparison]::Ordinal)) {
                    throw 'DREAM_MIGRATION_OWNERSHIP_IDENTITY_CHANGED'
                }
            } catch {
                if ($renamed) {
                    try { [StephanosDreamArtifactIo]::DeleteByHandle($pending) } catch {}
                }
                throw
            } finally {
                $pending.Dispose()
            }
            [Console]::Out.WriteLine("PROMOTED:$Token")
            [Console]::Out.Flush()
            exit 0
        }

        $encoded = [Console]::In.ReadLine()
        if ($null -eq $encoded -or $encoded.Length -gt 89478488) {
            throw 'DREAM_MIGRATION_WINDOWS_ARTIFACT_INPUT_INVALID'
        }
        $bytes = [Convert]::FromBase64String($encoded)
        if ($bytes.Length -gt 67108864) {
            throw 'DREAM_MIGRATION_WINDOWS_ARTIFACT_TOO_LARGE'
        }
        $stagingName = ".stephanos-pending-$Token-$ArtifactName"
        Assert-BoundedPendingName -Value $stagingName -FinalName $ArtifactName
        $artifact = [StephanosDreamArtifactIo]::CreateRelativeExclusive($parent, $stagingName)
        $committed = $false
        $deleted = $false
        try {
            [StephanosDreamArtifactIo]::WriteAndFlush($artifact, $bytes)
            $ownership = [StephanosDreamArtifactIo]::ReadOwnedIdentity($artifact)
            [Console]::Out.WriteLine("READY:$Token`:$ownership")
            [Console]::Out.Flush()
            $command = [Console]::In.ReadLine()
            if ([string]::Equals($command, 'COMMIT', [System.StringComparison]::Ordinal)) {
                Assert-AncestorChainUnchanged
                [StephanosDreamArtifactIo]::RenameRelativeNoReplace($artifact, $parent, $ArtifactName)
                $committed = $true
                try {
                    Assert-AncestorChainUnchanged
                } catch {
                    [StephanosDreamArtifactIo]::DeleteByHandle($artifact)
                    $deleted = $true
                    $committed = $false
                    throw
                }
                [Console]::Out.WriteLine("COMMITTED:$Token")
                [Console]::Out.Flush()
            } else {
                [StephanosDreamArtifactIo]::DeleteByHandle($artifact)
                $deleted = $true
                [Console]::Out.WriteLine("ABORTED:$Token")
                [Console]::Out.Flush()
            }
        } finally {
            if (-not $committed -and -not $deleted) {
                try {
                    [StephanosDreamArtifactIo]::DeleteByHandle($artifact)
                    $deleted = $true
                    [Console]::Out.WriteLine("ABORTED:$Token")
                    [Console]::Out.Flush()
                } catch {}
            }
            $artifact.Dispose()
        }
    } finally {
        $parent.Dispose()
        foreach ($ancestorHandle in $ancestorHandles) { $ancestorHandle.Dispose() }
    }
} catch {
    $failure = $_.Exception
    while ($null -ne $failure.InnerException) { $failure = $failure.InnerException }
    $isCollision = $failure -is [System.ComponentModel.Win32Exception]
    $isCollision = $isCollision -and $failure.NativeErrorCode -in @(80, 183)
    if ($isCollision) {
        [Console]::Error.WriteLine('EEXIST')
    } elseif ($failure -is [System.ComponentModel.Win32Exception]) {
        [Console]::Error.WriteLine("DREAM_RUNTIME_ARTIFACT_IO_FAILED:$($failure.NativeErrorCode)")
    } else {
        [Console]::Error.WriteLine('DREAM_RUNTIME_ARTIFACT_IO_FAILED')
    }
    [Console]::Error.Flush()
    exit 2
}
