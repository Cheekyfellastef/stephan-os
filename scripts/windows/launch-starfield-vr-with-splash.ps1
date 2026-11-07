[CmdletBinding()]
param(
    [string]$ProfilePath = '',
    [string]$MutarProfilePath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Enter-StarfieldSplashOwner {
    $mutex = New-Object System.Threading.Mutex($false, 'Global\Stephanos.StarfieldVrSplash')
    $held = $false
    try { $held = $mutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $held = $true }
    if (-not $held) { $mutex.Dispose(); return $null }
    return $mutex
}

function Exit-StarfieldSplashOwner {
    param([Parameter(Mandatory)]$Mutex, [Parameter(Mandatory)][AllowEmptyCollection()]$Children)
    # Retain the same UI owner until already-dispatched helpers have settled.
    # Deferred launch stages are cancelled by FormClosing; no child is killed.
    foreach ($child in @($Children.ToArray())) {
        while (-not $child.HasExited) { [void]$child.WaitForExit(1000) }
        $child.Dispose()
    }
    $Children.Clear()
    $Mutex.ReleaseMutex()
    $Mutex.Dispose()
}

$splashOwner = Enter-StarfieldSplashOwner
if (-not $splashOwner) {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show('Starfield VR is already open. Use the existing splash screen.', 'Starfield VR')
    return
}
$splashOwnedChildren = New-Object 'System.Collections.Generic.List[System.Diagnostics.Process]'
try {
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$launcherScript = Join-Path $repositoryRoot 'scripts\windows\launch-starfield-vr.ps1'
$workspaceRoot = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'
if (-not $ProfilePath) {
    $ProfilePath = Join-Path $workspaceRoot 'vr\starfield-vr-launch-profile.json'
}
if (-not $MutarProfilePath) {
    $MutarProfilePath = Join-Path $workspaceRoot 'vr\starfield-vr-launch-profile-mutar-openxr.json'
}
$providerPreferencePath = Join-Path $workspaceRoot 'vr\starfield-vr-provider-preference.json'
$providerCachePath = Join-Path $workspaceRoot 'vr\starfield-vr-provider-cache.json'
$simulationStatePath = Join-Path $workspaceRoot 'vr\starfield-vr-sim-air-link.json'
$vrModeStatePath = Join-Path $workspaceRoot 'vr\vr-mode-state-current.json'
$aerObserveScript = Join-Path $repositoryRoot 'scripts\windows\run-starfield-aer-stabilizer-observe.ps1'
$simulationEnabled = $false
if (Test-Path -LiteralPath $simulationStatePath -PathType Leaf) {
    try {
        $simulationState = Get-Content -LiteralPath $simulationStatePath -Raw | ConvertFrom-Json
        $simulationEnabled = $simulationState.schemaVersion -eq 'stephanos.starfield-vr-sim-air-link.v1' -and $simulationState.enabled -eq $true -and $simulationState.purpose -eq 'readiness-only'
    } catch { $simulationEnabled = $false }
}
$providerSlotScript = Join-Path $repositoryRoot 'scripts\starfield-vr-provider-slot.mjs'
$nodeExecutable = 'C:\Program Files\nodejs\node.exe'
$powershellExecutable = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

foreach ($required in @($launcherScript, $providerSlotScript, $aerObserveScript, $nodeExecutable, $powershellExecutable)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Required Starfield VR splash component is missing: $required"
    }
}
if ($launcherScript.Contains('"') -or $ProfilePath.Contains('"') -or $MutarProfilePath.Contains('"')) {
    throw 'Launcher and profile paths must not contain quote characters.'
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# The third card is the attended monitor entry for the independent bridge.
# Its protocol never admits arbitrary commands, file paths or a headset claim.
$monitorBridgePath = Join-Path $PSScriptRoot 'starfield-native-monitor\splash_monitor_bridge.py'
$monitorBridgeSha256 = '77116240a5a0b21b73d03f9caca5df85bd60d1c37899720fa62b70dca52c1781'
$monitorRunnerSha256 = 'f40df00ff7378b8d3c62714bfb32702226746735f73d804a2c5f3e3727f7ba6c'
$monitorProtocol = 'stephanos.native-eye-output.splash.v1'
$monitorState = [pscustomobject]@{
    Process = $null
    Pipe = $null
    Channel = ''
    RequestSequence = 0L
    EventSequence = 0L
    PendingPrepare = $false
    PrepareDispatched = $false
    CloseRequested = $false
    CloseSent = $false
    ClosedReceived = $false
    TransportFailed = $false
    ProviderSlotReleased = $true
    DurableCustodyReleased = $false
    DurableCustodyReason = 'not-checked'
    SafeToClose = $true
    Busy = $false
    Mode = 'idle'
    AllowedActions = @()
    ConfirmationToken = $null
    RunId = $null
    GameProcess = $null
    Result = $null
    DetailText = ''
    StartedAtUtc = $null
    ExitedAtUtc = $null
}

# Drain both child streams outside the PowerShell runspace. PowerShell 5 event
# scriptblocks on Process.DataReceived threads do not have a usable runspace.
# Every retained line, queue and diagnostic buffer is bounded. No process is killed.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace Stephanos.Starfield {
    public sealed class MonitorPipe : IDisposable {
        private readonly Process child;
        private readonly ConcurrentQueue<string> lines = new ConcurrentQueue<string>();
        private readonly StringBuilder errors = new StringBuilder();
        private int queued;
        private long outputCharacters;
        private volatile bool stdoutEnded;
        private volatile bool stderrEnded;
        private string fault;
        private const int MaximumLine = 32768;
        private const int MaximumQueue = 128;
        private const int MaximumErrors = 16384;
        private const long MaximumOutput = 1048576;

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AllowSetForegroundWindow(uint processId);

        public MonitorPipe(Process process) {
            child = process;
            StreamReader outputReader = process.StandardOutput;
            StreamReader errorReader = process.StandardError;
            Thread output = new Thread(() => Drain(outputReader, true));
            Thread error = new Thread(() => Drain(errorReader, false));
            output.IsBackground = true;
            error.IsBackground = true;
            output.Start();
            error.Start();
        }

        private void Fail(string reason) { Interlocked.CompareExchange(ref fault, reason, null); }
        private void Drain(StreamReader reader, bool protocol) {
            StringBuilder line = new StringBuilder();
            bool discardLine = false;
            try {
                int next;
                // A short flushed protocol frame must be delivered immediately;
                // never wait to fill a fixed-size character block before queuing it.
                while ((next = reader.Read()) >= 0) {
                    char value = (char)next;
                    if (!protocol) {
                        lock (errors) { if (errors.Length < MaximumErrors) errors.Append(value); }
                        continue;
                    }
                    outputCharacters++;
                    if (outputCharacters > MaximumOutput) Fail("monitor-output-limit");
                    if (value == '\n') {
                        if (!discardLine && Fault == null) {
                            if (Interlocked.Increment(ref queued) <= MaximumQueue) {
                                lines.Enqueue(line.ToString().TrimEnd('\r'));
                            } else {
                                Interlocked.Decrement(ref queued);
                                Fail("monitor-output-queue-limit");
                            }
                        }
                        line.Clear();
                        discardLine = false;
                    } else if (!discardLine) {
                        if (line.Length >= MaximumLine) {
                            Fail("monitor-output-line-limit");
                            line.Clear();
                            discardLine = true;
                        } else {
                            line.Append(value);
                        }
                    }
                }
                if (protocol && line.Length != 0) Fail("monitor-output-truncated-line");
            } catch (Exception) {
                Fail(protocol ? "monitor-output-read-failed" : "monitor-error-read-failed");
            } finally {
                if (protocol) stdoutEnded = true; else stderrEnded = true;
            }
        }

        public bool TryRead(out string line) {
            if (!lines.TryDequeue(out line)) return false;
            Interlocked.Decrement(ref queued);
            return true;
        }
        public string Fault { get { return Interlocked.CompareExchange(ref fault, null, null); } }
        public string ErrorText { get { lock (errors) { return errors.ToString(); } } }
        public bool Drained { get { return stdoutEnded && stderrEnded && queued == 0; } }
        public bool PermitForeground() {
            return !child.HasExited && AllowSetForegroundWindow(checked((uint)child.Id));
        }
        public void CloseInput() {
            try { child.StandardInput.Close(); } catch (InvalidOperationException) {} catch (IOException) {}
        }
        public void Dispose() {
            if (!child.HasExited) throw new InvalidOperationException("monitor-child-still-running");
            CloseInput();
            child.StandardOutput.Dispose();
            child.StandardError.Dispose();
            child.Dispose();
        }
        public static string QuoteArgument(string value) {
            if (value == null || value.IndexOf('\0') >= 0) throw new ArgumentException("Invalid argument");
            StringBuilder quoted = new StringBuilder("\"");
            int slashes = 0;
            foreach (char character in value) {
                if (character == '\\') { slashes++; continue; }
                if (character == '"') {
                    quoted.Append('\\', slashes * 2 + 1);
                } else {
                    quoted.Append('\\', slashes);
                }
                slashes = 0;
                quoted.Append(character);
            }
            quoted.Append('\\', slashes * 2);
            quoted.Append('"');
            return quoted.ToString();
        }
    }
}
'@

$monitorBootstrap = @'
import hashlib,pathlib,sys,types
p=pathlib.Path(sys.argv[1])
raw=p.read_bytes()
actual=hashlib.sha256(raw).hexdigest()
if actual!='77116240a5a0b21b73d03f9caca5df85bd60d1c37899720fa62b70dca52c1781': raise SystemExit('Monitor bridge hash mismatch; no monitor code executed')
sys.argv=[str(p)]+sys.argv[2:]
m=types.ModuleType('__main__')
m.__file__=str(p)
m.__VERIFIED_BRIDGE_SHA256__=actual
sys.modules['__main__']=m
exec(compile(raw,str(p),'exec'),m.__dict__)
'@

function New-MonitorProcessStartInfo {
    param([string]$Executable, [string[]]$Arguments)
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $info.Arguments = (($Arguments | ForEach-Object { [Stephanos.Starfield.MonitorPipe]::QuoteArgument($_) }) -join ' ')
    $info.WorkingDirectory = $repositoryRoot
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false, $true)
    $info.StandardErrorEncoding = New-Object System.Text.UTF8Encoding($false, $false)
    return $info
}

function Start-MonitorProcess {
    param([Parameter(Mandatory)][System.Diagnostics.Process]$Process)
    if ($Process.StartInfo.UseShellExecute -or -not $Process.StartInfo.CreateNoWindow -or
        -not $Process.StartInfo.RedirectStandardInput -or -not $Process.StartInfo.RedirectStandardOutput -or
        -not $Process.StartInfo.RedirectStandardError) { throw 'monitor-process-start-flags-invalid' }
    # All callers run synchronously on the splash's single PowerShell runspace.
    # .NET Framework creates its stdin writer and flushes its preamble inside
    # Process.Start, before callers can replace that writer. Scope the encoding
    # change to this start and restore the previous encoding on every path.
    $previousEncoding = $null
    $started = $false
    $restoreFailed = $false
    $failure = $null
    try {
        $previousEncoding = [Console]::InputEncoding
        [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false, $true)
        $started = $Process.Start()
        if ($started) { $splashOwnedChildren.Add($Process) }
        else { $failure = 'monitor-process-start-returned-false' }
    } catch {
        $failure = 'monitor-process-start-failed: ' + $_.Exception.Message
    } finally {
        if ($previousEncoding) {
            try { [Console]::InputEncoding = $previousEncoding }
            catch {
                $restoreFailed = $true
                $failure = 'monitor-input-encoding-restore-failed'
                if ($started) {
                    # Keep the child in the owned set, but allow no preparation.
                    try { $Process.StandardInput.Close() } catch {}
                }
            }
        }
    }
    return [pscustomobject]@{ Started = $started; RestoreFailed = $restoreFailed; Error = $failure }
}

