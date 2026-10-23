using Microsoft.Win32.SafeHandles;
using Stephanos.OriginalR7DaclReadback;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace Stephanos.OriginalR7CustodyWitness;

// A real, local OS authentication transaction for ONE displayed peer/run.
// It is neither a serialized receipt nor custody/lease authority. The distinct
// inactive-first-root decision authenticates only the displayed purpose; its
// in-process consumer still needs the exact protected signed source permit and
// continuous native creation custody before any key storage operation.
// SOURCE PREPARATION DOES NOT DISPLAY THIS DIALOG OR READ REAL CREDENTIALS.
internal sealed class OriginalR7OperatingSystemPeerDecision : IDisposable
{
    private readonly OriginalR7OwnerEnvelopeTransport session;
    private readonly OriginalR7OwnerPeerTranscript transcript;
    private readonly OriginalR7CommissioningOwnerObservation actor;
    private readonly SafeAccessTokenHandle authenticatedQuery;
    private readonly R7NativePrincipalStamp authenticatedStamp;
    private readonly long opened = Stopwatch.GetTimestamp();
    private int terminal;

    private OriginalR7OperatingSystemPeerDecision(OriginalR7OwnerEnvelopeTransport retainedSession,
        OriginalR7OwnerPeerTranscript actualTranscript, OriginalR7CommissioningOwnerObservation actualActor,
        SafeAccessTokenHandle actualQueryToken, R7NativePrincipalStamp stamp)
    { session = retainedSession; transcript = actualTranscript; actor = actualActor; authenticatedQuery = actualQueryToken; authenticatedStamp = stamp; }

