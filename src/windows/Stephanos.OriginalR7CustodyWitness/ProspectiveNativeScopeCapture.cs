using System.Buffers.Binary;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Stephanos.OriginalR7CustodyWitness;

// Read-only native producer preparation. A retained directory sharing guard
// binds its identity, NOT the child tree, old credentials, MDLs or re-entry.
internal sealed class ProspectiveNativeScopeCapture : IDisposable
{
    private readonly SafeFileHandle handle;
    private readonly ulong volume, low, high;
    private bool disposed;
    internal string ContextDigest { get; }
    internal string NativeIdentityDigest { get; }
    internal string ScopeBindingDigest { get; }
    internal bool ChildTreeWriteExclusionProven => false;
    internal bool ProductionSigningAuthorized => false;
    internal bool ProcessingClaimQuarantineAuthority => false;
    private ProspectiveNativeScopeCapture(SafeFileHandle h, FileId id, string context)
    {
        handle=h; volume=id.Volume; low=id.Low; high=id.High; ContextDigest=context;
        byte[] identity=new byte[24];
        BinaryPrimitives.WriteUInt64LittleEndian(identity.AsSpan(0,8),volume);
        BinaryPrimitives.WriteUInt64LittleEndian(identity.AsSpan(8,8),low);
        BinaryPrimitives.WriteUInt64LittleEndian(identity.AsSpan(16,8),high);
        NativeIdentityDigest=Hash(identity);
        ScopeBindingDigest=Hash(Encoding.UTF8.GetBytes("stephanos.prospective-native-scope.v1\0"+context+"\0"+NativeIdentityDigest));
    }
    internal static ProspectiveNativeScopeCapture Open(ProspectiveProcessingClaimContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if(!OperatingSystem.IsWindows())throw Held("WINDOWS_REQUIRED");
        SafeFileHandle h=CreateFileW(context.WorktreePath,0x00120001,1,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
        if(h.IsInvalid){h.Dispose();throw Held("READ_OPEN_REFUSED");}
        try {
            if(!Attributes(h,9,out AttributeTag a,8)||!Standard(h,1,out StandardInfo s,24)
                ||!Identity(h,18,out FileId id,24))throw Held("NATIVE_QUERY_FAILED");
            if((a.Attributes&0x400)!=0||(a.Attributes&0x10)==0||s.Directory!=1||s.DeletePending!=0
                ||s.Links!=1||(id.Low==0&&id.High==0))throw Held("ROOT_SHAPE_UNSUPPORTED");
            StringBuilder final=new(512),filesystem=new(32);
            uint length=GetFinalPathNameByHandleW(h,final,(uint)final.Capacity,0);
            if(length==0||length>=final.Capacity||!final.ToString().StartsWith(@"\\?\",StringComparison.Ordinal)
                ||!string.Equals(final.ToString()[4..],context.WorktreePath,StringComparison.OrdinalIgnoreCase))
                throw Held("FINAL_PATH_MISMATCH");
            if(!GetVolumeInformationByHandleW(h,IntPtr.Zero,0,out _,out _,out _,filesystem,(uint)filesystem.Capacity)
                ||filesystem.ToString()!="NTFS")throw Held("NTFS_REQUIRED");
            return new(h,id,context.ContextDigest);
        }catch{h.Dispose();throw;}
    }
    internal void VerifyRetainedIdentity()
    {
        if(disposed)throw new ObjectDisposedException(nameof(ProspectiveNativeScopeCapture));
        if(!Identity(handle,18,out FileId id,24)||id.Volume!=volume||id.Low!=low||id.High!=high
            ||!Standard(handle,1,out StandardInfo standard,24)||standard.DeletePending!=0||standard.Directory!=1
            ||!Attributes(handle,9,out AttributeTag attributes,8)||(attributes.Attributes&0x400)!=0)
            throw Held("RETAINED_IDENTITY_CHANGED");
    }
    public void Dispose(){if(!disposed){disposed=true;handle.Dispose();}}
    private static string Hash(byte[] b)=>Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();
    private static IOException Held(string code)=>new("PROSPECTIVE_NATIVE_SCOPE_"+code);
    [StructLayout(LayoutKind.Sequential)] private struct FileId {internal ulong Volume,Low,High;}
    [StructLayout(LayoutKind.Sequential)] private struct StandardInfo {internal long Allocation,EndOfFile;internal uint Links;internal byte DeletePending,Directory;}
    [StructLayout(LayoutKind.Sequential)] private struct AttributeTag {internal uint Attributes,Tag;}
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern SafeFileHandle CreateFileW(string name,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
    [DllImport("kernel32.dll",EntryPoint="GetFileInformationByHandleEx",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool Identity(SafeFileHandle h,int type,out FileId data,uint length);
    [DllImport("kernel32.dll",EntryPoint="GetFileInformationByHandleEx",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool Standard(SafeFileHandle h,int type,out StandardInfo data,uint length);
    [DllImport("kernel32.dll",EntryPoint="GetFileInformationByHandleEx",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool Attributes(SafeFileHandle h,int type,out AttributeTag data,uint length);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern uint GetFinalPathNameByHandleW(SafeFileHandle h,StringBuilder buffer,uint length,uint flags);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool GetVolumeInformationByHandleW(SafeFileHandle h,IntPtr volume,uint volumeLength,out uint serial,out uint component,out uint flags,StringBuilder filesystem,uint filesystemLength);
}