function Read-MonitorProbeResult {
    param([Parameter(Mandatory)]$Process, [Parameter(Mandatory)]$Pipe)
    if (-not $Process.WaitForExit(3000)) {
        throw 'The Python check has not returned. No monitor test was started. Leave this result for review.'
    }
    $lines = New-Object System.Collections.Generic.List[string]
    for ($attempt = 0; $attempt -lt 100; $attempt += 1) {
        $line = $null
        while ($Pipe.TryRead([ref]$line)) { $lines.Add($line) }
        if ($Pipe.Drained) { break }
        [System.Threading.Thread]::Sleep(10)
    }
    if (-not $Pipe.Drained -or $Pipe.Fault -or $Process.ExitCode -ne 0 -or $lines.Count -ne 1) { return $null }
    try { $result = $lines[0] | ConvertFrom-Json } catch { return $null }
    if (-not $result -or -not $result.PSObject.Properties['executable'] -or
        $result.executable -isnot [string] -or $result.executable.Length -gt 2048 -or
        $result.executable -cnotmatch '^[A-Za-z]:[\\/]' -or -not [System.IO.Path]::IsPathRooted($result.executable)) { return $null }
    $path = [System.IO.Path]::GetFullPath($result.executable)
    if ([System.IO.Path]::GetExtension($path) -ine '.exe' -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    $file = Get-Item -LiteralPath $path -Force
    if (($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return $null }
    return [pscustomobject]@{ Executable = $file.FullName; Prefix = @() }
}

function Find-MonitorPython {
    # Discovery may use py.exe, but the live child must be the actual interpreter
    # so its process ID and parent identity belong to this splash, not a launcher.
    $probeCode = @'
import ctypes,json,os,struct,sys
from ctypes import wintypes
if os.name!='nt' or sys.version_info<(3,10) or struct.calcsize('P')!=8: raise SystemExit(3)
k=ctypes.WinDLL('kernel32',use_last_error=True)
k.GetCurrentProcess.restype=wintypes.HANDLE
k.QueryFullProcessImageNameW.argtypes=[wintypes.HANDLE,wintypes.DWORD,wintypes.LPWSTR,ctypes.POINTER(wintypes.DWORD)]
k.QueryFullProcessImageNameW.restype=wintypes.BOOL
size=wintypes.DWORD(32768)
buffer=ctypes.create_unicode_buffer(size.value)
if not k.QueryFullProcessImageNameW(k.GetCurrentProcess(),0,buffer,ctypes.byref(size)): raise OSError(ctypes.get_last_error())
print(json.dumps({'executable':buffer.value}))
'@
    foreach ($candidate in @('py.exe', 'python.exe')) {
        $command = Get-Command -Name $candidate -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $command) { continue }
        $prefix = @()
        if ($candidate -eq 'py.exe') { $prefix = @('-3') }
        $probe = New-Object System.Diagnostics.Process
        $probe.StartInfo = New-MonitorProcessStartInfo -Executable $command.Source -Arguments ($prefix + @('-I', '-S', '-B', '-c', $probeCode))
        $start = Start-MonitorProcess -Process $probe
        if (-not $start.Started) {
            $probe.Dispose()
            if ($start.RestoreFailed) { throw $start.Error }
            continue
        }
        $reader = New-Object Stephanos.Starfield.MonitorPipe($probe)
        $reader.CloseInput()
        if ($start.Error) { throw $start.Error }
        $interpreter = Read-MonitorProbeResult -Process $probe -Pipe $reader
        [void]$splashOwnedChildren.Remove($probe)
        $reader.Dispose()
        if ($interpreter) { return $interpreter }
    }
    throw 'The monitor test needs the installed 64-bit Python 3.10 or newer. No monitor test was started.'
}

function Get-MonitorCustodyPaths {
    $savedRoot = Join-Path $env:USERPROFILE 'Documents\Codex\2026-11-05\starfield-vr-did-not-start-and'
    $runRoot = Join-Path $savedRoot 'outputs\Starfield-VR-monitor-one-click-v1'
    $sourceRoot = Join-Path $savedRoot 'work\stephanos-openxr'
    return @(
        (Join-Path $runRoot 'session.json'),
        (Join-Path $runRoot 'operator.lock'),
        (Join-Path $runRoot 'stock-child-consumed.json'),
        (Join-Path $runRoot 'loader-child-consumed.json'),
        (Join-Path $sourceRoot 'native-eye-output-monitor-session-v1.json'),
        (Join-Path $sourceRoot 'native-eye-output-monitor-session-v1.lock'),
        'C:\Program Files (x86)\Steam\steamapps\common\Starfield\dxgi.stephanos-eye-capture-20261106-held'
    )
}

function Test-MonitorCustodyPathPresent {
    param([Parameter(Mandatory)][string]$LiteralPath)
    $path = [System.IO.Path]::GetFullPath($LiteralPath)
    $first = $true
    $present = $false
    while ($path) {
        try {
            $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'monitor-custody-reparse-path' }
            if (-not $first -and -not $item.PSIsContainer) { throw 'monitor-custody-parent-not-directory' }
            if ($first) { $present = $true }
        } catch [System.Management.Automation.ItemNotFoundException] {
            # Only a positively classified missing path can count as absent.
        }
        $first = $false
        $parent = Split-Path -Path $path -Parent
        if ($parent -eq $path) { break }
        $path = $parent
    }
    return $present
}

function Read-MonitorCustodyReceipt {
    $python = Find-MonitorPython
    $arguments = @('-I', '-S', '-B', '-u', '-c', $monitorBootstrap, $monitorBridgePath, '--provider-custody')
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = New-MonitorProcessStartInfo -Executable $python.Executable -Arguments $arguments
    $start = Start-MonitorProcess -Process $process
    if (-not $start.Started) { $process.Dispose(); throw $start.Error }
    $reader = New-Object Stephanos.Starfield.MonitorPipe($process)
    $reader.CloseInput()
    if ($start.Error) { throw $start.Error }
    if (-not $process.WaitForExit(20000)) { throw 'monitor-custody-query-timeout' }
    $lines = New-Object System.Collections.Generic.List[string]
    for ($attempt = 0; $attempt -lt 100; $attempt += 1) {
        $line = $null
        while ($reader.TryRead([ref]$line)) { $lines.Add($line) }
        if ($reader.Drained) { break }
        [System.Threading.Thread]::Sleep(10)
    }
    try {
        if (-not $reader.Drained -or $reader.Fault -or $process.ExitCode -notin @(0, 2) -or $lines.Count -ne 1) { throw 'monitor-custody-query-incomplete' }
        return ($lines[0] | ConvertFrom-Json)
    } finally { [void]$splashOwnedChildren.Remove($process); $reader.Dispose() }
}

function Test-MonitorProviderCustody {
    $monitorState.DurableCustodyReleased = $false
    $monitorState.DurableCustodyReason = 'monitor-custody-unresolved'
    try {
        $present = $false
        foreach ($path in @(Get-MonitorCustodyPaths)) {
            if (Test-MonitorCustodyPathPresent -LiteralPath $path) { $present = $true }
        }
        if (-not $present) {
            # No monitor state exists. Baseline use does not gain a Python
            # dependency; this absence check runs under the same splash mutex.
            $monitorState.DurableCustodyReleased = $true
            $monitorState.DurableCustodyReason = 'no-monitor-custody'
            return $true
        }
        if ($monitorBridgeSha256 -cnotmatch '^[a-f0-9]{64}$' -or $monitorRunnerSha256 -cnotmatch '^[a-f0-9]{64}$' -or
            -not (Test-Path -LiteralPath $monitorBridgePath -PathType Leaf)) { throw 'monitor-custody-component-unavailable' }
        $receipt = Read-MonitorCustodyReceipt
        foreach ($name in @('schema', 'allowed', 'providerSlotReleased', 'reason', 'observationsCurrent', 'noMutationPerformed', 'bridgeSha256', 'runnerSha256')) {
            if (-not $receipt -or -not $receipt.PSObject.Properties[$name]) { throw ('monitor-custody-field-missing:' + $name) }
        }
        foreach ($name in @('allowed', 'providerSlotReleased', 'observationsCurrent', 'noMutationPerformed')) {
            if ($receipt.PSObject.Properties[$name].Value -isnot [bool]) { throw ('monitor-custody-boolean-invalid:' + $name) }
        }
        if ($receipt.schema -isnot [string] -or $receipt.schema -cne 'stephanos.native-eye-output.provider-custody.v1' -or
            $receipt.bridgeSha256 -isnot [string] -or $receipt.bridgeSha256 -cne $monitorBridgeSha256 -or
            $receipt.runnerSha256 -isnot [string] -or $receipt.runnerSha256 -cne $monitorRunnerSha256 -or
            $receipt.reason -isnot [string] -or $receipt.reason -cnotmatch '^[A-Za-z0-9_.:-]{1,160}$' -or
            $receipt.noMutationPerformed -ne $true) { throw 'monitor-custody-identity-invalid' }
        $monitorState.DurableCustodyReason = $receipt.reason
        $monitorState.DurableCustodyReleased = $receipt.allowed -and $receipt.providerSlotReleased -and $receipt.observationsCurrent
        return $monitorState.DurableCustodyReleased
    } catch {
        $monitorState.DurableCustodyReason = 'monitor-custody-inspection-failed'
        return $false
    }
}

function Add-MonitorDetail {
    param([string]$Message)
    if (-not $Message) { return }
    $text = $Message.Substring(0, [Math]::Min($Message.Length, 4096))
    $monitorState.DetailText += $text + [Environment]::NewLine
    if ($monitorState.DetailText.Length -gt 24000) {
        $monitorState.DetailText = $monitorState.DetailText.Substring($monitorState.DetailText.Length - 24000)
    }
    $detailsBox.Text = $monitorState.DetailText
    $detailsBox.SelectionStart = $detailsBox.TextLength
    $detailsBox.ScrollToCaret()
}

function Update-HybridButton {
    if ($processState.ProviderBusy) {
        $hybridButton.Enabled = $false
        return
    }
    if ($monitorState.Process) {
        $hybridButton.Enabled = -not $monitorState.Busy -and -not $monitorState.CloseSent -and -not $monitorState.TransportFailed -and
            ('confirm' -cin $monitorState.AllowedActions -or 'finish' -cin $monitorState.AllowedActions)
        if ('confirm' -cin $monitorState.AllowedActions) { $hybridButton.Text = 'My save is loaded' }
        elseif ('finish' -cin $monitorState.AllowedActions) { $hybridButton.Text = 'Finish cleanup' }
        else { $hybridButton.Text = 'Monitor test running' }
        return
    }
    if ($monitorState.Mode -eq 'idle') {
        $hybridButton.Text = 'Start monitor test'
        $hybridButton.Enabled = $true
    } else {
        $hybridButton.Text = 'Show test result'
        $hybridButton.Enabled = $true
    }
}

function Set-MonitorProviderControls {
    $released = $monitorState.ProviderSlotReleased -and $monitorState.DurableCustodyReleased -and -not $monitorState.Process
    $vorpxButton.Enabled = $released -and -not $processState.ProviderBusy -and $vorpxProfileConfigured
    $mutarButton.Enabled = $released -and -not $processState.ProviderBusy -and $mutarProfileConfigured -and $mutarPackageStaged
    $simulationPanel.Enabled = $released -and -not $processState.ProviderBusy
    $closeButton.Text = if ($monitorState.Process) {
        if ($monitorState.CloseRequested) { 'Stopping...' } else { 'Cancel test' }
    } else { 'Close' }
    Update-HybridButton
}

function Stop-MonitorTransport {
    param([string]$Reason)
    if ($monitorState.TransportFailed) { return }
    $monitorState.TransportFailed = $true
    $monitorState.Busy = $false
    $monitorState.AllowedActions = @()
    if ($monitorState.PrepareDispatched) {
        $monitorState.ProviderSlotReleased = $false
        $monitorState.SafeToClose = $false
    }
    $hybridCard.Status.Text = 'MONITOR RESULT UNRESOLVED'
    $statusLabel.Text = 'Monitor connection needs review'
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
    $statusHint.Text = 'Cancellation and normal cleanup are being requested. Exit Starfield through its usual menu if it stays open.'
    Add-MonitorDetail -Message $Reason
    if ($monitorState.Pipe) { $monitorState.Pipe.CloseInput() }
    Set-MonitorProviderControls
}

