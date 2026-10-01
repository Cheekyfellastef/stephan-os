[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('GetDefault','GetDefaults','SwitchToQuest','SetDefault','RestoreDefaults')]
    [string]$Action,
    [string]$EndpointId = '',
    [string]$ConsoleEndpointId = '',
    [string]$MultimediaEndpointId = '',
    [string]$CommunicationsEndpointId = ''
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
        public static string GetDefaultRenderEndpointForRole(ERole role) {
            var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
            IMMDevice device;
            int hr = enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, role, out device);
            if (hr != 0 || device == null) Marshal.ThrowExceptionForHR(hr);
            string id;
            hr = device.GetId(out id);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
            return id;
        }

        public static string GetDefaultRenderEndpoint() {
            return GetDefaultRenderEndpointForRole(ERole.eMultimedia);
        }

        public static void SetDefaultRenderEndpointForRole(string endpointId, ERole role) {
            var policy = (IPolicyConfig)(new PolicyConfigClient());
            int hr = policy.SetDefaultEndpoint(endpointId, role);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
        }

        public static void SetDefaultRenderEndpoint(string endpointId) {
            foreach (ERole role in new [] { ERole.eConsole, ERole.eMultimedia, ERole.eCommunications }) {
                SetDefaultRenderEndpointForRole(endpointId, role);
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

function Get-DefaultEndpoints {
    return [ordered]@{
        consoleEndpointId = [Stephanos.CoreAudio]::GetDefaultRenderEndpointForRole([Stephanos.ERole]::eConsole)
        multimediaEndpointId = [Stephanos.CoreAudio]::GetDefaultRenderEndpointForRole([Stephanos.ERole]::eMultimedia)
        communicationsEndpointId = [Stephanos.CoreAudio]::GetDefaultRenderEndpointForRole([Stephanos.ERole]::eCommunications)
    }
}

function Test-EndpointEqual {
    param([string]$Actual, [string]$Expected)
    return [string]::Equals($Actual, $Expected, [System.StringComparison]::OrdinalIgnoreCase)
}

$currentDefaults = Get-DefaultEndpoints
$current = [string]$currentDefaults.multimediaEndpointId

if ($Action -eq 'GetDefault') {
    [ordered]@{
        ok = $true
        endpointId = $current
        endpoints = $currentDefaults
    } | ConvertTo-Json -Depth 4 -Compress
    exit 0
}

if ($Action -eq 'GetDefaults') {
    [ordered]@{
        ok = $true
        endpointId = $current
        endpoints = $currentDefaults
    } | ConvertTo-Json -Depth 4 -Compress
    exit 0
}

if ($Action -eq 'SwitchToQuest') {
    $target = Get-QuestEndpointId
    [Stephanos.CoreAudio]::SetDefaultRenderEndpoint($target)
}
elseif ($Action -eq 'SetDefault') {
    if (-not $EndpointId) { throw 'SetDefault requires EndpointId.' }
    $target = $EndpointId
    [Stephanos.CoreAudio]::SetDefaultRenderEndpoint($target)
}
elseif ($Action -eq 'RestoreDefaults') {
    if (-not $ConsoleEndpointId -or -not $MultimediaEndpointId -or -not $CommunicationsEndpointId) {
        throw 'RestoreDefaults requires ConsoleEndpointId, MultimediaEndpointId, and CommunicationsEndpointId.'
    }
    [Stephanos.CoreAudio]::SetDefaultRenderEndpointForRole($ConsoleEndpointId, [Stephanos.ERole]::eConsole)
    [Stephanos.CoreAudio]::SetDefaultRenderEndpointForRole($MultimediaEndpointId, [Stephanos.ERole]::eMultimedia)
    [Stephanos.CoreAudio]::SetDefaultRenderEndpointForRole($CommunicationsEndpointId, [Stephanos.ERole]::eCommunications)
}

$afterDefaults = Get-DefaultEndpoints
$verified = if ($Action -eq 'RestoreDefaults') {
    (Test-EndpointEqual -Actual $afterDefaults.consoleEndpointId -Expected $ConsoleEndpointId) -and
    (Test-EndpointEqual -Actual $afterDefaults.multimediaEndpointId -Expected $MultimediaEndpointId) -and
    (Test-EndpointEqual -Actual $afterDefaults.communicationsEndpointId -Expected $CommunicationsEndpointId)
} else {
    (Test-EndpointEqual -Actual $afterDefaults.consoleEndpointId -Expected $target) -and
    (Test-EndpointEqual -Actual $afterDefaults.multimediaEndpointId -Expected $target) -and
    (Test-EndpointEqual -Actual $afterDefaults.communicationsEndpointId -Expected $target)
}

if (-not $verified) {
    throw "Default playback endpoint state did not match requested state after $Action."
}

[ordered]@{
    ok = $true
    previousEndpointId = $current
    previousEndpoints = $currentDefaults
    endpointId = [string]$afterDefaults.multimediaEndpointId
    endpoints = $afterDefaults
    action = $Action
} | ConvertTo-Json -Depth 4 -Compress