    // Called only by a future admitted, fixed native ceremony. No injected
    // "consent", SID, token, provider callback or alternate prompt is accepted.
    // This first implementation supports current LOCAL SAM password operators;
    // domain/AAD/Hello/smartcard providers fail closed instead of falling back
    // to an insecure prompt or silently treating metadata as authentication.
    internal static OriginalR7OperatingSystemPeerDecision AuthenticateCurrentPeer(
        OriginalR7OwnerEnvelopeTransport retainedSession, string expectedMain, string runId, string runAttempt)
    {
        IntPtr auth = IntPtr.Zero;
        uint authBytes = 0;
        SafeAccessTokenHandle? query = null;
        bool completed = false;
        try
        {
            if (!OperatingSystem.IsWindows() || RuntimeInformation.ProcessArchitecture != Architecture.X64)
                throw Held();
            if (!FixedNativeModulesObserved()) throw Held();
            retainedSession.ClaimOperatingSystemPairingAttempt();
            var pairing = OriginalR7OwnerPeerPairing.PrepareCurrent(retainedSession, expectedMain, runId, runAttempt);
            var before = OriginalR7CommissioningOwnerContext.ObserveCurrent();
            if (!before.NativeElevatedInteractiveContextObserved) throw Held();
            using WindowsIdentity current = WindowsIdentity.GetCurrent();
            string[] account = current.Name.Split('\\');
            if (account.Length != 2 || !string.Equals(account[0], Environment.MachineName, StringComparison.OrdinalIgnoreCase)
                || account[1].Length is < 1 or > 256 || current.User?.Value != before.CurrentSid)
                throw Held();
            bool inactiveRoots = retainedSession.OperationPurpose == OriginalR7OwnerOperationPurpose.ProvisionInactiveRoots;
            string scope = inactiveRoots
                ? "Authenticate this intended purpose: two NEW INACTIVE R7 signing seeds in the fixed witness and operator stores. "
                  + "This endpoint authenticates purpose only and creates NO keys or durable transaction. "
                  + "Real storage still requires continuous native creation custody. No signing, service start, or R7 release."
                : "Enroll this endpoint for the protected run only. This does not enroll signing keys or release R7.";
            string message = scope + "\n\nRun: " + pairing.RunUrl
                + "\nFingerprint: " + pairing.Fingerprint + "\nExpires: " + pairing.NativeExpiresAtUtc
                + (inactiveRoots ? "\nPermit: " + pairing.PermitSha256 + "\nSource: " + pairing.ExpectedMain : "")
                + "\n\nCompare the full fingerprint with the GitHub preparation result. "
                + "Windows will authenticate the current local operator.";
            if (message.Length > 1000) throw Held();
            var ui = new CredentialUi { Size = Marshal.SizeOf<CredentialUi>(), Message = message,
                Caption = inactiveRoots ? "Stephanos R7: authenticate INACTIVE-root purpose"
                    : "Stephanos R7: enroll this endpoint only" };
            uint package = 0;
            // SECURE_PROMPT only: no GENERIC, credential-save checkbox, caller
            // provider, input credential, remote destination or admin-enumeration
            // shortcut. A user's cancellation/unsupported provider is terminal.
            uint status = CredUIPromptForWindowsCredentialsW(ref ui, 0, ref package,
                IntPtr.Zero, 0, out auth, out authBytes, IntPtr.Zero, 0x1000);
            if (status != 0 || auth == IntPtr.Zero || authBytes is < 1 or > 65536) throw Held();
            using var fields = OwnedAuthenticationFields.Unpack(auth, authBytes);
            if (Marshal.ReadInt16(fields.PasswordPointer) == 0) throw Held();
            string suppliedUser = fields.UserName, suppliedDomain = fields.DomainName;
            if (CredIsMarshaledCredentialW(suppliedUser)) throw Held();
            if (suppliedUser.Contains('\\'))
            {
                string[] supplied = suppliedUser.Split('\\');
                if (supplied.Length != 2 || (suppliedDomain.Length != 0
                    && !string.Equals(suppliedDomain, supplied[0], StringComparison.OrdinalIgnoreCase))) throw Held();
                suppliedDomain = supplied[0]; suppliedUser = supplied[1];
            }
            if (!string.Equals(suppliedUser, account[1], StringComparison.OrdinalIgnoreCase)
                || (suppliedDomain.Length != 0 && suppliedDomain != "."
                    && !string.Equals(suppliedDomain, account[0], StringComparison.OrdinalIgnoreCase))) throw Held();
            // Authenticate only the actual current LOCAL account, not an
            // arbitrary username/domain returned by a credential provider.
            // Password remains in an owned unmanaged buffer, never a managed
            // string, JSON value, process argument, log or persistence file.
            if (!LogonUserW(account[1], ".", fields.PasswordPointer, 2 /* INTERACTIVE */, 0, out var full))
            { full?.Dispose(); throw Held(); }
            using (full)
            {
                if (!DuplicateHandle(GetCurrentProcess(), full, GetCurrentProcess(), out query,
                    8 /* TOKEN_QUERY only */, false, 0)) throw Held();
            }
            var stamp = R7NativePrincipalIdentity.ObserveRetained(query);
            using (var verifiedUser = new WindowsIdentity(query.DangerousGetHandle()))
                if (!stamp.NativeIdentityObserved || stamp.NativeType != 1 || verifiedUser.User?.Value != before.CurrentSid)
                    throw Held();
            var after = OriginalR7CommissioningOwnerContext.ObserveCurrent();
            var finalPairing = OriginalR7OwnerPeerPairing.PrepareCurrent(retainedSession, expectedMain, runId, runAttempt);
            if (before != after || pairing.Wire != finalPairing.Wire
                || !R7NativePrincipalIdentity.SameRetainedObjectAndState(stamp, R7NativePrincipalIdentity.ObserveRetained(query)))
                throw Held();
            var decision = new OriginalR7OperatingSystemPeerDecision(retainedSession, pairing, after, query, stamp);
            query = null;
            completed = true;
            return decision;
        }
        catch { throw Held(); }
        finally
        {
            query?.Dispose();
            if (auth != IntPtr.Zero)
            {
                // Pointer and extent are returned by the actual OS allocator,
                // never supplied by an endpoint. Wipe even cancellation/error
                // output before returning the allocation to CoTaskMem.
                try { WipeOwned(auth, authBytes); }
                finally { Marshal.FreeCoTaskMem(auth); }
            }
            if (!completed) retainedSession?.Dispose();
        }
    }