function Send-MonitorCommand {
    param([ValidateSet('prepare', 'confirm', 'finish', 'cancel', 'close')][string]$Command)
    if (-not $monitorState.Process -or $monitorState.Process.HasExited -or $monitorState.TransportFailed -or $monitorState.CloseSent) { return $false }
    if ($Command -in @('prepare', 'confirm', 'finish') -and $Command -cnotin $monitorState.AllowedActions) { return $false }
    if ($Command -eq 'confirm') {
        if ($monitorState.Mode -cne 'waiting' -or $monitorState.Busy -or -not $monitorState.ConfirmationToken -or -not $monitorState.GameProcess) { return $false }
        # The actual save-loaded click owns foreground input; permit only this
        # exact child to return focus to the game before its existing guard runs.
        if (-not $monitorState.Pipe.PermitForeground()) {
            $statusHint.Text = 'Select this splash window and click My save is loaded again so it can return focus to the game.'
            return $false
        }
    }
    $monitorState.RequestSequence += 1L
    $request = [ordered]@{
        schema = $monitorProtocol
        channel = $monitorState.Channel
        sequence = $monitorState.RequestSequence
        command = $Command
    }
    if ($Command -eq 'confirm') {
        $request.confirmationToken = $monitorState.ConfirmationToken
        $request.runId = $monitorState.RunId
        $request.pid = $monitorState.GameProcess.pid
        $request.createdFileTime = $monitorState.GameProcess.createdFileTime
        $monitorState.ConfirmationToken = $null
    }
    if ($Command -in @('prepare', 'confirm', 'finish')) {
        $monitorState.PrepareDispatched = $true
        $monitorState.ProviderSlotReleased = $false
        $monitorState.DurableCustodyReleased = $false
        $monitorState.SafeToClose = $false
        $monitorState.Busy = $true
        $monitorState.AllowedActions = @('cancel', 'close')
    }
    if ($Command -in @('cancel', 'close')) { $monitorState.CloseSent = $true }
    try {
        $monitorState.Process.StandardInput.WriteLine(($request | ConvertTo-Json -Depth 6 -Compress))
        $monitorState.Process.StandardInput.Flush()
        # Both terminal requests stop the session. Release its input reader only
        # after the complete request is flushed; no further command is valid.
        if ($Command -in @('cancel', 'close')) { $monitorState.Pipe.CloseInput() }
        Set-MonitorProviderControls
        return $true
    } catch {
        Stop-MonitorTransport -Reason ('monitor-command-write-failed: ' + $_.Exception.Message)
        return $false
    }
}

function Test-MonitorBooleanFields {
    param($Event)
    foreach ($name in @('busy', 'cleanupComplete', 'normalExitProven', 'analysisAccepted', 'bundleEvidenceIntegrityVerified', 'unresolvedChild', 'playableVRProven', 'safeToClose', 'providerSlotReleased')) {
        $property = $Event.PSObject.Properties[$name]
        if (-not $property -or $property.Value -isnot [bool]) { throw ('monitor-event-invalid-boolean:' + $name) }
    }
    if ($Event.playableVRProven -ne $false) { throw 'monitor-event-cannot-claim-headset-vr' }
    if ($Event.providerSlotReleased -and (-not $Event.safeToClose -or $Event.unresolvedChild)) { throw 'monitor-event-inconsistent-release' }
}

function Receive-MonitorEvent {
    param([string]$Line)
    if ([string]::IsNullOrWhiteSpace($Line) -or $Line.Length -gt 32768) { throw 'monitor-event-invalid-line' }
    $event = $Line | ConvertFrom-Json
    foreach ($name in @('schema', 'channel', 'eventSequence', 'type')) {
        if (-not $event -or -not $event.PSObject.Properties[$name]) { throw ('monitor-event-missing:' + $name) }
    }
    if ($event.schema -isnot [string] -or $event.schema -cne $monitorProtocol -or
        $event.channel -isnot [string] -or $event.channel -cne $monitorState.Channel) { throw 'monitor-event-channel-mismatch' }
    if (($event.eventSequence -isnot [int] -and $event.eventSequence -isnot [long]) -or
        $event.eventSequence -ne ($monitorState.EventSequence + 1L)) { throw 'monitor-event-sequence-mismatch' }
    $monitorState.EventSequence = [long]$event.eventSequence
    if ($event.type -ceq 'progress') {
        if (-not $event.PSObject.Properties['message'] -or $event.message -isnot [string] -or $event.message.Length -gt 4096) { throw 'monitor-progress-invalid' }
        Add-MonitorDetail -Message $event.message
        if ($monitorState.Busy) { $statusHint.Text = $event.message }
        return
    }
    if ($event.type -cnotin @('state', 'closed')) { throw 'monitor-event-type-invalid' }
    foreach ($name in @('mode', 'allowedActions', 'runId', 'process', 'confirmationToken', 'outcome', 'resultZip', 'resultDirectory', 'error', 'childPid', 'bridgeSha256', 'runnerSha256')) {
        if (-not $event.PSObject.Properties[$name]) { throw ('monitor-state-missing:' + $name) }
    }
    if (($event.childPid -isnot [int] -and $event.childPid -isnot [long]) -or $event.childPid -ne $monitorState.Process.Id -or
        $event.bridgeSha256 -isnot [string] -or $event.bridgeSha256 -cne $monitorBridgeSha256 -or
        $event.runnerSha256 -isnot [string] -or $event.runnerSha256 -cne $monitorRunnerSha256) { throw 'monitor-state-child-identity-mismatch' }
    Test-MonitorBooleanFields -Event $event
    if ($event.mode -isnot [string] -or $event.mode -cnotin @('ready', 'waiting', 'existing', 'done', 'cleanup', 'blocked')) { throw 'monitor-state-mode-invalid' }
    if ($event.allowedActions -isnot [System.Array] -or $event.allowedActions.Length -gt 5) { throw 'monitor-state-actions-invalid' }
    foreach ($action in $event.allowedActions) {
        if ($action -isnot [string] -or $action -cnotin @('prepare', 'confirm', 'finish', 'cancel', 'close')) { throw 'monitor-state-action-invalid' }
    }
    if ($event.busy -and (@($event.allowedActions | Where-Object { $_ -cnotin @('cancel', 'close') }).Count -ne 0)) { throw 'monitor-state-busy-action-invalid' }
    if ($null -ne $event.runId -and ($event.runId -isnot [string] -or $event.runId -cnotmatch '^[a-f0-9]{32}$')) { throw 'monitor-state-run-invalid' }
    if ($null -ne $event.process) {
        if (-not $event.process.PSObject.Properties['pid'] -or -not $event.process.PSObject.Properties['createdFileTime'] -or
            ($event.process.pid -isnot [int] -and $event.process.pid -isnot [long]) -or $event.process.pid -le 0 -or $event.process.pid -gt 4294967295 -or
            $event.process.createdFileTime -isnot [string] -or $event.process.createdFileTime -cnotmatch '^[0-9]{16,20}$') { throw 'monitor-state-process-invalid' }
    }
    if ($null -ne $event.confirmationToken -and ($event.confirmationToken -isnot [string] -or $event.confirmationToken -cnotmatch '^[a-f0-9]{32,128}$')) { throw 'monitor-state-confirmation-invalid' }
    if ('confirm' -cin $event.allowedActions -and ($event.mode -cne 'waiting' -or $event.busy -or -not $event.runId -or -not $event.process -or -not $event.confirmationToken)) { throw 'monitor-state-confirmation-not-bound' }
    foreach ($name in @('outcome', 'error', 'resultZip', 'resultDirectory')) {
        $value = $event.PSObject.Properties[$name].Value
        if ($null -ne $value -and ($value -isnot [string] -or $value.Length -gt 4096)) { throw ('monitor-state-text-invalid:' + $name) }
    }
    $monitorState.Mode = $event.mode
    $monitorState.Busy = $event.busy
    $monitorState.AllowedActions = @($event.allowedActions)
    $monitorState.ConfirmationToken = $event.confirmationToken
    $monitorState.RunId = $event.runId
    $monitorState.GameProcess = $event.process
    $monitorState.SafeToClose = $event.safeToClose
    $monitorState.ProviderSlotReleased = $event.providerSlotReleased
    $monitorState.Result = $event
    if ($event.type -ceq 'closed') { $monitorState.ClosedReceived = $true }

    if ($event.mode -ceq 'ready' -and $monitorState.PendingPrepare) {
        $monitorState.PendingPrepare = $false
        if ($monitorState.CloseRequested) { [void](Send-MonitorCommand -Command 'close') }
        else { [void](Send-MonitorCommand -Command 'prepare') }
        return
    }
    if ($event.error) { Add-MonitorDetail -Message $event.error }
    if ($event.busy) {
        $hybridCard.Status.Text = 'MONITOR TEST RUNNING'
        $statusLabel.Text = 'Stephanos monitor test'
        $statusHint.Text = 'The reviewed monitor test is running. This window will show its result.'
    } elseif ($event.mode -ceq 'waiting') {
        $hybridCard.Status.Text = 'WAITING FOR YOUR SAVE'
        $statusLabel.Text = 'Load your usual Starfield save'
        $statusHint.Text = 'Leave your character still, then click My save is loaded on the third card.'
        $progressFill.Width = 270
    } elseif ($event.mode -cin @('existing', 'cleanup')) {
        $hybridCard.Status.Text = 'CLEANUP REQUIRED'
        $statusLabel.Text = 'Finish the existing monitor session'
        $statusHint.Text = 'Exit Starfield through its usual menu if it is open, then click Finish cleanup.'
        $progressFill.BackColor = [System.Drawing.Color]::FromArgb(255, 172, 103)
    } elseif ($event.mode -cin @('done', 'blocked')) {
        $passed = $event.outcome -ceq 'REVIEWED_MONITOR_TEST_PASSED' -and $event.analysisAccepted -and
            $event.bundleEvidenceIntegrityVerified -and $event.cleanupComplete -and $event.normalExitProven -and
            $event.providerSlotReleased -and $event.safeToClose -and -not $event.unresolvedChild
        $hybridCard.Status.Text = if ($passed) { 'MONITOR TEST PASSED' } else { 'MONITOR TEST NEEDS REVIEW' }
        $statusLabel.Text = if ($passed) { 'Monitor test passed' } else { 'Monitor test stopped for review' }
        $statusLabel.ForeColor = if ($passed) { [System.Drawing.Color]::FromArgb(174, 255, 221) } else { [System.Drawing.Color]::FromArgb(255, 197, 153) }
        $statusHint.Text = if ($event.providerSlotReleased) {
            'The result is saved below. Headset playtesting remains unavailable.'
        } else {
            'Cleanup is not yet proven. Exit Starfield normally; the other provider buttons remain held.'
        }
        $progressFill.Width = 850
        $progressFill.BackColor = if ($passed) { [System.Drawing.Color]::FromArgb(113, 236, 193) } else { [System.Drawing.Color]::FromArgb(255, 172, 103) }
        Add-MonitorDetail -Message ('Outcome: ' + $(if ($event.outcome) { $event.outcome } else { 'NO_CAPTURE_RESULT' }))
        Add-MonitorDetail -Message ('Capture evidence accepted: ' + $event.analysisAccepted + '; cleanup complete: ' + $event.cleanupComplete + '; normal exit proven: ' + $event.normalExitProven)
        if ($event.resultZip) { Add-MonitorDetail -Message ('Saved result: ' + $event.resultZip) }
        if ($event.safeToClose -and -not $monitorState.CloseSent -and $event.type -cne 'closed') {
            [void](Send-MonitorCommand -Command 'close')
        }
    }
    Set-MonitorProviderControls
}

