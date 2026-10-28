using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Diagnostics.Eventing.Reader;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.Principal;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;
public sealed class MaintenanceJournalAclResultV2 {
    public bool ReadAllowed, WriteAllowed, ClearDenied, ConfigurationDenied, RegistryWriteDenied, RegistryDeleteDenied, AdministratorDisabled;
}
public static class MaintenanceJournalAclFixtureV2 {
    private const string Log = "StphCustodyFixture";
    private const string Source = "StphCustodyFixtureV2";
    [StructLayout(LayoutKind.Sequential)] private struct SidAndAttributes { public IntPtr Sid; public uint Attributes; }
    [DllImport("advapi32.dll", SetLastError=true)]
    private static extern bool CreateRestrictedToken(SafeAccessTokenHandle token, uint flags, uint disabledCount,
        [In] SidAndAttributes[] disabled, uint deleteCount, IntPtr delete, uint restrictedCount,
        IntPtr restricted, out SafeAccessTokenHandle reduced);
    private static bool AccessDenied(Exception error) {
        for (Exception e = error; e != null; e = e.InnerException) {
            Win32Exception w = e as Win32Exception;
            if ((w != null && w.NativeErrorCode == 5) || e is UnauthorizedAccessException ||
                e is SecurityException || e.HResult == unchecked((int)0x80070005)) return true;
        }
        return false;
    }
    public static MaintenanceJournalAclResultV2 Run() {
        MaintenanceJournalAclResultV2 result = new MaintenanceJournalAclResultV2();
        SecurityIdentifier admin = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);
        byte[] raw = new byte[admin.BinaryLength]; admin.GetBinaryForm(raw, 0);
        IntPtr sid = Marshal.AllocHGlobal(raw.Length);
        try {
            Marshal.Copy(raw, 0, sid, raw.Length);
            using (WindowsIdentity original = WindowsIdentity.GetCurrent()) {
                SafeAccessTokenHandle reduced;
                if (!CreateRestrictedToken(original.AccessToken, 1, 1,
                    new SidAndAttributes[] { new SidAndAttributes { Sid=sid, Attributes=0 } },
                    0, IntPtr.Zero, 0, IntPtr.Zero, out reduced))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                using (reduced) {
                    WindowsIdentity.RunImpersonated(reduced, delegate {
                        using (WindowsIdentity current = WindowsIdentity.GetCurrent()) {
                            if (current.User.Value != original.User.Value) throw new InvalidOperationException("FIXTURE_PRINCIPAL_CHANGED");
                            result.AdministratorDisabled = !new WindowsPrincipal(current).IsInRole(WindowsBuiltInRole.Administrator);
                        }
                        if (!result.AdministratorDisabled) throw new InvalidOperationException("FIXTURE_TOKEN_NOT_RESTRICTED");
                        using (EventLog writer = new EventLog(Log)) {
                            writer.Source = Source;
                            writer.WriteEntry("FIXTURE_WRITE_WITHOUT_CLEAR_AUTHORITY", EventLogEntryType.Information, 62518);
                            result.WriteAllowed = true;
                            try { writer.Clear(); } catch (Exception e) { result.ClearDenied = AccessDenied(e); }
                        }
                        EventLogQuery query = new EventLogQuery(Log, PathType.LogName, "*");
                        query.ReverseDirection = true;
                        using (EventLogReader reader = new EventLogReader(query))
                        using (EventRecord row = reader.ReadEvent(TimeSpan.FromSeconds(2))) result.ReadAllowed = row != null;
                        try {
                            using (EventLogConfiguration config = new EventLogConfiguration(Log)) {
                                config.LogMode = EventLogMode.Circular;
                                config.SaveChanges();
                            }
                        } catch (Exception e) { result.ConfigurationDenied = AccessDenied(e); }
                        result.RegistryWriteDenied = true;
                        result.RegistryDeleteDenied = true;
                        foreach (string suffix in new string[] { "", "\\" + Source }) {
                            string path = "SYSTEM\\CurrentControlSet\\Services\\EventLog\\" + Log + suffix;
                            bool writeDenied = false, deleteDenied = false;
                            try {
                                using (RegistryKey key = Registry.LocalMachine.OpenSubKey(path, true)) { }
                            } catch (Exception e) { writeDenied = AccessDenied(e); }
                            // Request DELETE alone, never actually delete even a fixture key.
                            try {
                                using (RegistryKey key = Registry.LocalMachine.OpenSubKey(path,
                                    RegistryKeyPermissionCheck.Default,
                                    System.Security.AccessControl.RegistryRights.Delete)) { }
                            } catch (Exception e) { deleteDenied = AccessDenied(e); }
                            result.RegistryWriteDenied &= writeDenied;
                            result.RegistryDeleteDenied &= deleteDenied;
                        }
                    });
                }
            }
        } finally { Marshal.FreeHGlobal(sid); }
        return result;
    }
}