    internal bool TryConsumeFor(OriginalR7OwnerEnvelopeTransport retainedSession, string expectedMain,
        out OriginalR7OwnerPeerTranscript? paired)
    {
        paired = null;
        if (Interlocked.CompareExchange(ref terminal, 1, 0) != 0) return false;
        try
        {
            if (!ReferenceEquals(session, retainedSession) || transcript.ExpectedMain != expectedMain
                || !retainedSession.ClaimedSessionMatchesPeer(transcript)
                || Stopwatch.GetElapsedTime(opened) > TimeSpan.FromMinutes(5)
                || OriginalR7CommissioningOwnerContext.ObserveCurrent() != actor
                || !R7NativePrincipalIdentity.SameRetainedObjectAndState(authenticatedStamp,
                    R7NativePrincipalIdentity.ObserveRetained(authenticatedQuery))) return false;
            paired = transcript;
            return true;
        }
        catch { return false; }
    }

    private static void WipeOwned(IntPtr memory, uint count)
    {
        byte[] zeros = new byte[4096];
        for (uint offset = 0; offset < count;)
        {
            int chunk = (int)Math.Min((uint)zeros.Length, count - offset);
            Marshal.Copy(zeros, 0, checked(memory + (nint)offset), chunk);
            offset += (uint)chunk;
        }
    }

    // Private owned allocations only. The exact returned extents are bounded
    // before decoding; nothing accepts caller memory or exposes a password.
    private sealed class OwnedAuthenticationFields : IDisposable
    {
        private IntPtr user, domain, password;
        private uint userChars, domainChars, passwordChars;
        internal IntPtr PasswordPointer => password;
        internal string UserName => NonSecret(user, userChars);
        internal string DomainName => NonSecret(domain, domainChars);
        internal static OwnedAuthenticationFields Unpack(IntPtr auth, uint bytes)
        {
            var result = new OwnedAuthenticationFields();
            try
            {
                uint u = 0, d = 0, p = 0;
                if (CredUnPackAuthenticationBufferW(1 /* protected credentials */, auth, bytes,
                    IntPtr.Zero, ref u, IntPtr.Zero, ref d, IntPtr.Zero, ref p)
                    || Marshal.GetLastWin32Error() != 122 || u is < 1 or > 1024 || d > 1024 || p is < 1 or > 1024) throw Held();
                result.userChars = u; result.domainChars = Math.Max(1, d); result.passwordChars = p;
                result.user = Marshal.AllocHGlobal(checked((int)u * 2));
                result.domain = Marshal.AllocHGlobal(checked((int)result.domainChars * 2));
                result.password = Marshal.AllocHGlobal(checked((int)p * 2));
                WipeOwned(result.user, u * 2); WipeOwned(result.domain, result.domainChars * 2); WipeOwned(result.password, p * 2);
                d = result.domainChars;
                if (!CredUnPackAuthenticationBufferW(1, auth, bytes, result.user, ref u,
                    result.domain, ref d, result.password, ref p)
                    || u > result.userChars || d > result.domainChars || p > result.passwordChars
                    || !Terminated(result.user, result.userChars) || !Terminated(result.domain, result.domainChars)
                    || !Terminated(result.password, result.passwordChars)) throw Held();
                return result;
            }
            catch { result.Dispose(); throw; }
        }
        private static bool Terminated(IntPtr pointer, uint chars)
        { for (int i = 0; i < chars; i++) if (Marshal.ReadInt16(pointer, i * 2) == 0) return true; return false; }
        private static string NonSecret(IntPtr pointer, uint chars)
        { if (!Terminated(pointer, chars)) throw Held(); return Marshal.PtrToStringUni(pointer) ?? ""; }
        public void Dispose()
        {
            foreach (var pair in new[] { (user, userChars), (domain, domainChars), (password, passwordChars) })
                if (pair.Item1 != IntPtr.Zero)
                { try { WipeOwned(pair.Item1, pair.Item2 * 2); } finally { Marshal.FreeHGlobal(pair.Item1); } }
            user = domain = password = IntPtr.Zero;
        }
    }