function Start-MonitorFromHybridCard {
    if ($processState.CloseRequested -or $processState.ProviderBusy -or $monitorState.Process -or $monitorState.Mode -cne 'idle') { return }
    $detailsBox.Visible = $true
    $detailsButton.Text = 'Hide details'
    $monitorState.DetailText = ''
    $statusLabel.Text = 'Preparing the Stephanos monitor test'
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(234, 244, 255)
    $statusHint.Text = 'The saved build will be checked before the game starts. This is a monitor test.'
    $telemetryLabel.Text = 'STEPHANOS MONITOR | Reviewed saved build | Headset playtest not ready'
    $hybridCard.Status.Text = 'PREPARING MONITOR TEST'
    $hybridButton.Enabled = $false
    $vorpxButton.Enabled = $false
    $mutarButton.Enabled = $false
    $simulationPanel.Enabled = $false
    $form.Refresh()
    try {
        if ($monitorBridgeSha256 -cnotmatch '^[a-f0-9]{64}$' -or $monitorRunnerSha256 -cnotmatch '^[a-f0-9]{64}$' -or
            -not (Test-Path -LiteralPath $monitorBridgePath -PathType Leaf)) {
            throw 'The reviewed monitor component is missing from this launcher update. No monitor test was started.'
        }
        if (-not (Disable-SimulatedAirLinkForRealLaunch)) { throw 'The readiness-only Air Link simulation could not be cleared. No monitor test was started.' }
        $python = Find-MonitorPython
        $monitorState.Channel = [guid]::NewGuid().ToString('N')
        $parentCreated = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToFileTimeUtc().ToString([System.Globalization.CultureInfo]::InvariantCulture)
        $arguments = @($python.Prefix) + @('-I', '-S', '-B', '-u', '-c', $monitorBootstrap, $monitorBridgePath,
            '--parent-pid', [string]$PID, '--parent-filetime', $parentCreated, '--channel', $monitorState.Channel)
        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = New-MonitorProcessStartInfo -Executable $python.Executable -Arguments $arguments
        $start = Start-MonitorProcess -Process $process
        if (-not $start.Started) { $process.Dispose(); throw $start.Error }
        $monitorState.Process = $process
        $monitorState.Pipe = New-Object Stephanos.Starfield.MonitorPipe($process)
        if ($start.Error) { throw $start.Error }
        $monitorState.StartedAtUtc = [DateTime]::UtcNow
        $monitorState.PendingPrepare = $true
        $monitorState.Mode = 'starting'
        $process.StandardInput.AutoFlush = $true
        $monitorPollTimer.Start()
        Add-MonitorDetail -Message 'Monitor test selected from Hybrid / Stephanos VR. Waiting for the reviewed runner.'
    } catch {
        $monitorState.Mode = 'blocked'
        $statusLabel.Text = 'Stephanos monitor test could not start'
        $statusHint.Text = $_.Exception.Message
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
        $hybridCard.Status.Text = 'MONITOR TEST BLOCKED'
        Add-MonitorDetail -Message $_.Exception.Message
        if ($monitorState.Process) {
            if ($monitorState.Pipe) { $monitorState.Pipe.CloseInput() }
            else { try { $monitorState.Process.StandardInput.Close() } catch {} }
            $monitorPollTimer.Start()
        }
        Set-MonitorProviderControls
    }
}

function Start-StarfieldVrLauncherProcess {
    param(
        [Parameter(Mandatory)][string]$SelectedProfilePath,
        [switch]$ReadinessOnly
    )

    $arguments = @(
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle', 'Hidden',
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"{0}"' -f $launcherScript),
        '-ProfilePath', ('"{0}"' -f $SelectedProfilePath)
    )
    if ($ReadinessOnly) { $arguments += '-ReadinessOnly' }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $powershellExecutable
    $startInfo.Arguments = ($arguments -join ' ')
    $startInfo.WorkingDirectory = $repositoryRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    [void]$process.Start()
    $splashOwnedChildren.Add($process)
    return $process
}

function Start-AerObserveProcess {
    $arguments = @(
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle', 'Hidden',
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"{0}"' -f $aerObserveScript)
    )

    # AER startup can emit a multi-kilobyte PowerShell error record. Redirecting
    # to unread anonymous pipes can deadlock the child before HasExited becomes
    # true, leaving the splash parked forever on "Launching AER Observe".
    # File-backed capture drains continuously without a reader thread.
    $captureId = [guid]::NewGuid().ToString('N')
    $stdoutPath = Join-Path ([System.IO.Path]::GetTempPath()) ("starfield-vr-aer-$captureId.stdout.log")
    $stderrPath = Join-Path ([System.IO.Path]::GetTempPath()) ("starfield-vr-aer-$captureId.stderr.log")
    $process = Start-Process -FilePath $powershellExecutable -ArgumentList $arguments -WorkingDirectory $repositoryRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    $splashOwnedChildren.Add($process)
    $process | Add-Member -NotePropertyName StephanosStdoutPath -NotePropertyValue $stdoutPath
    $process | Add-Member -NotePropertyName StephanosStderrPath -NotePropertyValue $stderrPath
    return $process
}

$script:aerObserveRuntimeSourceHead = ''
function Test-AerObserveReady {
    $script:aerObserveRuntimeSourceHead = ''
    try {
        $json = & $powershellExecutable -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $aerObserveScript -ValidateOnly 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0 -or -not $json.Trim()) { return $false }
        $payload = $json.Trim() | ConvertFrom-Json
        $candidateHead = ([string]$payload.runtimeSourceHead).ToLowerInvariant()
        if ($candidateHead.Length -ne 40 -or $candidateHead -notmatch '^[a-f0-9]{40}') { return $false }
        $script:aerObserveRuntimeSourceHead = $candidateHead
        return [bool]$payload.ready -and [string]$payload.mode -eq 'OBSERVE' -and [bool]$payload.rollbackArmed
    }
    catch {
        $script:aerObserveRuntimeSourceHead = ''
        return $false
    }
}

function Complete-StarfieldVrLauncherProcess {
    param([Parameter(Mandatory)]$Process)

    if (-not $Process.HasExited) { return $null }

    $stdoutPathProperty = $Process.PSObject.Properties['StephanosStdoutPath']
    $stderrPathProperty = $Process.PSObject.Properties['StephanosStderrPath']
    if ($stdoutPathProperty -or $stderrPathProperty) {
        $stdoutPath = if ($stdoutPathProperty) { [string]$stdoutPathProperty.Value } else { '' }
        $stderrPath = if ($stderrPathProperty) { [string]$stderrPathProperty.Value } else { '' }
        $stdout = if ($stdoutPath -and (Test-Path -LiteralPath $stdoutPath -PathType Leaf)) {
            Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue
        } else { '' }
        $stderr = if ($stderrPath -and (Test-Path -LiteralPath $stderrPath -PathType Leaf)) {
            Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue
        } else { '' }
        foreach ($capturePath in @($stdoutPath, $stderrPath)) {
            if ($capturePath) {
                Remove-Item -LiteralPath $capturePath -Force -ErrorAction SilentlyContinue
            }
        }
    }
    else {
        $stdout = $Process.StandardOutput.ReadToEnd()
        $stderr = $Process.StandardError.ReadToEnd()
    }

    $exitCode = $Process.ExitCode
    [void]$splashOwnedChildren.Remove($Process)
    $Process.Dispose()

    return [pscustomobject]@{
        ExitCode = $exitCode
        Stdout = [string]$stdout
        Stderr = [string]$stderr
    }
}

function Start-ProviderSlotProcess {
    param([Parameter(Mandatory)][string]$Provider)

    if (Get-Process -Name 'Starfield' -ErrorAction SilentlyContinue) {
        throw 'provider-slot-switch-blocked-starfield-running'
    }
    if (-not (Test-MonitorProviderCustody)) {
        throw ('provider-slot-switch-blocked-monitor-custody:' + $monitorState.DurableCustodyReason)
    }

    $arguments = @(
        ('"{0}"' -f $providerSlotScript),
        '--manifest', ('"{0}"' -f $providerCachePath),
        '--provider', $Provider,
        '--apply'
    )
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $nodeExecutable
    $startInfo.Arguments = ($arguments -join ' ')
    $startInfo.WorkingDirectory = $repositoryRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    [void]$process.Start()
    $splashOwnedChildren.Add($process)
    return $process
}

function Get-SafeInvocationMessage {
    param($Invocation, [string]$Fallback)

    if ($Invocation) {
        $stderrText = [string]$Invocation.Stderr
        $stdoutText = [string]$Invocation.Stdout
        if (-not [string]::IsNullOrWhiteSpace($stderrText)) { return $stderrText.Trim() }
        if (-not [string]::IsNullOrWhiteSpace($stdoutText)) { return $stdoutText.Trim() }
    }
    return $Fallback
}

function ConvertFrom-LastJsonObject {
    param([string]$Text)

    $candidate = [string]$Text
    if ([string]::IsNullOrWhiteSpace($candidate)) { return $null }
    $match = [regex]::Match($candidate, '(?s)\{.*\}\s*$')
    if (-not $match.Success) { return $null }
    try { return ($match.Value | ConvertFrom-Json) } catch { return $null }
}

function Get-SafeBlockerText {
    param($Result)

    $items = @()
    $decision = $null
    if ($Result -and $Result.PSObject.Properties['decision']) {
        $decision = $Result.decision
    }
    if ($decision -and $decision.PSObject.Properties['blockers'] -and $decision.blockers) {
        foreach ($blocker in @($decision.blockers)) {
            $text = [string]$blocker
            if ($text -and $text.Length -le 160 -and $text -match '^[A-Za-z0-9._:-]+$') {
                $items += $text
            }
        }
    }
    if ($items.Count -eq 0) { $items = @('verified-vr-route-not-ready') }
    return $items
}

function Test-ProviderProfileConfigured {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Provider
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    try {
        $profile = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
        return [string]$profile.schemaVersion -eq 'stephanos.starfield-vr-launch-profile.v1' -and
            [string]$profile.status -eq 'ready' -and
            [string]$profile.selectedProvider -eq $Provider
    }
    catch {
        return $false
    }
}

function Test-MutarPackageStaged {
    if (-not (Test-Path -LiteralPath $providerCachePath -PathType Leaf)) { return $false }
    try {
        $cache = Get-Content -LiteralPath $providerCachePath -Raw | ConvertFrom-Json
        $provider = $cache.providers.'mutar-openxr'
        if (-not $provider -or [string]$provider.status -notin @('experimental-source', 'verified-source')) { return $false }
        foreach ($file in @($provider.files)) {
            if (-not (Test-Path -LiteralPath ([string]$file.path) -PathType Leaf)) { return $false }
        }
        return $true
    }
    catch {
        return $false
    }
}

function Write-ProviderPreference {
    param([Parameter(Mandatory)][string]$Provider)
    try {
        $parent = Split-Path -Parent $providerPreferencePath
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }
        $payload = [ordered]@{
            schemaVersion = 'stephanos.starfield-vr-provider-preference.v1'
            selectedProvider = $Provider
            writtenAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        } | ConvertTo-Json -Depth 4
        [System.IO.File]::WriteAllText(
            $providerPreferencePath,
            $payload,
            (New-Object System.Text.UTF8Encoding($false))
        )
        return $true
    }
    catch {
        return $false
    }
}

function Set-SimulatedAirLinkState {
    param([Parameter(Mandatory)][bool]$Enabled)
    try {
        $parent = Split-Path -Parent $simulationStatePath
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }
        $payload = [ordered]@{
            schemaVersion = 'stephanos.starfield-vr-sim-air-link.v1'
            enabled = $Enabled
            purpose = 'readiness-only'
            updatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        } | ConvertTo-Json -Depth 4
        [System.IO.File]::WriteAllText(
            $simulationStatePath,
            $payload + [Environment]::NewLine,
            (New-Object System.Text.UTF8Encoding($false))
        )
        $script:simulationEnabled = $Enabled
        return $true
    }
    catch {
        return $false
    }
}

function Update-SimulationToggleUi {
    if (-not $simulationPanel -or -not $simulationLight -or -not $simulationLabel) { return }
    $simulationLight.BackColor = if ($script:simulationEnabled) {
        [System.Drawing.Color]::FromArgb(64, 210, 142)
    } else {
        [System.Drawing.Color]::FromArgb(70, 78, 88)
    }
    $simulationLabel.Text = if ($script:simulationEnabled) {
        'SIM AIR LINK: ON | TURN OFF (TEST)'
    } else {
        'SIM AIR LINK: OFF | TURN ON (TEST)'
    }
}

function Disable-SimulatedAirLinkForRealLaunch {
    if (-not $script:simulationEnabled) { return $true }
    if (-not (Set-SimulatedAirLinkState -Enabled $false)) { return $false }
    Update-SimulationToggleUi
    return $true
}

$fontFamily = 'Segoe UI'
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Starfield VR'
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.ClientSize = New-Object System.Drawing.Size(1040, 780)
$form.BackColor = [System.Drawing.Color]::FromArgb(2, 6, 12)
$form.AllowTransparency = $false
$form.KeyPreview = $true
$form.ShowInTaskbar = $true
$form.Opacity = 1.0

$stars = New-Object System.Collections.Generic.List[object]
$random = New-Object System.Random(1591)
for ($i = 0; $i -lt 95; $i++) {
    $stars.Add([pscustomobject]@{
        X = $random.Next(18, 902)
        Y = $random.Next(16, 410)
        Size = $random.Next(1, 4)
        Alpha = $random.Next(75, 220)
    })
}

