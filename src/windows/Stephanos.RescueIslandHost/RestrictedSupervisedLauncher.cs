using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

internal static class RestrictedSupervisedLauncher
{
    private const uint DisableMaxPrivilege = 0x1;
    private const uint LuaToken = 0x4;
    private const uint StartfUseStdHandles = 0x100;
    private const uint CreateNoWindow = 0x08000000;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint HandleFlagInherit = 0x1;

    internal static int Run(string request, bool sourceProposal)
    {
        string executable = Environment.ProcessPath
            ?? throw new HostHeldException("ISLAND_HOST_RESTRICTED_LAUNCHER_UNAVAILABLE");
        if (!string.Equals(Path.GetFileName(executable), "Stephanos.RescueIslandHost.exe",
                StringComparison.OrdinalIgnoreCase))
            throw new HostHeldException("ISLAND_HOST_RESTRICTED_LAUNCHER_UNAVAILABLE");

        string sourceRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../.."));
        if (!Directory.Exists(Path.Combine(sourceRoot, ".git")))
            throw new HostHeldException("ISLAND_HOST_SOURCE_LAYOUT_INVALID");

        using var identity = WindowsIdentity.GetCurrent(TokenAccessLevels.Query
            | TokenAccessLevels.Duplicate | TokenAccessLevels.AssignPrimary
            | TokenAccessLevels.AdjustDefault | (TokenAccessLevels)0x100);
        if (identity.User is null
            || !new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator))
            throw new HostHeldException("ISLAND_HOST_RESTRICTED_LAUNCHER_CALLER_UNPROVEN");

