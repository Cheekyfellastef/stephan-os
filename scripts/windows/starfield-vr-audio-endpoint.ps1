[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('GetDefault','SwitchToQuest','SetDefault')][string]$Action,
    [string]$EndpointId = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not ('Stephanos.CoreAudio' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace Stephanos {
    public enum EDataFlow { eRender = 0, eCapture = 1, eAll = 2 }
    public enum ERole { eConsole = 0, eMultimedia = 1, eCommunications = 2 }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    internal class MMDeviceEnumeratorComObject {}

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceEnumerator {
        int EnumAudioEndpoints(EDataFlow dataFlow, uint stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice device);
        int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        int RegisterEndpointNotificationCallback(IntPtr client);
        int UnregisterEndpointNotificationCallback(IntPtr client);
    }
    [Guid("D666063F-1587-4E43-81F1-B948E807363F"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDevice {
        int Activate(ref Guid iid, uint clsCtx, IntPtr activationParams, out IntPtr iface);
        int OpenPropertyStore(uint access, out IntPtr properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        int GetState(out uint state);
    }

    [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
    internal class PolicyConfigClient {}

    [Guid("F8679F50-850A-41CF-9C72-430F290290C8"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IPolicyConfig {
        int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr format);
        int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int defaultFormat, IntPtr format);
        int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceId);
        int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr endpointFormat, IntPtr mixFormat);
        int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int defaultPeriod, IntPtr period, IntPtr minimumPeriod);
        int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr period);
        int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr mode);
        int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr mode);
        int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr key, IntPtr value);
        int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr key, IntPtr value);
        int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, ERole role);
        int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int visible);
    }
    public static class CoreAudio {
        public static string GetDefaultRenderEndpoint() {
            var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
            IMMDevice device;
            int hr = enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device);
            if (hr != 0 || device == null) Marshal.ThrowExceptionForHR(hr);
            string id;
            hr = device.GetId(out id);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
            return id;
        }

        public static void SetDefaultRenderEndpoint(string endpointId) {
            var policy = (IPolicyConfig)(new PolicyConfigClient());
            foreach (ERole role in new [] { ERole.eConsole, ERole.eMultimedia, ERole.eCommunications }) {
                int hr = policy.SetDefaultEndpoint(endpointId, role);
                if (hr != 0) Marshal.ThrowExceptionForHR(hr);
            }
        }
    }
}
'@
}

function Get-QuestEndpointId {
    $root = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render'
    foreach ($key in Get-ChildItem -LiteralPath $root) {
        $deviceState = (Get-ItemProperty -LiteralPath $key.PSPath -Name DeviceState -ErrorAction SilentlyContinue).DeviceState
        if ($deviceState -ne 1) { continue }
        $properties = Get-ItemProperty -LiteralPath ($key.PSPath + '\Properties') -ErrorAction SilentlyContinue
        if (-not $properties) { continue }
        $matchesQuest = @($properties.PSObject.Properties | Where-Object {
            $_.Name -notmatch '^PS' -and ([string]$_.Value -match 'Oculus Virtual Audio Device|Quest')
        }).Count -gt 0
        if ($matchesQuest) {
            return "{0.0.0.00000000}.$($key.PSChildName)"
        }
    }
    throw 'Active Oculus/Quest playback endpoint was not found.'
}

$current = [Stephanos.CoreAudio]::GetDefaultRenderEndpoint()
if ($Action -eq 'GetDefault') {
    [ordered]@{ ok = $true; endpointId = $current } | ConvertTo-Json -Compress
    exit 0
}

$target = if ($Action -eq 'SwitchToQuest') { Get-QuestEndpointId } else { $EndpointId }
if (-not $target) { throw 'SetDefault requires EndpointId.' }
[Stephanos.CoreAudio]::SetDefaultRenderEndpoint($target)
$after = [Stephanos.CoreAudio]::GetDefaultRenderEndpoint()
if (-not [string]::Equals($after, $target, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Default playback endpoint did not switch to requested endpoint. Requested=$target Actual=$after"
}

[ordered]@{
    ok = $true
    previousEndpointId = $current
    endpointId = $after
    action = $Action
} | ConvertTo-Json -Compress