$form.Add_Paint({
    param($sender, $eventArgs)
    $graphics = $eventArgs.Graphics
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    $rect = New-Object System.Drawing.Rectangle(0, 0, $form.ClientSize.Width, $form.ClientSize.Height)
    $gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(2, 6, 12),
        [System.Drawing.Color]::FromArgb(5, 12, 20),
        18.0
    )
    $graphics.FillRectangle($gradient, $rect)
    $gradient.Dispose()

    foreach ($star in $stars) {
        $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb([Math]::Min(28, $star.Alpha), 205, 229, 255))
        $graphics.FillEllipse($brush, $star.X, $star.Y, $star.Size, $star.Size)
        $brush.Dispose()
    }

    $arcPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(30, 93, 203, 255), 1.3)
    $graphics.DrawArc($arcPen, 590, 58, 270, 270, 205, 190)
    $graphics.DrawArc($arcPen, 627, 91, 205, 205, 28, 184)
    $arcPen.Dispose()

    $horizonPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(56, 91, 222, 255), 1.0)
    $graphics.DrawLine($horizonPen, 64, 402, 856, 402)
    $horizonPen.Dispose()
})

$eyebrow = New-Object System.Windows.Forms.Label
$eyebrow.AutoSize = $true
$eyebrow.Location = New-Object System.Drawing.Point(68, 58)
$eyebrow.ForeColor = [System.Drawing.Color]::FromArgb(146, 201, 230)
$eyebrow.Font = New-Object System.Drawing.Font($fontFamily, 10, [System.Drawing.FontStyle]::Bold)
$eyebrow.Text = 'STEPHANOS / QUEST 3 / META AIR LINK'
$form.Controls.Add($eyebrow)

$title = New-Object System.Windows.Forms.Label
$title.AutoSize = $false
$title.Location = New-Object System.Drawing.Point(62, 90)
$title.ForeColor = [System.Drawing.Color]::FromArgb(245, 249, 255)
$title.Font = New-Object System.Drawing.Font($fontFamily, 34, [System.Drawing.FontStyle]::Bold)
$title.Size = New-Object System.Drawing.Size(520, 54)
$title.BackColor = [System.Drawing.Color]::Transparent
$title.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$title.Text = 'STARFIELD VR'
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.AutoSize = $false
$subtitle.Location = New-Object System.Drawing.Point(68, 154)
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(154, 174, 197)
$subtitle.Size = New-Object System.Drawing.Size(520, 24)
$subtitle.BackColor = [System.Drawing.Color]::Transparent
$subtitle.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$subtitle.Font = New-Object System.Drawing.Font($fontFamily, 10.5)
$subtitle.Text = 'CHOOSE YOUR VERIFIED VR ROUTE'
$form.Controls.Add($subtitle)

$dragState = [pscustomobject]@{
    Active = $false
    Offset = New-Object System.Drawing.Point(0, 0)
}
$beginDrag = {
    param($sender, $eventArgs)
    if ($eventArgs.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }
    $screenPoint = $sender.PointToScreen($eventArgs.Location)
    $dragState.Active = $true
    $dragState.Offset = New-Object System.Drawing.Point(
        ($screenPoint.X - $form.Left),
        ($screenPoint.Y - $form.Top)
    )
}
$moveDrag = {
    param($sender, $eventArgs)
    if (-not $dragState.Active -or $eventArgs.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }
    $cursor = [System.Windows.Forms.Control]::MousePosition
    $form.Location = New-Object System.Drawing.Point(
        ($cursor.X - $dragState.Offset.X),
        ($cursor.Y - $dragState.Offset.Y)
    )
}
$endDrag = {
    $dragState.Active = $false
}
foreach ($dragSurface in @($form, $eyebrow, $title, $subtitle)) {
    $dragSurface.Add_MouseDown($beginDrag)
    $dragSurface.Add_MouseMove($moveDrag)
    $dragSurface.Add_MouseUp($endDrag)
}

[void](Test-MonitorProviderCustody)

$vorpxProfileConfigured = Test-ProviderProfileConfigured -Path $ProfilePath -Provider 'vorpx'
$mutarProfileConfigured = Test-ProviderProfileConfigured -Path $MutarProfilePath -Provider 'mutar-openxr'
$mutarPackageStaged = Test-MutarPackageStaged
$aerObserveReady = if ($mutarProfileConfigured -and $mutarPackageStaged) { Test-AerObserveReady } else { $false }

function New-ProviderCard {
    param(
        [Parameter(Mandatory)][int]$X,
        [Parameter(Mandatory)][string]$Title,
        [Parameter(Mandatory)][string]$Status,
        [Parameter(Mandatory)][string]$ActionText,
        [Parameter(Mandatory)][System.Drawing.Color]$BorderColor,
        [Parameter(Mandatory)][System.Drawing.Color]$CardColor,
        [Parameter(Mandatory)][System.Drawing.Color]$StatusColor,
        [Parameter(Mandatory)][bool]$Enabled
    )

    $panel = New-Object System.Windows.Forms.Panel
    $panel.Location = New-Object System.Drawing.Point($X, 198)
    $panel.Size = New-Object System.Drawing.Size(280, 138)
    $panel.BackColor = $CardColor
    $panel.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
    $form.Controls.Add($panel)

    $titleLabel = New-Object System.Windows.Forms.Label
    $titleLabel.AutoSize = $false
    $titleLabel.Location = New-Object System.Drawing.Point(16, 14)
    $titleLabel.Size = New-Object System.Drawing.Size(248, 26)
    $titleLabel.Font = New-Object System.Drawing.Font($fontFamily, 12, [System.Drawing.FontStyle]::Bold)
    $titleLabel.ForeColor = [System.Drawing.Color]::FromArgb(238, 246, 255)
    $titleLabel.Text = $Title
    $panel.Controls.Add($titleLabel)

    $statusLabel = New-Object System.Windows.Forms.Label
    $statusLabel.AutoSize = $false
    $statusLabel.Location = New-Object System.Drawing.Point(16, 52)
    $statusLabel.Size = New-Object System.Drawing.Size(248, 18)
    $statusLabel.Font = New-Object System.Drawing.Font($fontFamily, 8.5, [System.Drawing.FontStyle]::Bold)
    $statusLabel.ForeColor = $StatusColor
    $statusLabel.Text = $Status
    $statusLabel.AutoEllipsis = $true
    $panel.Controls.Add($statusLabel)

    $button = New-Object System.Windows.Forms.Button
    $button.Location = New-Object System.Drawing.Point(16, 94)
    $button.Size = New-Object System.Drawing.Size(248, 30)
    $button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $button.FlatAppearance.BorderSize = 1
    $button.FlatAppearance.BorderColor = $BorderColor
    $button.BackColor = [System.Drawing.Color]::FromArgb(19, 31, 46)
    $button.ForeColor = if ($Enabled) {
        [System.Drawing.Color]::FromArgb(233, 244, 255)
    } else {
        [System.Drawing.Color]::FromArgb(185, 195, 208)
    }
    $button.Font = New-Object System.Drawing.Font($fontFamily, 9, [System.Drawing.FontStyle]::Bold)
    $button.Text = $ActionText
    $button.Enabled = $Enabled
    $panel.Controls.Add($button)

    return [pscustomobject]@{
        Panel = $panel
        Title = $titleLabel
        Status = $statusLabel
        Button = $button
    }
}

$vorpxStatus = if ($vorpxProfileConfigured) { 'PLAYTESTED BASELINE' } else { 'PROFILE NOT CONFIGURED' }
$vorpxArgs = @{
    X = 68
    Title = 'VorpX Baseline'
    Status = $vorpxStatus
    ActionText = 'Launch VorpX'
    BorderColor = [System.Drawing.Color]::FromArgb(82, 178, 222)
    CardColor = [System.Drawing.Color]::FromArgb(8, 30, 46)
    StatusColor = [System.Drawing.Color]::FromArgb(134, 214, 247)
    Enabled = ($vorpxProfileConfigured -and $monitorState.DurableCustodyReleased)
}
$vorpxCard = New-ProviderCard @vorpxArgs
$vorpxButton = $vorpxCard.Button

if ($mutarProfileConfigured -and $mutarPackageStaged) {
    $mutarStatus = if ($aerObserveReady) { 'STABILIZED AER READY' } else { 'STABILIZER READY / SLOT SWITCH' }
    $mutarAction = 'Launch Stabilized MutaR'
    $mutarEnabled = $true
}
elseif ($mutarProfileConfigured) {
    $mutarStatus = 'STABILIZER ASSETS NOT READY'
    $mutarAction = 'Needs AER stabilizer'
    $mutarEnabled = $false
}
elseif ($mutarPackageStaged) {
    $mutarStatus = 'STAGED / NOT CONFIGURED'
    $mutarAction = 'Needs profile'
    $mutarEnabled = $false
}
else {
    $mutarStatus = 'PACKAGE NOT STAGED'
    $mutarAction = 'Needs profile'
    $mutarEnabled = $false
}
$mutarArgs = @{
    X = 380
    Title = 'Mutar / OpenXR'
    Status = $mutarStatus
    ActionText = $mutarAction
    BorderColor = [System.Drawing.Color]::FromArgb(120, 142, 230)
    CardColor = [System.Drawing.Color]::FromArgb(16, 23, 52)
    StatusColor = [System.Drawing.Color]::FromArgb(171, 184, 255)
    Enabled = ($mutarEnabled -and $monitorState.DurableCustodyReleased)
}
$mutarCard = New-ProviderCard @mutarArgs
$mutarButton = $mutarCard.Button

$aerObserveCheckbox = New-Object System.Windows.Forms.CheckBox
$aerObserveCheckbox.Location = New-Object System.Drawing.Point(16, 72)
$aerObserveCheckbox.Size = New-Object System.Drawing.Size(248, 18)
$aerObserveCheckbox.BackColor = [System.Drawing.Color]::Transparent
$aerObserveCheckbox.ForeColor = if ($aerObserveReady) {
    [System.Drawing.Color]::FromArgb(141, 235, 194)
} else {
    [System.Drawing.Color]::FromArgb(137, 145, 158)
}
$aerObserveCheckbox.Font = New-Object System.Drawing.Font($fontFamily, 8, [System.Drawing.FontStyle]::Bold)
$aerObserveCheckbox.Text = 'STABILIZED AER / AUTO RECORD (REQUIRED)'
$aerObserveCheckbox.Checked = $mutarPackageStaged
$aerObserveCheckbox.Enabled = $false
$mutarCard.Panel.Controls.Add($aerObserveCheckbox)
if ($aerObserveReady) {
    $mutarButton.Text = 'Launch AER Observe'
}

$hybridArgs = @{
    X = 692
    Title = 'Hybrid / Stephanos VR'
    Status = 'MONITOR TEST'
    ActionText = 'Start monitor test'
    BorderColor = [System.Drawing.Color]::FromArgb(197, 158, 91)
    CardColor = [System.Drawing.Color]::FromArgb(18, 22, 28)
    StatusColor = [System.Drawing.Color]::FromArgb(233, 193, 130)
    Enabled = $true
}
$hybridCard = New-ProviderCard @hybridArgs
$hybridButton = $hybridCard.Button

$hybridHeadsetLabel = New-Object System.Windows.Forms.Label
$hybridHeadsetLabel.Location = New-Object System.Drawing.Point(16, 72)
$hybridHeadsetLabel.Size = New-Object System.Drawing.Size(248, 18)
$hybridHeadsetLabel.ForeColor = [System.Drawing.Color]::FromArgb(170, 182, 196)
$hybridHeadsetLabel.Font = New-Object System.Drawing.Font($fontFamily, 8)
$hybridHeadsetLabel.Text = 'HEADSET PLAYTEST NOT READY'
$hybridCard.Panel.Controls.Add($hybridHeadsetLabel)

$modeLegendPanel = New-Object System.Windows.Forms.Panel
$modeLegendPanel.Location = New-Object System.Drawing.Point(68, 344)
$modeLegendPanel.Size = New-Object System.Drawing.Size(592, 22)
$modeLegendPanel.BackColor = [System.Drawing.Color]::FromArgb(8, 22, 34)
$form.Controls.Add($modeLegendPanel)

function Get-AerTrafficColor {
    param([ValidateSet('green','yellow','grey')][string]$State)
    switch ($State) {
        'green' { return [System.Drawing.Color]::FromArgb(64, 210, 142) }
        'yellow' { return [System.Drawing.Color]::FromArgb(224, 171, 78) }
        default { return [System.Drawing.Color]::FromArgb(70, 78, 88) }
    }
}