        var administrators = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);
        byte[] sidBytes = new byte[administrators.BinaryLength];
        administrators.GetBinaryForm(sidBytes, 0);
        IntPtr sid = Marshal.AllocHGlobal(sidBytes.Length);
        try
        {
            Marshal.Copy(sidBytes, 0, sid, sidBytes.Length);
            var disabled = new[] { new SidAndAttributes { Sid = sid } };
            if (!CreateRestrictedToken(identity.AccessToken, DisableMaxPrivilege | LuaToken,
                    1, disabled, 0, IntPtr.Zero, 0, IntPtr.Zero, out var reduced))
                throw new HostHeldException("ISLAND_HOST_RESTRICTED_TOKEN_CREATION_FAILED");
            using (reduced)
            {
                PreparePrivateTokenObjects(reduced, identity.User);
                using var desktop = new PrivateDesktop(identity);
                return RunChild(reduced, executable, sourceRoot, desktop.Name, request, sourceProposal);
            }
        }
        finally
        {
            Marshal.FreeHGlobal(sid);
        }
    }

    private static int RunChild(SafeAccessTokenHandle token, string executable, string sourceRoot,
        string desktop, string request, bool sourceProposal)
    {
        var inheritable = new SecurityAttributes { Length = Marshal.SizeOf<SecurityAttributes>(), Inherit = 1 };
        if (!CreatePipe(out IntPtr stdinRead, out IntPtr stdinWrite, ref inheritable, 0)
            || !CreatePipe(out IntPtr stdoutRead, out IntPtr stdoutWrite, ref inheritable, 0))
            throw new HostHeldException("ISLAND_HOST_RESTRICTED_PIPE_SETUP_FAILED");
        try
        {
            if (!SetHandleInformation(stdinWrite, HandleFlagInherit, 0)
                || !SetHandleInformation(stdoutRead, HandleFlagInherit, 0))
                throw new HostHeldException("ISLAND_HOST_RESTRICTED_PIPE_SETUP_FAILED");

            var startup = new StartupInfo
            {
                Size = Marshal.SizeOf<StartupInfo>(),
                Flags = StartfUseStdHandles,
                Desktop = desktop,
                StdInput = stdinRead,
                StdOutput = stdoutWrite,
                StdError = stdoutWrite,
            };
            var command = new StringBuilder(""" + executable + "" --supervised-once");
            if (!CreateProcessAsUserW(token, executable, command, IntPtr.Zero, IntPtr.Zero, true,
                    CreateNoWindow | CreateUnicodeEnvironment, IntPtr.Zero, sourceRoot,
                    ref startup, out var process))
                throw new HostHeldException("ISLAND_HOST_RESTRICTED_CHILD_START_FAILED");

            CloseHandle(stdinRead); stdinRead = IntPtr.Zero;
            CloseHandle(stdoutWrite); stdoutWrite = IntPtr.Zero;
            try
            {
                using (var inputHandle = new SafeFileHandle(stdinWrite, ownsHandle: true))
                using (var input = new FileStream(inputHandle, FileAccess.Write, 4096, isAsync: false))
                {
                    stdinWrite = IntPtr.Zero;
                    byte[] bytes = new UTF8Encoding(false, true).GetBytes(request);
                    if (bytes.Length == 0 || bytes.Length > 16384)
                        throw new HostHeldException("ISLAND_HOST_REQUEST_OVERSIZE");
                    input.Write(bytes, 0, bytes.Length);
                    input.Flush(true);
                }

                uint timeout = sourceProposal ? 330000u : 210000u;
                uint wait = WaitForSingleObject(process.Process, timeout);
                if (wait != 0)
                {
                    try
                    {
                        using var child = Process.GetProcessById((int)process.ProcessId);
                        child.Kill(entireProcessTree: true);
                        child.WaitForExit(10000);
                    }
                    catch { }
                    throw new HostHeldException("ISLAND_HOST_RESTRICTED_CHILD_TIMEOUT");
                }

                byte[] output;
                using (var outputHandle = new SafeFileHandle(stdoutRead, ownsHandle: true))
                using (var stream = new FileStream(outputHandle, FileAccess.Read, 4096, isAsync: false))
                {
                    stdoutRead = IntPtr.Zero;
                    using var memory = new MemoryStream();
                    byte[] buffer = new byte[4096];
                    while (true)
                    {
                        int read = stream.Read(buffer, 0, buffer.Length);
                        if (read == 0) break;
                        if (memory.Length + read > 131072)
                            throw new HostHeldException("ISLAND_HOST_RESTRICTED_CHILD_OUTPUT_BOUND");
                        memory.Write(buffer, 0, read);
                    }
                    output = memory.ToArray();
                }

                if (!GetExitCodeProcess(process.Process, out uint exitCode))
                    throw new HostHeldException("ISLAND_HOST_RESTRICTED_CHILD_EXIT_UNAVAILABLE");
                string text = new UTF8Encoding(false, true).GetString(output);
                Console.Write(text);
                return unchecked((int)exitCode);
            }
            finally
            {
                CloseHandle(process.Thread);
                CloseHandle(process.Process);
            }
        }
        finally
        {
            if (stdinRead != IntPtr.Zero) CloseHandle(stdinRead);
            if (stdinWrite != IntPtr.Zero) CloseHandle(stdinWrite);
            if (stdoutRead != IntPtr.Zero) CloseHandle(stdoutRead);
            if (stdoutWrite != IntPtr.Zero) CloseHandle(stdoutWrite);
        }
    }

    private static void PreparePrivateTokenObjects(SafeAccessTokenHandle reduced, SecurityIdentifier user)
    {
        if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
                "D:P(A;;GA;;;" + user.Value + ")(A;;GA;;;SY)", 1, out IntPtr descriptor, out _))
            throw new HostHeldException("ISLAND_HOST_RESTRICTED_TOKEN_SECURITY_FAILED");
        try
        {
            if (!GetSecurityDescriptorDacl(descriptor, out bool present, out IntPtr acl, out _)
                || !present || acl == IntPtr.Zero)
                throw new HostHeldException("ISLAND_HOST_RESTRICTED_TOKEN_SECURITY_FAILED");
            var defaults = new TokenDefaultDacl { Acl = acl };
            if (!SetTokenInformation(reduced, 6, ref defaults, Marshal.SizeOf<TokenDefaultDacl>())
                || !SetKernelObjectSecurity(reduced, 4, descriptor))
                throw new HostHeldException("ISLAND_HOST_RESTRICTED_TOKEN_SECURITY_FAILED");
        }
        finally
        {
            LocalFree(descriptor);
        }
    }

    private sealed class PrivateDesktop : IDisposable
    {
        private IntPtr station;
        private IntPtr desktop;
        private readonly IntPtr original;
        internal string Name { get; private set; } = "";

        internal PrivateDesktop(WindowsIdentity identity)
        {
            original = GetProcessWindowStation();
            if (original == IntPtr.Zero || identity.User is null)
                throw new HostHeldException("ISLAND_HOST_RESTRICTED_DESKTOP_FAILED");
            string suffix = "island-live-" + Guid.NewGuid().ToString("N");
            if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    "D:P(A;;GA;;;" + identity.User.Value + ")(A;;GA;;;SY)S:(ML;;NW;;;ME)",
                    1, out IntPtr descriptor, out _))
                throw new HostHeldException("ISLAND_HOST_RESTRICTED_DESKTOP_FAILED");
            try
            {
                var attributes = new SecurityAttributes {
                    Length = Marshal.SizeOf<SecurityAttributes>(), Descriptor = descriptor
                };
                station = CreateWindowStationW(suffix, 1, 0x000F037F, ref attributes);
                if (station == IntPtr.Zero || !SetProcessWindowStation(station))
                    throw new HostHeldException("ISLAND_HOST_RESTRICTED_DESKTOP_FAILED");
                try
                {
                    desktop = CreateDesktopW(suffix, IntPtr.Zero, IntPtr.Zero, 0, 0x000F01FF, ref attributes);
                    if (desktop == IntPtr.Zero)
                        throw new HostHeldException("ISLAND_HOST_RESTRICTED_DESKTOP_FAILED");
                    Name = suffix + "\\" + suffix;
                }
                finally
                {
                    if (!SetProcessWindowStation(original))
                        throw new HostHeldException("ISLAND_HOST_RESTRICTED_DESKTOP_FAILED");
                }
            }
            catch
            {
                Dispose();
                throw;
            }
            finally
            {
                LocalFree(descriptor);
            }
        }

        public void Dispose()
        {
            if (desktop != IntPtr.Zero) { CloseDesktop(desktop); desktop = IntPtr.Zero; }
            if (station != IntPtr.Zero) { CloseWindowStation(station); station = IntPtr.Zero; }
        }
    }

    [StructLayout(LayoutKind.Sequential)] private struct SidAndAttributes { public IntPtr Sid; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct TokenDefaultDacl { public IntPtr Acl; }
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes
    { public int Length; public IntPtr Descriptor; public int Inherit; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int Size; public string? Reserved; public string? Desktop; public string? Title;
        public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
        public ushort Show, ReservedSize; public IntPtr ReservedBytes, StdInput, StdOutput, StdError;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInfo
    { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }

    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateRestrictedToken(SafeAccessTokenHandle token, uint flags,
        uint disableCount, [In] SidAndAttributes[] disable, uint deleteCount, IntPtr delete,
        uint restrictCount, IntPtr restrict, out SafeAccessTokenHandle result);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcessAsUserW(SafeAccessTokenHandle token, string application,
        StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit,
        uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInfo process);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetTokenInformation(SafeAccessTokenHandle token, int kind,
        ref TokenDefaultDacl buffer, int length);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(
        string value, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetSecurityDescriptorDacl(IntPtr descriptor,
        [MarshalAs(UnmanagedType.Bool)] out bool present, out IntPtr acl,
        [MarshalAs(UnmanagedType.Bool)] out bool defaulted);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetKernelObjectSecurity(SafeAccessTokenHandle handle,
        uint information, IntPtr descriptor);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreatePipe(out IntPtr readPipe, out IntPtr writePipe,
        ref SecurityAttributes attributes, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr value);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetProcessWindowStation(IntPtr value);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowStationW(string name, uint flags, uint access,
        ref SecurityAttributes attributes);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateDesktopW(string name, IntPtr device, IntPtr mode,
        uint flags, uint access, ref SecurityAttributes attributes);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseDesktop(IntPtr handle);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseWindowStation(IntPtr handle);
}