    private static InvalidOperationException Held() => new("R7_REAL_OS_PEER_DECISION_UNAVAILABLE_OR_TERMINAL");
    public void Dispose() { Interlocked.Exchange(ref terminal, 2); authenticatedQuery.Dispose(); }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct CredentialUi
    {
        internal int Size;
        internal IntPtr Parent;
        [MarshalAs(UnmanagedType.LPWStr)] internal string Message;
        [MarshalAs(UnmanagedType.LPWStr)] internal string Caption;
        internal IntPtr Banner;
    }
    // .NET 8 single-file probing can still prefer the application directory
    // despite a System32 DllImportSearchPaths attribute (changed in .NET 10).
    // https://learn.microsoft.com/dotnet/core/compatibility/interop/10.0/native-library-search
    // Bind these credential APIs through exact absolute OS module handles,
    // retaining the handles for the process lifetime. No assembly resolver,
    // caller library/export/path or default-probing fallback is accepted.
    internal static bool FixedNativeModulesObserved() => SystemApis.Verified && SystemApis.HandlesRetained;
    private static uint CredUIPromptForWindowsCredentialsW(ref CredentialUi ui, uint error, ref uint package,
        IntPtr input, uint inputSize, out IntPtr output, out uint outputSize, IntPtr save, uint flags)
        => SystemApis.Prompt(ref ui, error, ref package, input, inputSize, out output, out outputSize, save, flags);
    private static bool CredUnPackAuthenticationBufferW(uint flags, IntPtr auth, uint bytes,
        IntPtr user, ref uint userChars, IntPtr domain, ref uint domainChars, IntPtr password, ref uint passwordChars)
        => SystemApis.Unpack(flags, auth, bytes, user, ref userChars, domain, ref domainChars, password, ref passwordChars);
    private static bool CredIsMarshaledCredentialW(string userName) => SystemApis.Marshaled(userName);
    private static bool LogonUserW(string userName, string domain, IntPtr password, uint kind, uint provider, out SafeAccessTokenHandle token)
        => SystemApis.Logon(userName, domain, password, kind, provider, out token);
    private static IntPtr GetCurrentProcess() => SystemApis.CurrentProcess();
    private static bool DuplicateHandle(IntPtr sourceProcess, SafeAccessTokenHandle source, IntPtr targetProcess,
        out SafeAccessTokenHandle target, uint access, bool inherit, uint options)
        => SystemApis.Duplicate(sourceProcess, source, targetProcess, out target, access, inherit, options);

    private static class SystemApis
    {
        // Exactly three retained owned loader references, not caller handles.
        private static readonly IntPtr kernel, credentials, security;
        internal static readonly PromptApi Prompt;
        internal static readonly UnpackApi Unpack;
        internal static readonly MarshaledApi Marshaled;
        internal static readonly LogonApi Logon;
        internal static readonly CurrentProcessApi CurrentProcess;
        internal static readonly DuplicateApi Duplicate;
        internal static readonly bool Verified;
        internal static bool HandlesRetained => kernel != IntPtr.Zero && credentials != IntPtr.Zero && security != IntPtr.Zero;