$modeTraffic = [ordered]@{
    baseline = 'green'
    observe = if ($aerObserveReady) { 'green' } else { 'yellow' }
    protect = 'grey'
    adaptive = 'grey'
}
if (Test-Path -LiteralPath $vrModeStatePath -PathType Leaf) {
    try {
        $modeState = Get-Content -LiteralPath $vrModeStatePath -Raw | ConvertFrom-Json
        if ([string]$modeState.schemaVersion -eq 'stephanos.vr-mode-state.v1' -and $modeState.modeTraffic) {
            foreach ($name in @('baseline','observe','protect','adaptive')) {
                $candidate = [string]$modeState.modeTraffic.$name
                if ($candidate -in @('green','yellow','grey')) { $modeTraffic[$name] = $candidate }
            }
        }
    }
    catch {}
}

function New-AerModeCell {
    param([int]$X,[string]$Name,[string]$State)

    $cell = New-Object System.Windows.Forms.Panel
    $cell.Location = New-Object System.Drawing.Point($X, 0)
    $cell.Size = New-Object System.Drawing.Size(148, 22)
    $cell.BackColor = [System.Drawing.Color]::Transparent
    $modeLegendPanel.Controls.Add($cell)

    $light = New-Object System.Windows.Forms.Label
    $light.Location = New-Object System.Drawing.Point(8, 5)
    $light.Size = New-Object System.Drawing.Size(12, 12)
    $light.BackColor = Get-AerTrafficColor -State $State
    $cell.Controls.Add($light)

    $label = New-Object System.Windows.Forms.Label
    $label.Location = New-Object System.Drawing.Point(27, 2)
    $label.Size = New-Object System.Drawing.Size(116, 18)
    $label.ForeColor = [System.Drawing.Color]::FromArgb(174, 198, 220)
    $label.Font = New-Object System.Drawing.Font($fontFamily, 7.8, [System.Drawing.FontStyle]::Bold)
    $label.Text = $Name
    $cell.Controls.Add($label)

    return [pscustomobject]@{ Panel=$cell; Light=$light; Label=$label }
}

$baselineModeCell = New-AerModeCell -X 0 -Name 'BASELINE' -State $modeTraffic.baseline
$observeModeCell = New-AerModeCell -X 148 -Name 'OBSERVE' -State $modeTraffic.observe
$protectModeCell = New-AerModeCell -X 296 -Name 'PROTECT' -State $modeTraffic.protect
$adaptiveModeCell = New-AerModeCell -X 444 -Name 'ADAPTIVE' -State $modeTraffic.adaptive

if ($aerObserveCheckbox.Checked) {
    $observeModeCell.Label.ForeColor = [System.Drawing.Color]::FromArgb(235, 250, 255)
}
else {
    $baselineModeCell.Label.ForeColor = [System.Drawing.Color]::FromArgb(235, 250, 255)
}

$aerObserveCheckbox.Add_CheckedChanged({
    $mutarButton.Text = if ($aerObserveCheckbox.Checked) { 'Launch AER Observe' } else { 'Launch Mutar / OpenXR' }
    $observeModeCell.Label.ForeColor = if ($aerObserveCheckbox.Checked) {
        [System.Drawing.Color]::FromArgb(235, 250, 255)
    } else {
        [System.Drawing.Color]::FromArgb(174, 198, 220)
    }
    $baselineModeCell.Label.ForeColor = if ($aerObserveCheckbox.Checked) {
        [System.Drawing.Color]::FromArgb(174, 198, 220)
    } else {
        [System.Drawing.Color]::FromArgb(235, 250, 255)
    }
})

$simulationPanel = New-Object System.Windows.Forms.Panel
$simulationPanel.Location = New-Object System.Drawing.Point(692, 344)
$simulationPanel.Size = New-Object System.Drawing.Size(280, 22)
$simulationPanel.BackColor = [System.Drawing.Color]::FromArgb(18, 22, 28)
$simulationPanel.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$simulationPanel.Cursor = [System.Windows.Forms.Cursors]::Hand
$form.Controls.Add($simulationPanel)

$simulationLight = New-Object System.Windows.Forms.Label
$simulationLight.Location = New-Object System.Drawing.Point(8, 5)
$simulationLight.Size = New-Object System.Drawing.Size(12, 12)
$simulationLight.BackColor = if ($simulationEnabled) { [System.Drawing.Color]::FromArgb(64, 210, 142) } else { [System.Drawing.Color]::FromArgb(70, 78, 88) }
$simulationLight.Cursor = [System.Windows.Forms.Cursors]::Hand
$simulationPanel.Controls.Add($simulationLight)

$simulationLabel = New-Object System.Windows.Forms.Label
$simulationLabel.Location = New-Object System.Drawing.Point(28, 2)
$simulationLabel.Size = New-Object System.Drawing.Size(244, 18)
$simulationLabel.ForeColor = [System.Drawing.Color]::FromArgb(170, 182, 196)
$simulationLabel.Font = New-Object System.Drawing.Font($fontFamily, 8, [System.Drawing.FontStyle]::Bold)
$simulationLabel.Cursor = [System.Windows.Forms.Cursors]::Hand
$simulationLabel.Text = if ($simulationEnabled) { 'SIM AIR LINK: ON | TURN OFF (TEST)' } else { 'SIM AIR LINK: OFF | TURN ON (TEST)' }
$simulationPanel.Controls.Add($simulationLabel)

$statusPanel = New-Object System.Windows.Forms.Panel
$statusPanel.Location = New-Object System.Drawing.Point(68, 370)
$statusPanel.Size = New-Object System.Drawing.Size(904, 116)
$statusPanel.BackColor = [System.Drawing.Color]::FromArgb(6, 14, 24)
$form.Controls.Add($statusPanel)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.AutoSize = $false
$statusLabel.Location = New-Object System.Drawing.Point(24, 18)
$statusLabel.Size = New-Object System.Drawing.Size(836, 30)
$statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(234, 244, 255)
$statusLabel.Font = New-Object System.Drawing.Font($fontFamily, 15, [System.Drawing.FontStyle]::Bold)
$statusLabel.Text = 'Choose a VR provider'
$statusPanel.Controls.Add($statusLabel)

$statusHint = New-Object System.Windows.Forms.Label
$statusHint.AutoSize = $false
$statusHint.Location = New-Object System.Drawing.Point(25, 52)
$statusHint.Size = New-Object System.Drawing.Size(836, 24)
$statusHint.ForeColor = [System.Drawing.Color]::FromArgb(151, 177, 201)
$statusHint.Font = New-Object System.Drawing.Font($fontFamily, 10)
$statusHint.Text = 'Cards show configured state only. Canonical readiness runs after you select a provider.'
$statusPanel.Controls.Add($statusHint)

$telemetryLabel = New-Object System.Windows.Forms.Label
$telemetryLabel.AutoSize = $false
$telemetryLabel.Location = New-Object System.Drawing.Point(25, 76)
$telemetryLabel.Size = New-Object System.Drawing.Size(836, 18)
$telemetryLabel.ForeColor = [System.Drawing.Color]::FromArgb(126, 231, 194)
$telemetryLabel.Font = New-Object System.Drawing.Font($fontFamily, 8.5, [System.Drawing.FontStyle]::Bold)
$telemetryLabel.Text = 'FLIGHT RECORDER AUTO | FPS + frame time + stereo/pose/OpenXR -> Shared Workspace'
$statusPanel.Controls.Add($telemetryLabel)

$progressTrack = New-Object System.Windows.Forms.Panel
$progressTrack.Location = New-Object System.Drawing.Point(26, 101)
$progressTrack.Size = New-Object System.Drawing.Size(850, 4)
$progressTrack.BackColor = [System.Drawing.Color]::FromArgb(48, 73, 94)
$statusPanel.Controls.Add($progressTrack)

$progressFill = New-Object System.Windows.Forms.Panel
$progressFill.Location = New-Object System.Drawing.Point(0, 0)
$progressFill.Size = New-Object System.Drawing.Size(62, 4)
$progressFill.BackColor = [System.Drawing.Color]::FromArgb(106, 216, 255)
$progressTrack.Controls.Add($progressFill)

$detailsBox = New-Object System.Windows.Forms.TextBox
$detailsBox.Location = New-Object System.Drawing.Point(68, 508)
$detailsBox.Size = New-Object System.Drawing.Size(904, 170)
$detailsBox.Multiline = $true
$detailsBox.ReadOnly = $true
$detailsBox.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
$detailsBox.BackColor = [System.Drawing.Color]::FromArgb(8, 17, 29)
$detailsBox.ForeColor = [System.Drawing.Color]::FromArgb(172, 196, 218)
$detailsBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$detailsBox.Font = New-Object System.Drawing.Font('Consolas', 9)
$detailsBox.Visible = $false
$detailsBox.Text = 'Choose a provider. No game will launch until you make a selection and the canonical readiness gate passes.'
$form.Controls.Add($detailsBox)

$detailsButton = New-Object System.Windows.Forms.Button
$detailsButton.Location = New-Object System.Drawing.Point(68, 722)
$detailsButton.Size = New-Object System.Drawing.Size(112, 34)
$detailsButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$detailsButton.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(68, 108, 138)
$detailsButton.BackColor = [System.Drawing.Color]::FromArgb(13, 28, 44)
$detailsButton.ForeColor = [System.Drawing.Color]::FromArgb(198, 218, 236)
$detailsButton.Text = 'Show details'
$detailsButton.Enabled = $true
$form.Controls.Add($detailsButton)

$closeButton = New-Object System.Windows.Forms.Button
$closeButton.Location = New-Object System.Drawing.Point(860, 722)
$closeButton.Size = New-Object System.Drawing.Size(112, 34)
$closeButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$closeButton.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(70, 111, 142)
$closeButton.BackColor = [System.Drawing.Color]::FromArgb(15, 31, 47)
$closeButton.ForeColor = [System.Drawing.Color]::FromArgb(223, 235, 246)
$closeButton.Text = 'Close'
$form.Controls.Add($closeButton)

$closeButton.Add_Click({ $form.Close() })
$form.Add_KeyDown({
    param($sender, $eventArgs)
    if ($eventArgs.KeyCode -eq [System.Windows.Forms.Keys]::Escape) { $form.Close() }
})
$detailsButton.Add_Click({
    $detailsBox.Visible = -not $detailsBox.Visible
    $detailsButton.Text = if ($detailsBox.Visible) { 'Hide details' } else { 'Show details' }
})

$checkStages = @(
    'Checking selected provider',
    'Checking Quest 3 route',
    'Checking Meta Air Link',
    'Checking OpenXR runtime',
    'Checking verified VR provider'
)
$stageIndex = 0
$checkTimer = New-Object System.Windows.Forms.Timer
$checkTimer.Interval = 720
$checkTimer.Add_Tick({
    if ($form.IsDisposed) { return }
    $stageIndex = [Math]::Min($stageIndex + 1, $checkStages.Count - 1)
    $statusLabel.Text = $checkStages[$stageIndex]
    $width = [Math]::Min(850, 82 + ($stageIndex * 170))
    $progressFill.Width = $width
})

$processState = [pscustomobject]@{
    Slot = $null
    Readiness = $null
    Launch = $null
    Provider = ''
    ProfilePath = ''
    Mode = 'BASELINE'
    ProviderBusy = $false
    CloseRequested = $false
}

