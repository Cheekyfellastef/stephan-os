[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Native PS5/Win32 protocol qualification only. No form is created, prepare is
# never sent to a real adapter, and no Starfield/helper/game operation is invoked.
$sourcePath = Join-Path $PSScriptRoot 'launch-starfield-vr-with-splash.ps1'
$source = [System.IO.File]::ReadAllText($sourcePath, [System.Text.Encoding]::UTF8)
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw ($parseErrors | Out-String) }

$functionNames = @('Enter-StarfieldSplashOwner', 'Exit-StarfieldSplashOwner', 'New-MonitorProcessStartInfo',
    'Read-MonitorProbeResult', 'Find-MonitorPython', 'Get-MonitorCustodyPaths', 'Test-MonitorCustodyPathPresent',
    'Read-MonitorCustodyReceipt', 'Test-MonitorProviderCustody', 'Add-MonitorDetail', 'Update-HybridButton',
    'Set-MonitorProviderControls', 'Stop-MonitorTransport', 'Send-MonitorCommand',
    'Test-MonitorBooleanFields', 'Receive-MonitorEvent')
$definitions = @{}
foreach ($name in $functionNames) {
    $found = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true))
    if ($found.Count -ne 1) { throw ('Expected exactly one source function: ' + $name) }
    $definitions[$name] = $found[0].Extent.Text
    . ([scriptblock]::Create($found[0].Extent.Text))
}
$channelCode = [regex]::Match($source, "(?s)Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@").Groups[1].Value
if (-not $channelCode) { throw 'Actual bounded channel C# source is missing' }
Add-Type -TypeDefinition $channelCode
Add-Type -AssemblyName System.Drawing

$monitorProtocol = 'stephanos.native-eye-output.splash.v1'
$actualBridgeSha256 = [regex]::Match($source, "\`$monitorBridgeSha256 = '([a-f0-9]{64})'").Groups[1].Value
$actualRunnerSha256 = [regex]::Match($source, "\`$monitorRunnerSha256 = '([a-f0-9]{64})'").Groups[1].Value
$monitorBootstrap = [regex]::Match($source, "(?s)\`$monitorBootstrap = @'\r?\n(.*?)\r?\n'@").Groups[1].Value
$monitorBridgePath = Join-Path $PSScriptRoot 'starfield-native-monitor\splash_monitor_bridge.py'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("Starfield monitor's fixture " + [guid]::NewGuid().ToString('N'))
[void][System.IO.Directory]::CreateDirectory($fixtureRoot)
$testCount = 0

