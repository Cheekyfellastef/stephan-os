using System.Runtime.InteropServices;

namespace Stephanos.OriginalR7CustodyWitness.Tests;

// Test process and its own fixture children only. No registry, WER service,
// production process or machine-wide reporting policy is changed.
internal static class NativeTestProcessErrorMode
{
    internal static void Apply()
    {
        if (!OperatingSystem.IsWindows()) return;
        const uint failCriticalErrors = 1, noGpFaultErrorBox = 2;
        uint required = failCriticalErrors | noGpFaultErrorBox;
        _ = SetErrorMode(GetErrorMode() | required);
        if ((GetErrorMode() & required) != required)
            throw new InvalidOperationException("R7_TEST_NONINTERACTIVE_ERROR_MODE_NOT_APPLIED");
    }

    [DllImport("kernel32.dll", ExactSpelling = true)]
    private static extern uint GetErrorMode();
    [DllImport("kernel32.dll", ExactSpelling = true)]
    private static extern uint SetErrorMode(uint mode);
}