$monitorPollTimer = New-Object System.Windows.Forms.Timer
$monitorPollTimer.Interval = 120
$monitorPollTimer.Add_Tick({
    if ($form.IsDisposed -or -not $monitorState.Process) { $monitorPollTimer.Stop(); return }
    if ($monitorState.Pipe) {
        if ($monitorState.Pipe.Fault) { Stop-MonitorTransport -Reason $monitorState.Pipe.Fault }
        $line = $null
        $handled = 0
        while ($handled -lt 64 -and $monitorState.Pipe.TryRead([ref]$line)) {
            $handled += 1
            if (-not $monitorState.TransportFailed) {
                try { Receive-MonitorEvent -Line $line }
                catch { Stop-MonitorTransport -Reason $_.Exception.Message }
            }
        }
    }
    if ($monitorState.PendingPrepare -and $monitorState.StartedAtUtc -and
        ([DateTime]::UtcNow - $monitorState.StartedAtUtc).TotalSeconds -gt 30) {
        $monitorState.PendingPrepare = $false
        Stop-MonitorTransport -Reason 'monitor-handshake-timeout; no prepare command was sent'
    }
    if (-not $monitorState.Process.HasExited) { return }
    if (-not $monitorState.ExitedAtUtc) { $monitorState.ExitedAtUtc = [DateTime]::UtcNow }
    $drained = $monitorState.Pipe -and $monitorState.Pipe.Drained
    if (-not $drained -and ([DateTime]::UtcNow - $monitorState.ExitedAtUtc).TotalSeconds -lt 5) { return }
    $monitorPollTimer.Stop()
    $exitCode = $monitorState.Process.ExitCode
    $diagnostic = if ($monitorState.Pipe) { $monitorState.Pipe.ErrorText } else { '' }
    $lostResult = -not $drained -or -not $monitorState.ClosedReceived -or $monitorState.TransportFailed -or $exitCode -ne 0
    if ($lostResult) {
        $monitorState.Mode = 'blocked'
        $monitorState.Busy = $false
        $monitorState.AllowedActions = @()
        if ($monitorState.PrepareDispatched) {
            $monitorState.ProviderSlotReleased = $false
            $monitorState.SafeToClose = $false
        }
        $hybridCard.Status.Text = 'MONITOR RESULT UNRESOLVED'
        $statusLabel.Text = 'The monitor stopped without a complete result'
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
        $statusHint.Text = if ($monitorState.PrepareDispatched) {
            'Exit Starfield normally if it remains open. Other provider buttons stay held; this window can be closed.'
        } else {
            'No monitor test was dispatched. This window can be closed; the reason is shown below.'
        }
        Add-MonitorDetail -Message ('Monitor process exit: ' + $exitCode + '; complete cleanup receipt received: ' + $monitorState.ClosedReceived)
        if ($diagnostic) { Add-MonitorDetail -Message $diagnostic }
    }
    [void]$splashOwnedChildren.Remove($monitorState.Process)
    if ($monitorState.Pipe) { $monitorState.Pipe.Dispose() }
    else { $monitorState.Process.Dispose() }
    $monitorState.Pipe = $null
    $monitorState.Process = $null
    if (-not $lostResult -and $monitorState.PrepareDispatched -and $monitorState.ProviderSlotReleased) { [void](Test-MonitorProviderCustody) }
    Set-MonitorProviderControls
    if ($monitorState.CloseRequested -and -not $lostResult -and $monitorState.SafeToClose) { $form.Close() }
})

$form.Add_FormClosing({
    param($sender, $eventArgs)
    $processState.CloseRequested = $true
    $launchDelayTimer.Stop()
    $checkTimer.Stop()
    if ($monitorState.Process -and -not $monitorState.Process.HasExited) {
        $eventArgs.Cancel = $true
        $monitorState.CloseRequested = $true
        $monitorState.PendingPrepare = $false
        if (-not $monitorState.CloseSent -and -not $monitorState.TransportFailed) {
            [void](Send-MonitorCommand -Command 'close')
        } elseif ($monitorState.Pipe -and $monitorState.TransportFailed) {
            $monitorState.Pipe.CloseInput()
        }
        $statusLabel.Text = 'Finishing monitor cleanup'
        $statusHint.Text = 'The test is stopping normally. If Starfield stays open, exit through its usual menu.'
        $closeButton.Text = 'Stopping...'
        $hybridButton.Enabled = $false
        return
    }
    if ($processState.Slot -or $processState.Readiness -or $processState.Launch) {
        $eventArgs.Cancel = $true
        $slotPollTimer.Stop()
        $readinessPollTimer.Stop()
        $launchPollTimer.Stop()
        $statusLabel.Text = 'Finishing the current provider check'
        $statusHint.Text = 'No further launch stage will start. The existing helper is finishing.'
        $vorpxButton.Enabled = $false
        $mutarButton.Enabled = $false
        $hybridButton.Enabled = $false
        $simulationPanel.Enabled = $false
        $closeButton.Text = 'Stopping...'
        $finishTimer.Interval = 120
        $finishTimer.Start()
    }
})

$toggleSimulationState = {
    if ($processState.ProviderBusy -or $monitorState.Process -or -not $monitorState.ProviderSlotReleased -or -not $monitorState.DurableCustodyReleased) {
        $statusLabel.Text = 'Virtual Air Link test is busy'
        $statusHint.Text = 'Wait for the current provider check or launch to finish before changing test state.'
        return
    }

    $nextEnabled = -not $script:simulationEnabled
    if (-not (Set-SimulatedAirLinkState -Enabled $nextEnabled)) {
        $statusLabel.Text = 'Virtual Air Link test could not be changed'
        $statusHint.Text = 'The bounded readiness-only state file could not be updated.'
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
        return
    }

    Update-SimulationToggleUi
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(234, 244, 255)
    $statusLabel.Text = if ($script:simulationEnabled) { 'Virtual Air Link test enabled' } else { 'Virtual Air Link test disabled' }
    $statusHint.Text = if ($script:simulationEnabled) {
        'Readiness simulation only. Choosing a real Starfield VR route will turn this off automatically.'
    } else {
        'Real Meta Air Link is required for a Starfield VR launch.'
    }
}
$simulationPanel.Add_Click($toggleSimulationState)
$simulationLight.Add_Click($toggleSimulationState)
$simulationLabel.Add_Click($toggleSimulationState)
$slotPollTimer = New-Object System.Windows.Forms.Timer
$slotPollTimer.Interval = 120
$slotPollTimer.Add_Tick({
    if ($form.IsDisposed -or -not $processState.Slot) { return }
    if (-not $processState.Slot.HasExited) { return }

    $slotPollTimer.Stop()
    $invocation = Complete-StarfieldVrLauncherProcess -Process $processState.Slot
    $processState.Slot = $null
    if ($processState.CloseRequested) { return }
    $slotResult = ConvertFrom-LastJsonObject -Text $invocation.Stdout
    if ($invocation.ExitCode -ne 0 -or -not $slotResult -or [string]$slotResult.verdict -ne 'STARFIELD_VR_PROVIDER_SLOT_READY') {
        $reason = Get-SafeInvocationMessage -Invocation $invocation -Fallback 'provider-slot-apply-failed'
        $statusLabel.Text = 'Provider switch stopped safely'
        $statusHint.Text = 'The verified provider slot could not be prepared. Starfield was not started.'
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
        $progressFill.BackColor = [System.Drawing.Color]::FromArgb(255, 172, 103)
        $progressFill.Width = 850
        $detailsBox.Text = $reason
        $detailsBox.Visible = $true
        $detailsButton.Text = 'Hide details'
        $closeButton.Text = 'Close'
        $processState.ProviderBusy = $false
        $simulationPanel.Enabled = ($monitorState.ProviderSlotReleased -and $monitorState.DurableCustodyReleased)
        Update-HybridButton
        $vorpxButton.Enabled = ($vorpxProfileConfigured -and $monitorState.DurableCustodyReleased)
        $mutarButton.Enabled = ($mutarProfileConfigured -and $mutarPackageStaged -and $monitorState.DurableCustodyReleased)
        return
    }

    $preferenceSaved = Write-ProviderPreference -Provider $processState.Provider
    $statusLabel.Text = 'Checking ' + $processState.Provider
    $statusHint.Text = 'The provider slot is verified. The canonical readiness gate must pass before Starfield can start.'
    $detailsBox.Text = 'Selected provider: ' + $processState.Provider +
        [Environment]::NewLine + 'Provider slot: ' + [string]$slotResult.verdict +
        [Environment]::NewLine + 'Receipt: ' + [string]$slotResult.receiptPath +
        [Environment]::NewLine + 'Readiness check is running.'
    if (-not $preferenceSaved) {
        $detailsBox.Text += [Environment]::NewLine + 'Warning: provider preference could not be saved; launch is continuing.'
    }
    $progressFill.Width = 82

    if ($processState.Mode -eq 'AER_OBSERVE') {
        $aerReadyAfterSlot = Test-AerObserveReady
        if (-not $aerReadyAfterSlot) {
            $statusLabel.Text = 'Stabilized MutaR validation stopped safely'
            $statusHint.Text = 'The MutaR slot was applied, but the reviewed AER stabilizer did not pass its live validation. Starfield was not started.'
            $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
            $progressFill.BackColor = [System.Drawing.Color]::FromArgb(255, 172, 103)
            $progressFill.Width = 850
            $detailsBox.Text += [Environment]::NewLine + 'AER live validation failed after provider-slot apply.'
            $detailsBox.Visible = $true
            $detailsButton.Text = 'Hide details'
            $closeButton.Text = 'Close'
            $processState.ProviderBusy = $false
        $simulationPanel.Enabled = ($monitorState.ProviderSlotReleased -and $monitorState.DurableCustodyReleased)
        Update-HybridButton
        $vorpxButton.Enabled = ($vorpxProfileConfigured -and $monitorState.DurableCustodyReleased)
            $mutarButton.Enabled = ($mutarProfileConfigured -and $mutarPackageStaged -and $monitorState.DurableCustodyReleased)
            return
        }
        $aerObserveCheckbox.Checked = $true
        $statusLabel.Text = 'Launching AER Observe'
        $statusHint.Text = 'Recording starts automatically once the OpenXR VR runtime is active.'
        $detailsBox.Text += [Environment]::NewLine + 'AER stabilizer: OBSERVE / AUTO RECORD' +
            [Environment]::NewLine + 'Runtime source head: ' + $script:aerObserveRuntimeSourceHead +
            [Environment]::NewLine + 'Rollback: armed before experimental DLL swap.'
        $observeModeCell.Label.ForeColor = [System.Drawing.Color]::FromArgb(235, 250, 255)
        $baselineModeCell.Label.ForeColor = [System.Drawing.Color]::FromArgb(174, 198, 220)
        try {
            $processState.Launch = Start-AerObserveProcess
            $launchPollTimer.Start()
        }
        catch {
            $statusLabel.Text = 'AER Observe launch stopped safely'
            $statusHint.Text = 'The guarded observe launcher could not be started. Starfield was not started.'
            $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
            $detailsBox.Text = $_.Exception.Message
            $detailsBox.Visible = $true
            $detailsButton.Text = 'Hide details'
            $closeButton.Text = 'Close'
            $processState.ProviderBusy = $false
        $simulationPanel.Enabled = ($monitorState.ProviderSlotReleased -and $monitorState.DurableCustodyReleased)
        Update-HybridButton
        $vorpxButton.Enabled = ($vorpxProfileConfigured -and $monitorState.DurableCustodyReleased)
            $mutarButton.Enabled = ($mutarProfileConfigured -and $mutarPackageStaged -and $monitorState.DurableCustodyReleased)
            $aerObserveCheckbox.Enabled = $false
        }
        return
    }

    Start-ReadinessCheck
})
$readinessPollTimer = New-Object System.Windows.Forms.Timer
$readinessPollTimer.Interval = 120
$readinessPollTimer.Add_Tick({
    if ($form.IsDisposed -or -not $processState.Readiness) { return }
    if (-not $processState.Readiness.HasExited) { return }

    $readinessPollTimer.Stop()
    $checkTimer.Stop()
    $invocation = Complete-StarfieldVrLauncherProcess -Process $processState.Readiness
    $processState.Readiness = $null
    if ($processState.CloseRequested) { return }
    $readiness = ConvertFrom-LastJsonObject -Text $invocation.Stdout

    if ($invocation.ExitCode -ne 0 -or -not $readiness -or [string]$readiness.verdict -ne 'STARFIELD_VR_LAUNCH_READY') {
        $blockers = Get-SafeBlockerText -Result $readiness
        $statusLabel.Text = 'Starfield VR is not ready yet'
        $statusHint.Text = 'The verified route failed closed. Flat Starfield was not started.'
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
        $progressFill.BackColor = [System.Drawing.Color]::FromArgb(255, 172, 103)
        $progressFill.Width = 850
        $detailsBox.Text = (($blockers | ForEach-Object { "• $_" }) -join [Environment]::NewLine)
        $detailsButton.Enabled = $true
        $closeButton.Text = 'Close'
        $processState.ProviderBusy = $false
        $simulationPanel.Enabled = ($monitorState.ProviderSlotReleased -and $monitorState.DurableCustodyReleased)
        Update-HybridButton
        $vorpxButton.Enabled = ($vorpxProfileConfigured -and $monitorState.DurableCustodyReleased)
        $mutarButton.Enabled = ($mutarProfileConfigured -and $mutarPackageStaged -and $monitorState.DurableCustodyReleased)
        return
    }

    $statusLabel.Text = 'Ready to launch'
    $statusHint.Text = if ($processState.Provider -eq 'mutar-openxr') {
        'Quest 3 and MutaR passed the gate. The VR flight recorder is armed: frame time, stereo, pose and OpenXR submission.'
    } else {
        'Quest 3 and the verified VR provider passed the launch gate.'
    }
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(174, 255, 221)
    $progressFill.BackColor = [System.Drawing.Color]::FromArgb(113, 236, 193)
    $progressFill.Width = 850
    $closeButton.Enabled = $true
    $launchDelayTimer.Start()
})