function Assert-True {
    param($Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}
function Assert-Throws {
    param([scriptblock]$Action, [string]$Message)
    $threw = $false
    try { & $Action } catch { $threw = $true }
    Assert-True $threw $Message
}
function Invoke-Fixture {
    param([string]$Name, [scriptblock]$Action)
    & $Action
    $script:testCount += 1
    Write-Output ('PASS ' + $Name)
}
function Restore-SourceFunction {
    param([string]$Name)
    $definition = $definitions[$Name] -replace ('^function ' + [regex]::Escape($Name)), ('function script:' + $Name)
    . ([scriptblock]::Create($definition))
}
function New-FakeControl {
    $control = [pscustomobject]@{ Text = ''; Enabled = $true; Visible = $true; ForeColor = $null; BackColor = $null; Width = 0; SelectionStart = 0; TextLength = 0 }
    $control | Add-Member -MemberType ScriptMethod -Name ScrollToCaret -Value {}
    return $control
}
function Reset-MonitorFixture {
    $script:monitorBridgeSha256 = 'a' * 64
    $script:monitorRunnerSha256 = 'b' * 64
    $script:processState = [pscustomobject]@{ ProviderBusy = $false; CloseRequested = $false }
    $inputWriter = New-Object System.IO.StringWriter
    $pipe = [pscustomobject]@{ Permit = $true; PermitCalls = 0; CloseCalls = 0 }
    $pipe | Add-Member -MemberType ScriptMethod -Name PermitForeground -Value { $this.PermitCalls += 1; return $this.Permit }
    $pipe | Add-Member -MemberType ScriptMethod -Name CloseInput -Value { $this.CloseCalls += 1 }
    $script:monitorState = [pscustomobject]@{
        Process = [pscustomobject]@{ Id = 7331; HasExited = $false; StandardInput = $inputWriter }
        Pipe = $pipe; Channel = ('c' * 32); RequestSequence = 0L; EventSequence = 0L
        PendingPrepare = $false; PrepareDispatched = $false; CloseRequested = $false; CloseSent = $false
        ClosedReceived = $false; TransportFailed = $false; ProviderSlotReleased = $true; SafeToClose = $true
        DurableCustodyReleased = $true; DurableCustodyReason = 'fixture-no-custody'
        Busy = $false; Mode = 'ready'; AllowedActions = @('prepare', 'close'); ConfirmationToken = $null
        RunId = $null; GameProcess = $null; Result = $null; DetailText = ''; StartedAtUtc = $null; ExitedAtUtc = $null
    }
    $script:vorpxProfileConfigured = $true
    $script:mutarProfileConfigured = $true
    $script:mutarPackageStaged = $true
    foreach ($name in @('hybridButton', 'statusLabel', 'statusHint', 'progressFill', 'detailsBox', 'detailsButton', 'closeButton', 'vorpxButton', 'mutarButton', 'simulationPanel')) {
        Set-Variable -Scope Script -Name $name -Value (New-FakeControl)
    }
    $script:hybridCard = [pscustomobject]@{ Status = (New-FakeControl) }
}
function New-StateFrame {
    param([string]$Mode = 'ready')
    $frame = [ordered]@{
        schema = $monitorProtocol; channel = $monitorState.Channel; eventSequence = 1; type = 'state'
        childPid = $monitorState.Process.Id; bridgeSha256 = $monitorBridgeSha256; runnerSha256 = $monitorRunnerSha256
        mode = $Mode; busy = $false; allowedActions = @('prepare', 'close'); runId = $null; process = $null
        confirmationToken = $null; outcome = $null; cleanupComplete = $false; normalExitProven = $false
        analysisAccepted = $false; bundleEvidenceIntegrityVerified = $false; unresolvedChild = $false
        playableVRProven = $false; safeToClose = $true; providerSlotReleased = $true
        resultZip = $null; resultDirectory = $null; error = $null
    }
    if ($Mode -eq 'waiting') {
        $frame.allowedActions = @('confirm', 'cancel', 'close')
        $frame.runId = '1' * 32
        $frame.process = [ordered]@{ pid = 54321; createdFileTime = '134384678410182997' }
        $frame.confirmationToken = '2' * 32
        $frame.safeToClose = $false
        $frame.providerSlotReleased = $false
    }
    return $frame
}
function Send-FixtureFrame {
    param($Frame)
    Receive-MonitorEvent -Line ($Frame | ConvertTo-Json -Depth 8 -Compress)
}
function Wait-FixtureMessages {
    param($Process, $Pipe, [int]$Milliseconds = 5000)
    $deadline = [DateTime]::UtcNow.AddMilliseconds($Milliseconds)
    $lines = New-Object System.Collections.Generic.List[string]
    do {
        $line = $null
        while ($Pipe.TryRead([ref]$line)) { $lines.Add($line) }
        if ($Process.HasExited -and $Pipe.Drained) { break }
        [System.Threading.Thread]::Sleep(10)
    } while ([DateTime]::UtcNow -lt $deadline)
    return [pscustomobject]@{ Lines = $lines.ToArray(); Complete = ($Process.HasExited -and $Pipe.Drained); Fault = $Pipe.Fault }
}

try {
    Invoke-Fixture 'PowerShell source parses and actual C# channel compiles' {
        Assert-True ($parseErrors.Count -eq 0) 'PowerShell parse errors'
        Assert-True ([Stephanos.Starfield.MonitorPipe]::QuoteArgument('a"b') -ceq '"a\"b"') 'Embedded quote escaping changed'
        Assert-True ([Stephanos.Starfield.MonitorPipe]::QuoteArgument('C:\folder with spaces\') -ceq '"C:\folder with spaces\\"') 'Trailing slash escaping changed'
    }
    Invoke-Fixture 'ready handshake cannot synthesize preparation or confirmation' {
        Reset-MonitorFixture
        Send-FixtureFrame (New-StateFrame)
        Assert-True ($monitorState.Process.StandardInput.ToString().Length -eq 0) 'Ready synthesized a command'
    }
    Invoke-Fixture 'waiting receipt requires the actual confirmation dispatch' {
        Reset-MonitorFixture
        Send-FixtureFrame (New-StateFrame 'waiting')
        Assert-True ($monitorState.Process.StandardInput.ToString().Length -eq 0) 'Waiting synthesized confirmation'
        Assert-True (Send-MonitorCommand -Command 'confirm') 'Explicit confirmation was refused'
        $sent = $monitorState.Process.StandardInput.ToString() | ConvertFrom-Json
        Assert-True ($sent.command -ceq 'confirm' -and $sent.sequence -eq 1) 'Wrong command sequence'
        Assert-True ($sent.pid -eq 54321 -and $sent.createdFileTime -ceq '134384678410182997') 'Game identity lost precision'
        Assert-True ($sent.confirmationToken -ceq ('2' * 32) -and $sent.runId -ceq ('1' * 32)) 'Confirmation was not bound'
        Assert-True ($monitorState.Pipe.PermitCalls -eq 1) 'Foreground was not delegated to exact child'
        Assert-True ($monitorState.Busy -and -not $monitorState.ProviderSlotReleased -and -not $monitorState.DurableCustodyReleased) 'Mutation was not reserved before writing'
        Assert-True (-not (Send-MonitorCommand -Command 'confirm')) 'Double click dispatched again'
    }
    Invoke-Fixture 'failed foreground transfer consumes neither token nor request sequence' {
        Reset-MonitorFixture
        Send-FixtureFrame (New-StateFrame 'waiting')
        $monitorState.Pipe.Permit = $false
        Assert-True (-not (Send-MonitorCommand -Command 'confirm')) 'Denied foreground still dispatched'
        Assert-True ($monitorState.RequestSequence -eq 0 -and $monitorState.ConfirmationToken -ceq ('2' * 32)) 'Rejected foreground consumed the confirmation'
    }
    Invoke-Fixture 'wrong channel, sequence and child identities are rejected' {
        foreach ($case in @('channel', 'sequence', 'child', 'bridge', 'runner')) {
            Reset-MonitorFixture
            $frame = New-StateFrame
            switch ($case) {
                'channel' { $frame.channel = 'd' * 32 }
                'sequence' { $frame.eventSequence = 2 }
                'child' { $frame.childPid = 9999 }
                'bridge' { $frame.bridgeSha256 = '0' * 64 }
                'runner' { $frame.runnerSha256 = '0' * 64 }
            }
            Assert-Throws { Send-FixtureFrame $frame } ('Accepted wrong ' + $case)
        }
    }
    Invoke-Fixture 'typed booleans and unbound confirmation cannot change authority' {
        foreach ($field in @('busy', 'cleanupComplete', 'normalExitProven', 'analysisAccepted', 'bundleEvidenceIntegrityVerified', 'unresolvedChild', 'playableVRProven', 'safeToClose', 'providerSlotReleased')) {
            Reset-MonitorFixture
            $frame = New-StateFrame
            $frame[$field] = 0
            Assert-Throws { Send-FixtureFrame $frame } ('Accepted boolean substitution: ' + $field)
        }
        Reset-MonitorFixture
        $frame = New-StateFrame 'waiting'
        $frame.confirmationToken = $null
        Assert-Throws { Send-FixtureFrame $frame } 'Accepted missing confirmation token'
    }
    Invoke-Fixture 'generic done and cleanup-only outcomes cannot paint monitor success' {
        Reset-MonitorFixture
        $frame = New-StateFrame 'done'
        $frame.allowedActions = @('close')
        $frame.outcome = 'finished'
        Send-FixtureFrame $frame
        Assert-True ($statusLabel.Text -cne 'Monitor test passed') 'Generic finished became success'
        Reset-MonitorFixture
        $frame = New-StateFrame 'done'
        $frame.outcome = 'REVIEWED_MONITOR_TEST_PASSED'
        $frame.allowedActions = @('close')
        $frame.cleanupComplete = $true
        $frame.normalExitProven = $true
        $frame.analysisAccepted = $true
        $frame.bundleEvidenceIntegrityVerified = $true
        Send-FixtureFrame $frame
        Assert-True ($statusLabel.Text -ceq 'Monitor test passed') 'Complete typed evidence was not projected'
    }
    Invoke-Fixture 'old custody cannot be released by a fresh ready/closed handshake' {
        Reset-MonitorFixture
        $monitorState.DurableCustodyReleased = $false
        $frame = New-StateFrame
        $frame.type = 'closed'
        $frame.allowedActions = @()
        Send-FixtureFrame $frame
        $monitorState.Process = $null
        Set-MonitorProviderControls
        Assert-True (-not $vorpxButton.Enabled -and -not $mutarButton.Enabled -and -not $simulationPanel.Enabled) 'Fresh handshake erased prior custody'
    }
    Invoke-Fixture 'durable custody presence cannot fall through to baseline after reopening' {
        Reset-MonitorFixture
        Set-Item Function:\script:Test-MonitorCustodyPathPresent -Value { param([string]$LiteralPath) return $true }
        Set-Item Function:\script:Read-MonitorCustodyReceipt -Value { return [pscustomobject]@{
            schema='stephanos.native-eye-output.provider-custody.v1'; allowed=$false; providerSlotReleased=$false
            reason='fixture-pending-launch'; observationsCurrent=$true; noMutationPerformed=$true
            bridgeSha256=$monitorBridgeSha256; runnerSha256=$monitorRunnerSha256
        } }
        try {
            $script:monitorBridgeSha256 = $actualBridgeSha256
            $script:monitorRunnerSha256 = $actualRunnerSha256
            Assert-True (-not (Test-MonitorProviderCustody)) 'Pending old launch became allowed'
            Assert-True (-not $monitorState.DurableCustodyReleased) 'Cross-reopen hold was lost'
            Set-Item Function:\script:Read-MonitorCustodyReceipt -Value { return [pscustomobject]@{
                schema='stephanos.native-eye-output.provider-custody.v1'; allowed=1; providerSlotReleased=$true
                reason='fixture-bad-bool'; observationsCurrent=$true; noMutationPerformed=$true
                bridgeSha256=$monitorBridgeSha256; runnerSha256=$monitorRunnerSha256
            } }
            Assert-True (-not (Test-MonitorProviderCustody)) 'Malformed custody boolean was accepted'
        } finally {
            Restore-SourceFunction 'Test-MonitorCustodyPathPresent'
            Restore-SourceFunction 'Read-MonitorCustodyReceipt'
        }
    }
    Invoke-Fixture 'absence-only baseline path does not require Python or inspect contents' {
        Reset-MonitorFixture
        Set-Item Function:\script:Test-MonitorCustodyPathPresent -Value { param([string]$LiteralPath) return $false }
        Set-Item Function:\script:Read-MonitorCustodyReceipt -Value { throw 'Must not query when no custody exists' }
        try { Assert-True (Test-MonitorProviderCustody) 'No-state baseline was blocked' }
        finally {
            Restore-SourceFunction 'Test-MonitorCustodyPathPresent'
            Restore-SourceFunction 'Read-MonitorCustodyReceipt'
        }
    }

    # Discovery and identity fixtures use only installed Python and temporary
    # read-only child commands. The live adapter fixture sends close only.
    $script:monitorBridgeSha256 = $actualBridgeSha256
    $script:monitorRunnerSha256 = $actualRunnerSha256
    $python = Find-MonitorPython
    Assert-True ($python.Executable -and @($python.Prefix).Count -eq 0) 'Discovery retained an interposed launcher'

    Invoke-Fixture 'discovery resolves an interposed py launcher to the actual process image' {
        $shimPath = Join-Path $fixtureRoot 'py-fixture.exe'
        $interpreterLiteral = $python.Executable.Replace('\', '\\').Replace('"', '\"')
        $shimCode = @"
using System;
using System.Diagnostics;
using System.Text;
public static class PyDiscoveryFixture {
    private static string Q(string value) {
        StringBuilder result = new StringBuilder("\""); int count = 0;
        foreach (char c in value) {
            if (c == '\\') { count++; continue; }
            result.Append('\\', c == '"' ? count * 2 + 1 : count); count = 0; result.Append(c);
        }
        result.Append('\\', count * 2); result.Append('"'); return result.ToString();
    }
    public static int Main(string[] args) {
        if (args.Length == 0 || args[0] != "-3") return 91;
        StringBuilder command = new StringBuilder();
        for (int i = 1; i < args.Length; i++) { if (i > 1) command.Append(' '); command.Append(Q(args[i])); }
        ProcessStartInfo info = new ProcessStartInfo("$interpreterLiteral", command.ToString());
        info.UseShellExecute = false; info.CreateNoWindow = true;
        info.RedirectStandardOutput = true; info.RedirectStandardError = true;
        using (Process child = Process.Start(info)) {
            Console.Write(child.StandardOutput.ReadToEnd()); Console.Error.Write(child.StandardError.ReadToEnd());
            child.WaitForExit(); return child.ExitCode;
        }
    }
}
"@
        Add-Type -TypeDefinition $shimCode -OutputAssembly $shimPath -OutputType ConsoleApplication
        $script:discoveryShimPath = $shimPath
        Set-Item Function:\script:Get-Command -Value {
            param([string]$Name, [string]$CommandType, [string]$ErrorAction)
            if ($Name -ne 'py.exe') { throw 'Unexpected fallback after valid launcher probe' }
            return [pscustomobject]@{ Source = $script:discoveryShimPath }
        }
        try { $resolved = Find-MonitorPython }
        finally { Remove-Item Function:\script:Get-Command }
        Assert-True ($resolved.Executable -ieq $python.Executable -and @($resolved.Prefix).Count -eq 0) 'Interposed launcher was retained'
        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = New-MonitorProcessStartInfo -Executable $resolved.Executable -Arguments @('-I', '-S', '-B', '-u', '-c', "import json,os;print(json.dumps({'pid':os.getpid(),'parent':os.getppid()}))")
        [void]$process.Start()
        $reader = New-Object Stephanos.Starfield.MonitorPipe($process)
        $reader.CloseInput()
        $observed = Wait-FixtureMessages -Process $process -Pipe $reader
        Assert-True ($observed.Complete -and -not $observed.Fault -and $observed.Lines.Count -eq 1) 'Direct interpreter result missing'
        $identity = $observed.Lines[0] | ConvertFrom-Json
        Assert-True ($identity.pid -eq $process.Id -and $identity.parent -eq $PID) 'Actual child PID or parent identity was interposed'
        $reader.Dispose()
    }
    Invoke-Fixture 'actual C# drains oversized output and retains bounded diagnostics without deadlock' {
        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = New-MonitorProcessStartInfo -Executable $python.Executable -Arguments @('-I', '-S', '-B', '-u', '-c', "import sys;sys.stdout.write('x'*40000+'\n');sys.stderr.write('e'*50000)")
        [void]$process.Start()
        $reader = New-Object Stephanos.Starfield.MonitorPipe($process)
        $reader.CloseInput()
        $observed = Wait-FixtureMessages -Process $process -Pipe $reader
        Assert-True $observed.Complete 'Oversized child output deadlocked'
        Assert-True ($reader.Fault -ceq 'monitor-output-line-limit') 'Oversized protocol line was not rejected'
        Assert-True ($reader.ErrorText.Length -eq 16384) 'Diagnostic retention bound failed'
        $reader.Dispose()
    }
    Invoke-Fixture 'singleton blocks a second splash until owned helpers have settled' {
        $owner = Enter-StarfieldSplashOwner
        Assert-True $owner 'Fixture could not acquire the actual splash singleton'
        $children = New-Object 'System.Collections.Generic.List[System.Diagnostics.Process]'
        try {
            $childCode = $definitions['Enter-StarfieldSplashOwner'] + [Environment]::NewLine +
                '$m=Enter-StarfieldSplashOwner;if($m){$m.ReleaseMutex();$m.Dispose();exit 0}else{exit 17}'
            $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($childCode))
            $powerShell = (Get-Process -Id $PID).Path
            $second = New-Object System.Diagnostics.Process
            $second.StartInfo = New-MonitorProcessStartInfo -Executable $powerShell -Arguments @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded)
            [void]$second.Start()
            $pipe = New-Object Stephanos.Starfield.MonitorPipe($second)
            $pipe.CloseInput()
            $response = Wait-FixtureMessages -Process $second -Pipe $pipe
            Assert-True ($response.Complete -and $second.ExitCode -eq 17) 'Second splash entered an owned route'
            $pipe.Dispose()
            $settling = New-Object System.Diagnostics.Process
            $settling.StartInfo = New-MonitorProcessStartInfo -Executable $python.Executable -Arguments @('-I', '-S', '-B', '-c', 'import time;time.sleep(0.2)')
            [void]$settling.Start()
            $children.Add($settling)
            $watch = [System.Diagnostics.Stopwatch]::StartNew()
            Exit-StarfieldSplashOwner -Mutex $owner -Children $children
            $owner = $null
            Assert-True ($children.Count -eq 0 -and $watch.ElapsedMilliseconds -ge 100) 'Owner released before helper settlement'
            $again = Enter-StarfieldSplashOwner
            Assert-True $again 'Settled owner was not released'
            Exit-StarfieldSplashOwner -Mutex $again -Children (New-Object 'System.Collections.Generic.List[System.Diagnostics.Process]')
        } finally { if ($owner) { Exit-StarfieldSplashOwner -Mutex $owner -Children $children } }
    }
    Invoke-Fixture 'actual pinned adapter proves native parent/child handshake and closes without prepare' {
        Reset-MonitorFixture
        $script:monitorBridgeSha256 = $actualBridgeSha256
        $script:monitorRunnerSha256 = $actualRunnerSha256
        $monitorState.Channel = [guid]::NewGuid().ToString('N')
        $monitorState.PendingPrepare = $false
        $parentTime = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToFileTimeUtc().ToString([System.Globalization.CultureInfo]::InvariantCulture)
        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = New-MonitorProcessStartInfo -Executable $python.Executable -Arguments @('-I', '-S', '-B', '-u', '-c', $monitorBootstrap, $monitorBridgePath,
            '--parent-pid', [string]$PID, '--parent-filetime', $parentTime, '--channel', $monitorState.Channel)
        [void]$process.Start()
        $reader = New-Object Stephanos.Starfield.MonitorPipe($process)
        $monitorState.Process = $process
        $monitorState.Pipe = $reader
        $deadline = [DateTime]::UtcNow.AddSeconds(10)
        $ready = $false
        try {
            while ([DateTime]::UtcNow -lt $deadline -and -not $process.HasExited) {
                $line = $null
                while ($reader.TryRead([ref]$line)) {
                    Receive-MonitorEvent -Line $line
                    if ($monitorState.Mode -ceq 'ready' -and -not $monitorState.ClosedReceived) { $ready = $true }
                }
                if ($ready) { break }
                if ($reader.Fault) { throw $reader.Fault }
                [System.Threading.Thread]::Sleep(10)
            }
            Assert-True $ready ('Actual adapter ready handshake was not received: ' + $reader.ErrorText)
            Assert-True (-not $monitorState.PrepareDispatched -and $null -eq $monitorState.RunId -and $null -eq $monitorState.GameProcess) 'Native fixture dispatched or adopted a monitor attempt'
            Assert-True (Send-MonitorCommand -Command 'close') 'Native close request refused'
            $response = Wait-FixtureMessages -Process $process -Pipe $reader
            foreach ($line in $response.Lines) { Receive-MonitorEvent -Line $line }
            Assert-True ($response.Complete -and $process.ExitCode -eq 0 -and -not $response.Fault) 'Native adapter did not close cleanly'
            Assert-True ($monitorState.ClosedReceived -and $monitorState.SafeToClose -and $monitorState.RequestSequence -eq 1) 'Closed receipt or command count incorrect'
            Assert-True (-not $monitorState.PrepareDispatched -and $null -eq $monitorState.RunId -and $null -eq $monitorState.GameProcess) 'Ready-close fixture crossed the game boundary'
        } finally {
            if ($process.HasExited) { $reader.Dispose() }
            else { $reader.CloseInput() }
        }
    }
    Write-Output ('STARFIELD_MONITOR_SPLASH_NATIVE_FIXTURES_PASSED tests=' + $testCount + ' gameStarted=false prepareSent=false')
} finally {
    if (Test-Path -LiteralPath $fixtureRoot) { Remove-Item -LiteralPath $fixtureRoot -Recurse -Force }
}