        static SystemApis()
        {
            IntPtr k = IntPtr.Zero, c = IntPtr.Zero, a = IntPtr.Zero;
            try
            {
                if (!OperatingSystem.IsWindows() || RuntimeInformation.ProcessArchitecture != Architecture.X64) throw Held();
                string system = Environment.SystemDirectory;
                if (!Path.IsPathFullyQualified(system) || system.Length > 512) throw Held();
                string kernelPath = Path.Combine(system, "kernel32.dll");
                // Absolute bootstrap of the OS KnownDLL; no bare-name P/Invoke.
                k = NativeLibrary.Load(kernelPath);
                var name = Marshal.GetDelegateForFunctionPointer<ModuleNameApi>(NativeLibrary.GetExport(k, "GetModuleFileNameW"));
                RequireModulePath(k, kernelPath, name);
                var load = Marshal.GetDelegateForFunctionPointer<LoadApi>(NativeLibrary.GetExport(k, "LoadLibraryExW"));
                string credentialPath = Path.Combine(system, "credui.dll"), securityPath = Path.Combine(system, "advapi32.dll");
                // LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32:
                // primary modules AND their dependencies stay in the OS dir.
                c = load(credentialPath, IntPtr.Zero, 0x900);
                if (c == IntPtr.Zero) throw Held();
                RequireModulePath(c, credentialPath, name);
                a = load(securityPath, IntPtr.Zero, 0x900);
                if (a == IntPtr.Zero) throw Held();
                RequireModulePath(a, securityPath, name);
                Prompt = Marshal.GetDelegateForFunctionPointer<PromptApi>(NativeLibrary.GetExport(c, "CredUIPromptForWindowsCredentialsW"));
                Unpack = Marshal.GetDelegateForFunctionPointer<UnpackApi>(NativeLibrary.GetExport(c, "CredUnPackAuthenticationBufferW"));
                Marshaled = Marshal.GetDelegateForFunctionPointer<MarshaledApi>(NativeLibrary.GetExport(a, "CredIsMarshaledCredentialW"));
                Logon = Marshal.GetDelegateForFunctionPointer<LogonApi>(NativeLibrary.GetExport(a, "LogonUserW"));
                CurrentProcess = Marshal.GetDelegateForFunctionPointer<CurrentProcessApi>(NativeLibrary.GetExport(k, "GetCurrentProcess"));
                Duplicate = Marshal.GetDelegateForFunctionPointer<DuplicateApi>(NativeLibrary.GetExport(k, "DuplicateHandle"));
                kernel = k; credentials = c; security = a;
                k = c = a = IntPtr.Zero;
                Verified = true;
            }
            finally
            {
                if (a != IntPtr.Zero) NativeLibrary.Free(a);
                if (c != IntPtr.Zero) NativeLibrary.Free(c);
                if (k != IntPtr.Zero) NativeLibrary.Free(k);
            }
        }

        private static void RequireModulePath(IntPtr module, string expected, ModuleNameApi query)
        {
            var value = new System.Text.StringBuilder(1024);
            uint count = query(module, value, (uint)value.Capacity);
            if (count == 0 || count >= value.Capacity || value.Length != count
                || !string.Equals(value.ToString(), expected, StringComparison.OrdinalIgnoreCase)) throw Held();
        }

        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode, SetLastError = true)]
        internal delegate IntPtr LoadApi(string path, IntPtr reserved, uint flags);
        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode, SetLastError = true)]
        internal delegate uint ModuleNameApi(IntPtr module, System.Text.StringBuilder path, uint capacity);
        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
        internal delegate uint PromptApi(ref CredentialUi ui, uint error, ref uint package,
            IntPtr input, uint inputSize, out IntPtr output, out uint outputSize, IntPtr save, uint flags);
        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal delegate bool UnpackApi(uint flags, IntPtr auth, uint bytes, IntPtr user, ref uint userChars,
            IntPtr domain, ref uint domainChars, IntPtr password, ref uint passwordChars);
        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal delegate bool MarshaledApi(string user);
        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal delegate bool LogonApi(string user, string domain, IntPtr password, uint kind, uint provider, out SafeAccessTokenHandle token);
        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        internal delegate IntPtr CurrentProcessApi();
        [UnmanagedFunctionPointer(CallingConvention.Winapi, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal delegate bool DuplicateApi(IntPtr sourceProcess, SafeAccessTokenHandle source, IntPtr targetProcess,
            out SafeAccessTokenHandle target, uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint options);
    }
}
