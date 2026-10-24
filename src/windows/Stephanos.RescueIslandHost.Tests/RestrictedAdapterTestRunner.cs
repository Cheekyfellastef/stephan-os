using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Security.AccessControl;
using System.Text;
using Microsoft.Win32.SafeHandles;
using Stephanos.RescueIslandCustody;

// TEST EXECUTABLE ONLY: hosted Windows runners have administrative tokens.
// Launch exactly the checked-in adapter suite under a reduced copy of THIS
// token. No account, policy, existing ACL, credential, service or production
// admission is changed. Private test UI objects are disposed after the child.
// The production observer must independently accept the child.
internal static class RestrictedAdapterTestRunner
{
    internal static int Run()
    {
        string root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../.."));
        string suite = Path.Combine(root, "shared", "agents", "rescueIslandSupervisedHostV1.windows.mjs");
        string node = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
        if (!Directory.Exists(Path.Combine(root, ".git")) || !File.Exists(suite) || !File.Exists(node))
            throw new Exception("ADAPTER_TEST_SOURCE_LAYOUT_INVALID");
        // LUA_TOKEN + DISABLE_MAX_PRIVILEGE, never SANDBOX_INERT. The new
        // token cannot add rights. See Microsoft CreateRestrictedToken and
        // CreateProcessAsUserW documentation; it is a restricted copy of the
        // caller, so no account logon or new credential is involved.
        using var identity = WindowsIdentity.GetCurrent(TokenAccessLevels.Query | TokenAccessLevels.Duplicate
            | TokenAccessLevels.AssignPrimary | TokenAccessLevels.AdjustDefault | (TokenAccessLevels)0x40000);
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
                PreparePrivateTokenObjects(reduced, identity.User!);
                using var desktop = new AdapterTestDesktop(identity);
                string log = Path.Combine(AppContext.BaseDirectory, "island-adapter-ci-" + Guid.NewGuid().ToString("N") + ".log");
                using var output = new FileStream(log, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.ReadWrite | FileShare.Inheritable);
                // STARTF_USESTDHANDLES requires all three valid inheritable
                // handles. The fixed suite receives a retained empty input file.
                using var input = new FileStream(log + ".stdin", FileMode.CreateNew, FileAccess.ReadWrite, FileShare.ReadWrite | FileShare.Inheritable);
                var startup = new StartupInfo { Size = Marshal.SizeOf<StartupInfo>(), Flags = 0x100, Desktop = desktop.Name,
                    StdInput = input.SafeFileHandle.DangerousGetHandle(),
                    StdOutput = output.SafeFileHandle.DangerousGetHandle(), StdError = output.SafeFileHandle.DangerousGetHandle() };
                var command = new StringBuilder("\"" + node + "\" --test --test-concurrency=1 \"" + suite + "\"");
                if (!CreateProcessAsUserW(reduced, node, command, IntPtr.Zero, IntPtr.Zero, true, 0x08004000,
                    IntPtr.Zero, root, ref startup, out var process))
                    throw new Exception("ADAPTER_TEST_RESTRICTED_CHILD_FAILED:" + Marshal.GetLastWin32Error());
                try
                {
                    Console.WriteLine("ISLAND_ADAPTER_TEST_RESTRICTED_CHILD_PID=" + process.ProcessId);
                    uint wait = WaitForSingleObject(process.Process, 180000);
                    if (wait != 0)
                    {
                        // Only the exact child created above and its descendants.
                        using var owned = Process.GetProcessById((int)process.ProcessId);
                        owned.Kill(entireProcessTree: true); owned.WaitForExit(10000);
                        throw new Exception("ADAPTER_TEST_TIMEOUT");
                    }
                    if (!GetExitCodeProcess(process.Process, out uint exitCode)) throw new Exception("ADAPTER_TEST_EXIT_UNAVAILABLE");
                    Console.WriteLine("ISLAND_ADAPTER_TEST_CHILD_EXIT=0x" + exitCode.ToString("X8"));
                    return unchecked((int)exitCode);
                }
                finally
                {
                    output.Flush();
                    output.Position = 0;
                    using var reader = new StreamReader(output, Encoding.UTF8, leaveOpen: true);
                    Console.Write(reader.ReadToEnd());
                    CloseHandle(process.Thread); CloseHandle(process.Process);
                }
            }
        }
        finally { Marshal.FreeHGlobal(sid); }
    }

    // Some service tokens default new objects to Administrators/SYSTEM only.
    // Once Administrators becomes deny-only, that default can exclude the
    // child from its OWN token, processes, threads and newly created files.
    // Give only this user and SYSTEM access to the NEW restricted token and
    // its future objects. Never edit the caller token or an existing estate.
    private static void PreparePrivateTokenObjects(SafeAccessTokenHandle reduced, SecurityIdentifier user)
    {
        GetTokenInformation(reduced, 6, IntPtr.Zero, 0, out int size);
        if (size < IntPtr.Size || size > 65536) throw new Exception("ADAPTER_TEST_DEFAULT_DACL_SIZE_INVALID");
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            if (!GetTokenInformation(reduced, 6, buffer, size, out _))
                throw new Exception("ADAPTER_TEST_DEFAULT_DACL_READ_FAILED:" + Marshal.GetLastWin32Error());
            IntPtr acl = Marshal.ReadIntPtr(buffer);
            bool allowsUser = false;
            if (acl != IntPtr.Zero)
            {
                int bytes = (ushort)Marshal.ReadInt16(acl, 2);
                if (bytes < 8 || bytes > 65535) throw new Exception("ADAPTER_TEST_DEFAULT_DACL_INVALID");
                byte[] copy = new byte[bytes]; Marshal.Copy(acl, copy, 0, bytes);
                allowsUser = new RawAcl(copy, 0).OfType<CommonAce>().Any(a => a.AceQualifier == AceQualifier.AccessAllowed && a.SecurityIdentifier == user);
            }
            Console.WriteLine("ISLAND_ADAPTER_TEST_PRIOR_DEFAULT_DACL_EXPLICIT_USER_ALLOW=" + allowsUser);
        }
        finally { Marshal.FreeHGlobal(buffer); }
        if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
            "D:P(A;;GA;;;" + user.Value + ")(A;;GA;;;SY)", 1, out var descriptor, out _))
            throw new Exception("ADAPTER_TEST_TOKEN_DESCRIPTOR_FAILED:" + Marshal.GetLastWin32Error());
        try
        {
            if (!GetSecurityDescriptorDacl(descriptor, out bool present, out IntPtr acl, out _) || !present || acl == IntPtr.Zero)
                throw new Exception("ADAPTER_TEST_TOKEN_DACL_UNAVAILABLE");
            var defaults = new TokenDefaultDacl { Acl = acl };
            if (!SetTokenInformation(reduced, 6, ref defaults, Marshal.SizeOf<TokenDefaultDacl>())
                || !SetKernelObjectSecurity(reduced, 4, descriptor))
                throw new Exception("ADAPTER_TEST_PRIVATE_TOKEN_SECURITY_FAILED:" + Marshal.GetLastWin32Error());
        }
        finally { LocalFree(descriptor); }
    }

    [StructLayout(LayoutKind.Sequential)] private struct TokenDefaultDacl { public IntPtr Acl; }
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetTokenInformation(SafeAccessTokenHandle token, int kind, IntPtr buffer, int length, out int returned);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetTokenInformation(SafeAccessTokenHandle token, int kind, ref TokenDefaultDacl buffer, int length);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetSecurityDescriptorDacl(IntPtr descriptor, [MarshalAs(UnmanagedType.Bool)] out bool present,
        out IntPtr acl, [MarshalAs(UnmanagedType.Bool)] out bool defaulted);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetKernelObjectSecurity(SafeAccessTokenHandle handle, uint information, IntPtr descriptor);

    // Service-runner default desktops can exclude a LUA token and produce
    // STATUS_DLL_INIT_FAILED before Node starts. Never widen that existing
    // desktop's ACL. Use fresh, noninteractive test objects, accessible only
    // to this same user, with a medium mandatory label for the reduced child.
    private sealed class AdapterTestDesktop : IDisposable
    {
        private IntPtr station, desktop;
        public string Name { get; private set; } = "";
        public AdapterTestDesktop(WindowsIdentity identity)
        {
            string suffix = "island-test-" + Guid.NewGuid().ToString("N");
            IntPtr original = GetProcessWindowStation();
            if (original == IntPtr.Zero) throw new Exception("ADAPTER_TEST_STATION_UNAVAILABLE");
            if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
                "D:P(A;;GA;;;" + identity.User!.Value + ")(A;;GA;;;SY)S:(ML;;NW;;;ME)", 1, out var descriptor, out _))
                throw new Exception("ADAPTER_TEST_DESCRIPTOR_FAILED:" + Marshal.GetLastWin32Error());
            try
            {
                var attributes = new SecurityAttributes { Length = Marshal.SizeOf<SecurityAttributes>(), Descriptor = descriptor };
                string stationName;
                // Naming a fresh window station requires the caller's existing
                // administrator membership. Non-admin local proof needs only
                // a private desktop within its already accessible station.
                if (new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator))
                {
                    station = CreateWindowStationW(suffix, 1, 0x000F037F, ref attributes);
                    if (station == IntPtr.Zero) throw new Exception("ADAPTER_TEST_PRIVATE_STATION_FAILED:" + Marshal.GetLastWin32Error());
                    if (!SetProcessWindowStation(station)) throw new Exception("ADAPTER_TEST_STATION_SELECT_FAILED:" + Marshal.GetLastWin32Error());
                    stationName = suffix;
                }
                else
                {
                    var name = new StringBuilder(512);
                    if (!GetUserObjectInformationW(original, 2, name, 1024, out _))
                        throw new Exception("ADAPTER_TEST_STATION_NAME_FAILED:" + Marshal.GetLastWin32Error());
                    stationName = name.ToString();
                }
                try
                {
                    desktop = CreateDesktopW(suffix, IntPtr.Zero, IntPtr.Zero, 0, 0x000F01FF, ref attributes);
                    if (desktop == IntPtr.Zero) throw new Exception("ADAPTER_TEST_PRIVATE_DESKTOP_FAILED:" + Marshal.GetLastWin32Error());
                    Name = stationName + "\\" + suffix;
                }
                finally
                {
                    if (station != IntPtr.Zero && !SetProcessWindowStation(original))
                        throw new Exception("ADAPTER_TEST_STATION_RESTORE_FAILED:" + Marshal.GetLastWin32Error());
                }
                Console.WriteLine("ISLAND_ADAPTER_TEST_PRIVATE_DESKTOP=true;EXISTING_DESKTOP_ACL_CHANGED=false");
            }
            catch { Dispose(); throw; }
            finally { LocalFree(descriptor); }
        }
        public void Dispose()
        {
            if (desktop != IntPtr.Zero) { CloseDesktop(desktop); desktop = IntPtr.Zero; }
            if (station != IntPtr.Zero) { CloseWindowStation(station); station = IntPtr.Zero; }
        }
    }

    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes
    { public int Length; public IntPtr Descriptor; public int Inherit; }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string value, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr value);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetProcessWindowStation(IntPtr value);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowStationW(string name, uint flags, uint access, ref SecurityAttributes attributes);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateDesktopW(string name, IntPtr device, IntPtr mode, uint flags, uint access, ref SecurityAttributes attributes);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetUserObjectInformationW(IntPtr handle, int index, StringBuilder value, uint length, out uint needed);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseDesktop(IntPtr handle);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseWindowStation(IntPtr handle);

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
}
