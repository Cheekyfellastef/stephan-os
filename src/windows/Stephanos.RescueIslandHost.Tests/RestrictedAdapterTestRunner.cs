using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;
using Stephanos.RescueIslandCustody;

// TEST EXECUTABLE ONLY: hosted Windows runners have administrative tokens.
// Launch exactly the checked-in adapter suite under a reduced copy of THIS
// token. No account, policy, ACL, credential, service or production admission
// is changed. The production observer must independently accept the child.
internal static class RestrictedAdapterTestRunner
{
    internal static int Run()
    {
        string root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../.."));
        string suite = Path.Combine(root, "shared", "agents", "rescueIslandSupervisedHostV1.test.mjs");
        string node = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
        if (!Directory.Exists(Path.Combine(root, ".git")) || !File.Exists(suite) || !File.Exists(node))
            throw new Exception("ADAPTER_TEST_SOURCE_LAYOUT_INVALID");
        // LUA_TOKEN + DISABLE_MAX_PRIVILEGE, never SANDBOX_INERT. The new
        // token cannot add rights. See Microsoft CreateRestrictedToken and
        // CreateProcessAsUserW documentation; it is a restricted copy of the
        // caller, so no account logon or new credential is involved.
        using var identity = WindowsIdentity.GetCurrent(TokenAccessLevels.Query | TokenAccessLevels.Duplicate | TokenAccessLevels.AssignPrimary);
        var admin = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);
        byte[] sidBytes = new byte[admin.BinaryLength]; admin.GetBinaryForm(sidBytes, 0);
        IntPtr sid = Marshal.AllocHGlobal(sidBytes.Length);
        try
        {
            Marshal.Copy(sidBytes, 0, sid, sidBytes.Length);
            if (!CreateRestrictedToken(identity.AccessToken, 5, 1, [new() { Sid = sid }], 0, IntPtr.Zero, 0, IntPtr.Zero, out var reduced))
                throw new Exception("ADAPTER_TEST_RESTRICTED_TOKEN_FAILED:" + Marshal.GetLastWin32Error());
            using (reduced)
            {
                string log = Path.Combine(Path.GetTempPath(), "island-adapter-ci-" + Guid.NewGuid().ToString("N") + ".log");
                using var output = new FileStream(log, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.ReadWrite | FileShare.Inheritable);
                var startup = new StartupInfo { Size = Marshal.SizeOf<StartupInfo>(), Flags = 0x100,
                    StdOutput = output.SafeFileHandle.DangerousGetHandle(), StdError = output.SafeFileHandle.DangerousGetHandle() };
                var command = new StringBuilder("\"" + node + "\" --test --test-concurrency=1 \"" + suite + "\"");
                if (!CreateProcessAsUserW(reduced, node, command, IntPtr.Zero, IntPtr.Zero, true, 0x08004000,
                    IntPtr.Zero, root, ref startup, out var process))
                    throw new Exception("ADAPTER_TEST_RESTRICTED_CHILD_FAILED:" + Marshal.GetLastWin32Error());
                try
                {
                    uint wait = WaitForSingleObject(process.Process, 180000);
                    if (wait != 0) { TerminateProcess(process.Process, 124); throw new Exception("ADAPTER_TEST_TIMEOUT"); }
                    if (!GetExitCodeProcess(process.Process, out uint exitCode)) throw new Exception("ADAPTER_TEST_EXIT_UNAVAILABLE");
                    output.Flush();
                    Console.WriteLine("ISLAND_ADAPTER_TEST_RESTRICTED_CHILD_PID=" + process.ProcessId);
                    output.Position = 0;
                    using var reader = new StreamReader(output, Encoding.UTF8, leaveOpen: true);
                    Console.Write(reader.ReadToEnd());
                    return checked((int)exitCode);
                }
                finally { CloseHandle(process.Thread); CloseHandle(process.Process); }
            }
        }
        finally { Marshal.FreeHGlobal(sid); }
    }

    [StructLayout(LayoutKind.Sequential)] private struct SidAndAttributes { public IntPtr Sid; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int Size; public string? Reserved; public string? Desktop; public string? Title;
        public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
        public ushort Show, ReservedSize; public IntPtr ReservedBytes, StdInput, StdOutput, StdError;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInfo { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateRestrictedToken(SafeAccessTokenHandle token, uint flags, uint disableCount,
        [In] SidAndAttributes[] disable, uint deleteCount, IntPtr delete, uint restrictCount, IntPtr restrict, out SafeAccessTokenHandle result);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcessAsUserW(SafeAccessTokenHandle token, string application, StringBuilder command,
        IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory,
        ref StartupInfo startup, out ProcessInfo process);
    [DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TerminateProcess(IntPtr process, uint code);
}
