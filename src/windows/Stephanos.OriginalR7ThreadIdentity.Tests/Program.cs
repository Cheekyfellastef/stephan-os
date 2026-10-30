using System.Collections.Concurrent;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;
using Stephanos.OriginalR7DaclReadback;

internal static class Program
{
    private static int assertions;
    private static void Check(bool value, string code)
    { assertions++; if (!value) throw new InvalidOperationException(code); }
    private static void Flags(R7RetainedThreadTokenObservation value)
    {
        Check(!value.SourcePrincipalAuthenticated, "No principal enrollment");
        Check(!value.CompleteCapabilityInventoryProven, "No complete capability claim");
        Check(!value.WholeEstateProven, "No whole estate");
        Check(!value.ContinuousCustodyProven, "No continuous custody");
        Check(!value.SourceMutationAuthorized, "No source authority");
        Check(!value.LeaseReleaseAuthorized, "No lease authority");
        Check(!value.HostPolicyAdopted, "No adopted policy");
    }
    private static void Held(R7RetainedThreadTokenObservation value)
    {
        Check(!value.ThreadAndTokenSampleStable && value.ThreadIdentityDigest == "", "Unknown has no thread success");
        Check(!value.Token.NativeIdentityObserved && value.Token.IdentityDigest == ""
            && value.ImpersonationLevel == -1, "Unknown has no partial token success");
        Flags(value);
    }
    private static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows() || RuntimeInformation.ProcessArchitecture != Architecture.X64)
        { Console.WriteLine("UNSUPPORTED_WINDOWS_X64_REQUIRED"); return 2; }
        SetErrorMode(GetErrorMode() | 3);
        try
        {
            if (args.SequenceEqual(new[] { "--owned-idle-child" }))
            {
                Console.WriteLine("R7_OWNED_CHILD_READY");
                Console.Out.Flush();
                // A fixed, fresh disposable child. No token changes, source or
                // arbitrary command protocol. Parent owns exact process cleanup.
                var input = Console.In.ReadLineAsync();
                return input.Wait(8000) && input.Result == "exit" ? 0 : 2;
            }
            if (args.Length != 0) throw new InvalidOperationException("Expected controlled harness failure");
            TestNative();
            Console.WriteLine(JsonSerializer.Serialize(new {
                schemaVersion = "stephanos.r7-retained-thread-token-native-fixture.v1",
                result = "PASS", assertions, sdk = "8.0.426", runtime = Environment.Version.ToString(),
                ownedThreadTokenAttachReplaceClear = true, exitedThreadRejected = true,
                wrongOwningProcessRejected = true, queryOnlyRetainedTokenRead = true,
                primaryPublicWrapperUnchanged = true, sharedNativeStatisticsLayout = true,
                actualIdentificationAndImpersonationLevels = true,
                productionTokenChanged = false, sourcePrincipalAuthenticated = false,
                completeEstate = false, continuousCustody = false, sourceMutationAuthorized = false,
                leaseReleaseAuthorized = false, autonomousGoalConveyorPickup = false
            }));
            return 0;
        }
        catch (Exception error)
        { Console.Error.WriteLine("R7_THREAD_TOKEN_FIXTURE_FAILED:" + error.GetType().Name + ":" + error.Message); return 1; }
    }
    private static void TestNative()
    {
        Check(OpenProcessToken(GetCurrentProcess(), 0x000a, out var primary), "Own process query/duplicate token");
        using (primary)
        {
            var primaryBefore = R7NativePrincipalIdentity.ObserveRetained(primary);
            Check(primaryBefore.NativeIdentityObserved && primaryBefore.NativeType == 1, "Primary default observed");
            var primaryRaw = R7ProcessBoundWriteDenial.ReadStamp(primary);
            Check(primaryRaw.NativeType == 1 && primaryRaw.ImpersonationLevel == -1, "Primary ignores undefined native level");
            MustRejectRaw(primary, R7NativeTokenStampKind.Impersonation);
            MustRejectRaw(primary, (R7NativeTokenStampKind)0);
            Check(DuplicateProcess(GetCurrentProcess(), GetCurrentProcess(), GetCurrentProcess(),
                out var process, 0x00101000, false, 0), "Actual owned retained process");
            using (process)
            using (var first = Impersonation(primary, 2))
            using (var second = Impersonation(primary, 2))
            using (var identify = Impersonation(primary, 1))
            using (var thread = new OwnedThread(first, second, identify))
            {
                var absent = Observe(process, thread.Handle);
                Check(absent.Classification == "R7_THREAD_IMPERSONATION_TOKEN_UNAVAILABLE", "Actual no-token thread UNKNOWN");
                Held(absent);
                thread.Send(1);
                var a = Observe(process, thread.Handle);
                Check(a.ThreadAndTokenSampleStable && a.Token.NativeType == 2 && a.ImpersonationLevel == 2,
                    "Actual owned thread token level2 read");
                Check(a.ThreadIdentityDigest.Length == 64 && a.Token.IdentityDigest.Length == 64, "Bounded identity digests");
                Flags(a);
                Check(R7RetainedThreadTokenObserver.SameRetainedThreadAndTokenState(a, Observe(process, thread.Handle)),
                    "Stable retained thread+token");
                using (var duplicateThread = DuplicateThread(thread.Handle, 0x00100800))
                    Check(R7RetainedThreadTokenObserver.SameRetainedThreadAndTokenState(a, Observe(process, duplicateThread)),
                        "Same retained thread object through duplicate handle");
                var explicitToken = R7NativePrincipalIdentity.ObserveRetained(first, R7NativeTokenStampKind.Impersonation);
                Check(explicitToken.NativeIdentityObserved && explicitToken.NativeType == 2, "Typed internal impersonation metadata");
                Check(!R7NativePrincipalIdentity.ObserveRetained(first).NativeIdentityObserved,
                    "Public primary wrapper still rejects impersonation");
                Check(!R7TokenGroupInventory.ObserveRetained(first).SampleStable,
                    "Public primary group observer still rejects impersonation");
                MustRejectRaw(first, R7NativeTokenStampKind.Primary);
                var raw = R7ProcessBoundWriteDenial.ReadStamp(first, R7NativeTokenStampKind.Impersonation);
                Check(raw.NativeType == 2 && raw.ImpersonationLevel == 2 && raw.GroupInventoryDigest.Length == 64,
                    "Typed canonical stamp binds native type/level/group state");
                var identifyRaw = R7ProcessBoundWriteDenial.ReadStamp(identify, R7NativeTokenStampKind.Impersonation);
                Check(identifyRaw.ImpersonationLevel == 1, "Canonical identification-level read");
                Check(raw.GroupInventoryDigest == identifyRaw.GroupInventoryDigest
                    && raw.PrivilegeDigest == identifyRaw.PrivilegeDigest, "Same inventory can have distinct native levels");
                using (var queryOnlyThread = DuplicateThread(thread.Handle, 0x0800))
                    Held(Observe(process, queryOnlyThread)); // No SYNCHRONIZE/liveness proof.
                using (var pseudoThread = new SafeWaitHandle(new IntPtr(-2), false))
                    Held(Observe(process, pseudoThread));
                using (var invalidThread = new SafeWaitHandle(IntPtr.Zero, false))
                    Held(Observe(process, invalidThread));
                using (var wrongType = new SafeWaitHandle(process.DangerousGetHandle(), false))
                    Held(Observe(process, wrongType));
                using (var invalidProcess = new SafeProcessHandle(IntPtr.Zero, false))
                    Held(Observe(invalidProcess, thread.Handle));

                thread.Send(2);
                var b = Observe(process, thread.Handle);
                Check(b.ThreadAndTokenSampleStable && b.ImpersonationLevel == 2, "Actual replacement token readable");
                Check(a.ThreadIdentityDigest == b.ThreadIdentityDigest, "Replacement retains actual same thread identity");
                Check(a.Token.IdentityDigest != b.Token.IdentityDigest, "Fresh token object replacement detected");
                Check(!R7RetainedThreadTokenObserver.SameRetainedThreadAndTokenState(a, b), "Prior binding invalidated by replacement");
                Check(R7RetainedThreadTokenObserver.SameRetainedThreadAndTokenState(b, Observe(process, thread.Handle)),
                    "Replacement independently stable");
                thread.Send(3);
                var id = Observe(process, thread.Handle);
                Check(id.ThreadAndTokenSampleStable && id.ImpersonationLevel == 1 && id.Token.NativeType == 2,
                    "OpenAsSelf true reads own identification-level token");
                Check(!R7RetainedThreadTokenObserver.SameRetainedThreadAndTokenState(b, id), "Native level/token change invalidates sample");
                Flags(id);
                thread.Send(0);
                var cleared = Observe(process, thread.Handle);
                Held(cleared);
                Check(!R7RetainedThreadTokenObserver.SameRetainedThreadAndTokenState(id, cleared),
                    "Actual clear invalidates previous observation");
                thread.Send(1);
                Check(Observe(process, thread.Handle).ThreadAndTokenSampleStable, "Fresh read required after reassignment");

                // A second fresh owned live THREAD can use equivalent security
                // metadata; it must still have a distinct thread binding.
                using (var other = new OwnedThread(first, second, identify))
                {
                    other.Send(1);
                    var otherSample = Observe(process, other.Handle);
                    Check(otherSample.ThreadAndTokenSampleStable, "Other owned thread observed");
                    Check(otherSample.ThreadIdentityDigest != a.ThreadIdentityDigest, "Distinct native thread object identity");
                    Check(!R7RetainedThreadTokenObserver.SameRetainedThreadAndTokenState(a, otherSample),
                        "Token metadata cannot substitute a different thread");
                }
                WrongOwnerChild(thread.Handle);
                thread.Stop();
                var exited = Observe(process, thread.Handle);
                Held(exited);
                Check(!R7RetainedThreadTokenObserver.SameRetainedThreadAndTokenState(a, exited),
                    "Exited retained thread cannot reuse prior proof");
                var closed = DuplicateThread(thread.Handle, 0x00100800);
                closed.Dispose();
                Held(Observe(process, closed));
                var primaryAfter = R7NativePrincipalIdentity.ObserveRetained(primary);
                Check(R7NativePrincipalIdentity.SameRetainedObjectAndState(primaryBefore, primaryAfter),
                    "Actual process primary token unchanged by disposable thread fixtures");
            }
        }
    }
    private static R7RetainedThreadTokenObservation Observe(SafeProcessHandle process, SafeWaitHandle thread)
        => R7RetainedThreadTokenObserver.ObserveRetained(process, thread);
    private static SafeAccessTokenHandle Impersonation(SafeAccessTokenHandle primary, int level)
    {
        Check(DuplicateTokenEx(primary, 0x000e, IntPtr.Zero, level, 2, out var token), "Own disposable impersonation token");
        return token;
    }
    private static void MustRejectRaw(SafeAccessTokenHandle token, R7NativeTokenStampKind kind)
    {
        bool rejected = false;
        try { R7ProcessBoundWriteDenial.ReadStamp(token, kind); }
        catch (InvalidOperationException) { rejected = true; }
        Check(rejected, "Typed raw stamp rejects wrong/unknown kind");
    }
    private static SafeWaitHandle DuplicateThread(SafeWaitHandle thread, uint access)
    {
        Check(DuplicateWaitHandle(GetCurrentProcess(), thread, GetCurrentProcess(), out var result, access, false, 0),
            "Retain exact owned thread handle");
        return result;
    }
    private static void WrongOwnerChild(SafeWaitHandle thread)
    {
        var start = new ProcessStartInfo(Environment.ProcessPath!) {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        start.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
        start.ArgumentList.Add("--owned-idle-child");
        using var own = Process.Start(start) ?? throw new InvalidOperationException("Fixed owned child failed");
        try
        {
            var ready = own.StandardOutput.ReadLineAsync();
            Check(ready.Wait(5000) && ready.Result == "R7_OWNED_CHILD_READY", "Owned helper readiness");
            Held(Observe(own.SafeHandle, thread));
            own.StandardInput.WriteLine("exit"); own.StandardInput.Flush();
            Check(own.WaitForExit(5000) && own.ExitCode == 0, "Owned helper normal exit");
        }
        finally
        {
            // Only our freshly spawned retained process, never PID/tree search.
            if (!own.HasExited) { own.Kill(); own.WaitForExit(5000); }
        }
    }
    private sealed class OwnedThread : IDisposable
    {
        private sealed record Command(int Mode, ManualResetEventSlim Done);
        private readonly BlockingCollection<Command> commands = new();
        private readonly List<ManualResetEventSlim> acknowledgments = new();
        private readonly ManualResetEventSlim ready = new();
        private readonly Thread worker;
        private Exception? error;
        private SafeWaitHandle? retained;
        private bool stopped;
        internal SafeWaitHandle Handle => retained ?? throw new InvalidOperationException("Owned thread handle absent");
        internal OwnedThread(SafeAccessTokenHandle first, SafeAccessTokenHandle second, SafeAccessTokenHandle identify)
        {
            worker = new Thread(() => {
                Command? current = null;
                try
                {
                    if (!DuplicateCurrentThread(GetCurrentProcess(), GetCurrentThread(), GetCurrentProcess(),
                        out retained, 0x00100800, false, 0)) throw new InvalidOperationException("Own native thread retention failed");
                    ready.Set();
                    while (commands.TryTake(out current, 10000))
                    {
                        try
                        {
                            if (current.Mode == 4) return;
                            bool ok = current.Mode == 0
                                ? SetThreadTokenNull(IntPtr.Zero, IntPtr.Zero)
                                : SetThreadToken(IntPtr.Zero, current.Mode == 1 ? first : current.Mode == 2 ? second : identify);
                            if (!ok) throw new InvalidOperationException("Own thread token fixture assignment failed");
                        }
                        catch (Exception ex) { error = ex; throw; }
                        finally { current.Done.Set(); current = null; }
                    }
                }
                catch (Exception ex) { error = ex; }
                finally
                {
                    if (!RevertToSelf()) error ??= new InvalidOperationException("Own thread cleanup failed");
                    current?.Done.Set(); ready.Set();
                }
            }) { IsBackground = true, Name = "R7-owned-thread-token-fixture" };
            worker.Start();
            if (!ready.Wait(5000) || error is not null || retained is null)
                throw new InvalidOperationException("Owned fixture thread failed to start");
        }
        internal void Send(int mode)
        {
            if (stopped || error is not null) throw new InvalidOperationException("Owned fixture thread unavailable");
            var done = new ManualResetEventSlim();
            acknowledgments.Add(done); // Dispose only after signaler thread exits.
            commands.Add(new(mode, done));
            if (!done.Wait(5000) || error is not null) throw new InvalidOperationException("Owned fixture command failed");
        }
        internal void Stop()
        {
            if (stopped) return;
            if (worker.IsAlive) Send(4);
            if (!worker.Join(5000) || error is not null) throw new InvalidOperationException("Owned fixture cleanup failed");
            stopped = true;
        }
        public void Dispose()
        {
            try { Stop(); }
            finally { if (!worker.IsAlive) {
                retained?.Dispose(); commands.Dispose(); ready.Dispose();
                foreach (var acknowledgment in acknowledgments) acknowledgment.Dispose();
            } }
        }
    }
    [DllImport("kernel32.dll")] private static extern uint GetErrorMode();
    [DllImport("kernel32.dll")] private static extern uint SetErrorMode(uint mode);
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentThread();
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DuplicateTokenEx(SafeAccessTokenHandle existing, uint access, IntPtr security,
        int level, int type, out SafeAccessTokenHandle token);
    [DllImport("kernel32.dll", EntryPoint = "DuplicateHandle", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DuplicateProcess(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess,
        out SafeProcessHandle target, uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint options);
    [DllImport("kernel32.dll", EntryPoint = "DuplicateHandle", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DuplicateCurrentThread(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess,
        out SafeWaitHandle target, uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint options);
    [DllImport("kernel32.dll", EntryPoint = "DuplicateHandle", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DuplicateWaitHandle(IntPtr sourceProcess, SafeWaitHandle source, IntPtr targetProcess,
        out SafeWaitHandle target, uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint options);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetThreadToken(IntPtr thread, SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", EntryPoint = "SetThreadToken", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetThreadTokenNull(IntPtr thread, IntPtr token);
    [DllImport("advapi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool RevertToSelf();
}