$processState.Launch = $null
$launchPollTimer = New-Object System.Windows.Forms.Timer
$launchPollTimer.Interval = 120
$launchPollTimer.Add_Tick({
    if ($form.IsDisposed -or -not $processState.Launch) { return }
    if (-not $processState.Launch.HasExited) { return }

    $launchPollTimer.Stop()
    $launchResult = Complete-StarfieldVrLauncherProcess -Process $processState.Launch
    $processState.Launch = $null
    if ($processState.CloseRequested) { return }
    if ($launchResult.ExitCode -eq 0) {
        if ($processState.Mode -eq 'AER_OBSERVE') {
            $statusLabel.Text = 'AER Observe launched'
            $statusHint.Text = 'Flight recorder live. Mark a visible glitch with View + L3 + R3 on the Xbox pad, or F12.'
            $observeModeCell.Label.ForeColor = [System.Drawing.Color]::FromArgb(235, 250, 255)
            $baselineModeCell.Label.ForeColor = [System.Drawing.Color]::FromArgb(174, 198, 220)
        }
        else {
            $statusLabel.Text = 'Starfield VR launched'
            $statusHint.Text = if ($processState.Provider -eq 'mutar-openxr') {
                'Flight recorder proved its first sample. Mark a visible glitch with View + L3 + R3, or F12; the session seals on exit.'
            } else {
                'The verified launcher accepted the route and started the game.'
            }
        }
        $finishTimer.Start()
    }
    else {
        $statusLabel.Text = if ($processState.Mode -eq 'AER_OBSERVE') { 'AER Observe stopped safely' } else { 'Launch stopped safely' }
        $statusHint.Text = 'Conditions changed before launch. Flat Starfield was not started.'
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
        if ($processState.Mode -eq 'AER_OBSERVE') {
            $reason = Get-SafeInvocationMessage -Invocation $launchResult -Fallback 'aer-observe-launch-failed'
            $detailsBox.Text = $reason
        }
        else {
            $launchPayload = ConvertFrom-LastJsonObject -Text $launchResult.Stdout
            $blockers = Get-SafeBlockerText -Result $launchPayload
            $detailsBox.Text = (($blockers | ForEach-Object { "• $_" }) -join [Environment]::NewLine)
        }
        $detailsButton.Enabled = $true
        $closeButton.Enabled = $true
        $closeButton.Text = 'Close'
        $aerObserveCheckbox.Enabled = $false
        $processState.ProviderBusy = $false
        $simulationPanel.Enabled = ($monitorState.ProviderSlotReleased -and $monitorState.DurableCustodyReleased)
        Update-HybridButton
        $vorpxButton.Enabled = ($vorpxProfileConfigured -and $monitorState.DurableCustodyReleased)
        $mutarButton.Enabled = ($mutarProfileConfigured -and $mutarPackageStaged -and $monitorState.DurableCustodyReleased)
    }
})

$launchDelayTimer = New-Object System.Windows.Forms.Timer
$launchDelayTimer.Interval = 650
$launchDelayTimer.Add_Tick({
    $launchDelayTimer.Stop()
    if ($form.IsDisposed -or $processState.CloseRequested) { return }
    $statusLabel.Text = 'Launching Starfield VR'
    $statusHint.Text = 'Handing off to the existing verified launcher. No flat-game fallback is permitted.'
    try {
        $processState.Launch = Start-StarfieldVrLauncherProcess -SelectedProfilePath $processState.ProfilePath
        $launchPollTimer.Start()
    }
    catch {
        $statusLabel.Text = 'Launch stopped safely'
        $statusHint.Text = 'The launcher could not be started. Flat Starfield was not started.'
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
        $detailsBox.Text = 'launch-process-start-failed' + [Environment]::NewLine + $_.Exception.Message
        $detailsButton.Enabled = $true
        $closeButton.Enabled = $true
        $closeButton.Text = 'Close'
        $processState.ProviderBusy = $false
        $simulationPanel.Enabled = ($monitorState.ProviderSlotReleased -and $monitorState.DurableCustodyReleased)
        Update-HybridButton
        $vorpxButton.Enabled = ($vorpxProfileConfigured -and $monitorState.DurableCustodyReleased)
        $mutarButton.Enabled = ($mutarProfileConfigured -and $mutarPackageStaged -and $monitorState.DurableCustodyReleased)
        $aerObserveCheckbox.Enabled = $false
    }
})

$finishTimer = New-Object System.Windows.Forms.Timer
$finishTimer.Interval = 850
$finishTimer.Add_Tick({
    if ($processState.CloseRequested) {
        foreach ($name in @('Slot', 'Readiness', 'Launch')) {
            $child = $processState.PSObject.Properties[$name].Value
            if ($child -and $child.HasExited) {
                [void](Complete-StarfieldVrLauncherProcess -Process $child)
                $processState.PSObject.Properties[$name].Value = $null
            }
        }
        if ($processState.Slot -or $processState.Readiness -or $processState.Launch) { return }
    }
    $finishTimer.Stop()
    if (-not $form.IsDisposed) { $form.Close() }
})

function Start-ReadinessCheck {
    if ($form.IsDisposed -or $processState.CloseRequested -or -not $processState.ProfilePath) { return }
    $checkTimer.Start()
    try {
        $processState.Readiness = Start-StarfieldVrLauncherProcess -SelectedProfilePath $processState.ProfilePath -ReadinessOnly
        $readinessPollTimer.Start()
    }
    catch {
        $checkTimer.Stop()
        $statusLabel.Text = 'Starfield VR readiness could not be verified'
        $statusHint.Text = 'Nothing was launched. The readiness launcher could not be started.'
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
        $progressFill.BackColor = [System.Drawing.Color]::FromArgb(255, 172, 103)
        $progressFill.Width = 850
        $detailsBox.Text = 'readiness-process-start-failed' + [Environment]::NewLine + $_.Exception.Message
        $detailsButton.Enabled = $true
        $closeButton.Text = 'Close'
        $processState.ProviderBusy = $false
        $simulationPanel.Enabled = ($monitorState.ProviderSlotReleased -and $monitorState.DurableCustodyReleased)
        Update-HybridButton
        $vorpxButton.Enabled = ($vorpxProfileConfigured -and $monitorState.DurableCustodyReleased)
        $mutarButton.Enabled = ($mutarProfileConfigured -and $mutarPackageStaged -and $monitorState.DurableCustodyReleased)
    }
}

function Start-ProviderRoute {
    param(
        [Parameter(Mandatory)][string]$Provider,
        [Parameter(Mandatory)][string]$SelectedProfilePath,
        [ValidateSet('BASELINE','AER_OBSERVE')][string]$Mode = 'BASELINE'
    )

    if ($processState.CloseRequested -or $processState.ProviderBusy -or $monitorState.Process -or -not $monitorState.ProviderSlotReleased -or -not $monitorState.DurableCustodyReleased) { return }
    if (-not (Disable-SimulatedAirLinkForRealLaunch)) {
        $statusLabel.Text = 'Starfield VR launch stopped safely'
        $statusHint.Text = 'The readiness-only Virtual Air Link state could not be cleared. Nothing was launched.'
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
        return
    }
    $processState.Provider = $Provider
    $processState.ProfilePath = $SelectedProfilePath
    $processState.Mode = $Mode
    $processState.ProviderBusy = $true
    $hybridButton.Enabled = $false
    $simulationPanel.Enabled = $false
    $vorpxButton.Enabled = $false
    $mutarButton.Enabled = $false
    $aerObserveCheckbox.Enabled = $false
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(234, 244, 255)
    $statusLabel.Text = 'Preparing ' + $Provider
    $statusHint.Text = 'Switching the bounded Starfield provider slot before readiness is evaluated.'
    $detailsBox.Text = 'Selected provider: ' + $Provider + [Environment]::NewLine + 'Applying verified provider slot.'
        if ($Mode -eq 'AER_OBSERVE' -and $script:aerObserveRuntimeSourceHead) {
            $detailsBox.Text += [Environment]::NewLine + 'Runtime source head: ' + $script:aerObserveRuntimeSourceHead
        }

    try {
        $processState.Slot = Start-ProviderSlotProcess -Provider $Provider
        $slotPollTimer.Start()
    }
    catch {
        $processState.Slot = $null
        $statusLabel.Text = 'Provider switch stopped safely'
        $statusHint.Text = 'The verified provider slot could not be prepared. Starfield was not started.'
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
        $progressFill.BackColor = [System.Drawing.Color]::FromArgb(255, 172, 103)
        $progressFill.Width = 850
        $detailsBox.Text = $_.Exception.Message
        $detailsBox.Visible = $true
        $detailsButton.Text = 'Hide details'
        $closeButton.Text = 'Close'
        $processState.ProviderBusy = $false
        $simulationPanel.Enabled = ($monitorState.ProviderSlotReleased -and $monitorState.DurableCustodyReleased)
        Update-HybridButton
        $vorpxButton.Enabled = ($vorpxProfileConfigured -and $monitorState.DurableCustodyReleased)
        $mutarButton.Enabled = ($mutarProfileConfigured -and $mutarPackageStaged -and $monitorState.DurableCustodyReleased)
    }
}

$vorpxButton.Add_Click({
    Start-ProviderRoute -Provider 'vorpx' -SelectedProfilePath $ProfilePath
})
$mutarButton.Add_Click({
    if ($mutarProfileConfigured -and $mutarPackageStaged) {
        Start-ProviderRoute -Provider 'mutar-openxr' -SelectedProfilePath $MutarProfilePath -Mode 'AER_OBSERVE'
        return
    }
    $statusLabel.Text = 'Stabilized MutaR is not ready yet'
    $statusHint.Text = 'The anti-artifact AER route must pass its exact config, DLL and rollback checks before launch.'
    $detailsBox.Text = 'MutaR remains fail-closed until the stabilized AER route proves VR_AsyncAER=false, DLSS_AER_Enabled=true, the reviewed stabilizer DLL and rollback readiness.'
    $detailsBox.Visible = $true
    $detailsButton.Text = 'Hide details'
})

$hybridButton.Add_Click({
    if ($processState.ProviderBusy) { return }
    if ($monitorState.Process) {
        if ('confirm' -cin $monitorState.AllowedActions -and -not $monitorState.Busy) {
            [void](Send-MonitorCommand -Command 'confirm')
        } elseif ('finish' -cin $monitorState.AllowedActions -and -not $monitorState.Busy) {
            [void](Send-MonitorCommand -Command 'finish')
        }
        return
    }
    if ($monitorState.Mode -ceq 'idle') {
        Start-MonitorFromHybridCard
    } else {
        $detailsBox.Visible = $true
        $detailsButton.Text = 'Hide details'
        $detailsBox.Text = $monitorState.DetailText
    }
})

$form.Add_Shown({
    $statusLabel.Text = 'Choose a VR provider'
    $statusHint.Text = 'Nothing launches until you choose a route.'
    if (-not $monitorState.DurableCustodyReleased) {
        $statusLabel.Text = 'Previous monitor cleanup needs checking'
        $statusHint.Text = 'Use Hybrid / Stephanos VR to inspect the saved monitor session before another provider can start.'
        $detailsBox.Text = $monitorState.DurableCustodyReason
        $simulationPanel.Enabled = $false
    }
})

try {
    [void]$form.ShowDialog()
}
finally {
    $checkTimer.Stop()
    $slotPollTimer.Stop()
    $readinessPollTimer.Stop()
    $launchDelayTimer.Stop()
    $launchPollTimer.Stop()
    $finishTimer.Stop()
    $monitorPollTimer.Stop()
    if ($monitorState.Pipe) {
        if ($monitorState.Process -and -not $monitorState.Process.HasExited) { $monitorState.Pipe.CloseInput() }
        elseif ($monitorState.Process) {
            [void]$splashOwnedChildren.Remove($monitorState.Process)
            $monitorState.Pipe.Dispose()
        }
    }
    $form.Dispose()
}
}
finally {
    Exit-StarfieldSplashOwner -Mutex $splashOwner -Children $splashOwnedChildren
}
