# Test-only Windows PowerShell 5.1 helper. Dot-sourcing performs no native action.
# The trusted test action runs synchronously on the impersonating thread. This
# is not UAC, an installer, a sandbox, or proof of a child process's token;
# ordinary process creation does not inherit a thread impersonation token.
function Invoke-FilteredRuntimeFixture {
  [CmdletBinding()]
  param([Parameter(Mandatory=$true)][ValidateNotNull()][scriptblock]$Action)

  $ErrorActionPreference = 'Stop'
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or
      [IntPtr]::Size -ne 8 -or $PSVersionTable.PSEdition -ne 'Desktop' -or
      $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) {
    throw 'FILTERED_RUNTIME_FIXTURE_REQUIRES_WINDOWS_POWERSHELL_5_1_X64'
  }

  $runtimeFixtureNative = $null
  $runtimeFixtureOriginalToken = [IntPtr]::Zero
  $runtimeFixtureFilteredToken = [IntPtr]::Zero
  $runtimeFixtureBuffers = [Collections.Generic.List[IntPtr]]::new()
  $runtimeFixtureBefore = $runtimeFixtureProcess = $runtimeFixtureDuring = $null
  $runtimeFixtureAfter = $runtimeFixtureContext = $null
  $runtimeFixtureFailure = $runtimeFixtureCleanupFailure = $null
  $runtimeFixtureResults = @()
  $runtimeFixtureBeforeSid = $null
  $runtimeFixtureThread = 0
  $runtimeFixtureImpersonated = $false

  try {
    $runtimeFixtureBefore = [Security.Principal.WindowsIdentity]::GetCurrent()
    $runtimeFixtureBeforeSid = $runtimeFixtureBefore.User.Value
    $runtimeFixturePrincipal = [Security.Principal.WindowsPrincipal]::new($runtimeFixtureBefore)
    if ($runtimeFixtureBefore.IsSystem -or -not $runtimeFixturePrincipal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
      throw 'FILTERED_RUNTIME_FIXTURE_REQUIRES_NON_SYSTEM_ADMINISTRATOR'
    }

    $runtimeFixtureAssembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly(
      [Reflection.AssemblyName]::new('StarfieldFilteredRuntimeFixture_' + [Guid]::NewGuid().ToString('N')),
      [Reflection.Emit.AssemblyBuilderAccess]::Run)
    $runtimeFixtureModule = $runtimeFixtureAssembly.DefineDynamicModule('FilteredRuntimeFixture')
    $runtimeFixtureType = $runtimeFixtureModule.DefineType('FilteredRuntimeFixture', 'Public, Abstract, Sealed')
    # Only these fixed OS APIs are exposed; no compiler, executable, credential
    # or network operation is used to obtain or impersonate the restricted token.
    $runtimeFixtureSpecs = @(
      @('GetCurrentProcess','kernel32.dll',[IntPtr],@()),
      @('GetCurrentThreadId','kernel32.dll',[uint32],@()),
      @('OpenProcessToken','advapi32.dll',[bool],@([IntPtr],[uint32],[IntPtr])),
      @('CreateRestrictedToken','advapi32.dll',[bool],@([IntPtr],[uint32],[uint32],[IntPtr],[uint32],[IntPtr],[uint32],[IntPtr],[IntPtr])),
      @('CloseHandle','kernel32.dll',[bool],@([IntPtr]))
    )
    foreach ($runtimeFixtureSpec in $runtimeFixtureSpecs) {
      $runtimeFixtureMethod = $runtimeFixtureType.DefinePInvokeMethod(
        $runtimeFixtureSpec[0], ('C:\Windows\System32\' + $runtimeFixtureSpec[1]), $runtimeFixtureSpec[0],
        [Reflection.MethodAttributes]'Public, Static, PinvokeImpl', [Reflection.CallingConventions]::Standard,
        $runtimeFixtureSpec[2], [type[]]$runtimeFixtureSpec[3],
        [Runtime.InteropServices.CallingConvention]::Winapi, [Runtime.InteropServices.CharSet]::Unicode)
      $runtimeFixtureMethod.SetImplementationFlags(
        $runtimeFixtureMethod.GetMethodImplementationFlags() -bor [Reflection.MethodImplAttributes]::PreserveSig)
    }
    $runtimeFixtureNative = $runtimeFixtureType.CreateType()
    $runtimeFixtureThread = $runtimeFixtureNative::GetCurrentThreadId()

    $runtimeFixtureOriginalOutput = [Runtime.InteropServices.Marshal]::AllocHGlobal(8)
    $runtimeFixtureBuffers.Add($runtimeFixtureOriginalOutput)
    [Runtime.InteropServices.Marshal]::WriteIntPtr($runtimeFixtureOriginalOutput, [IntPtr]::Zero)
    $runtimeFixtureFilteredOutput = [Runtime.InteropServices.Marshal]::AllocHGlobal(8)
    $runtimeFixtureBuffers.Add($runtimeFixtureFilteredOutput)
    [Runtime.InteropServices.Marshal]::WriteIntPtr($runtimeFixtureFilteredOutput, [IntPtr]::Zero)

    # TOKEN_DUPLICATE | TOKEN_IMPERSONATE | TOKEN_QUERY. CreateRestrictedToken
    # returns the same token type and handle rights as this original handle.
    $runtimeFixtureOpened = $runtimeFixtureNative::OpenProcessToken(
      $runtimeFixtureNative::GetCurrentProcess(), 0xE, $runtimeFixtureOriginalOutput)
    $runtimeFixtureOriginalToken = [Runtime.InteropServices.Marshal]::ReadIntPtr($runtimeFixtureOriginalOutput)
    if (-not $runtimeFixtureOpened -or $runtimeFixtureOriginalToken -eq [IntPtr]::Zero -or
        $runtimeFixtureOriginalToken -eq [IntPtr](-1)) {
      throw 'FILTERED_RUNTIME_FIXTURE_PROCESS_TOKEN_UNPROVEN'
    }
    $runtimeFixtureProcess = [Security.Principal.WindowsIdentity]::new($runtimeFixtureOriginalToken)
    $runtimeFixturePrincipal = [Security.Principal.WindowsPrincipal]::new($runtimeFixtureProcess)
    if ($runtimeFixtureProcess.IsSystem -or $runtimeFixtureProcess.User.Value -ne $runtimeFixtureBeforeSid -or
        -not $runtimeFixturePrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
      throw 'FILTERED_RUNTIME_FIXTURE_PROCESS_ADMINISTRATOR_UNPROVEN'
    }

    $runtimeFixtureAdminSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    $runtimeFixtureSidBytes = [byte[]]::new($runtimeFixtureAdminSid.BinaryLength)
    $runtimeFixtureAdminSid.GetBinaryForm($runtimeFixtureSidBytes, 0)
    $runtimeFixtureSid = [Runtime.InteropServices.Marshal]::AllocHGlobal($runtimeFixtureSidBytes.Length)
    $runtimeFixtureBuffers.Add($runtimeFixtureSid)
    [Runtime.InteropServices.Marshal]::Copy($runtimeFixtureSidBytes, 0, $runtimeFixtureSid, $runtimeFixtureSidBytes.Length)
    # x64 SID_AND_ATTRIBUTES: PSID at 0, DWORD Attributes at 8, size 16.
    # CreateRestrictedToken ignores Attributes and makes the specified SID deny-only.
    $runtimeFixtureSidAttributes = [Runtime.InteropServices.Marshal]::AllocHGlobal(16)
    $runtimeFixtureBuffers.Add($runtimeFixtureSidAttributes)
    [Runtime.InteropServices.Marshal]::Copy([byte[]]::new(16), 0, $runtimeFixtureSidAttributes, 16)
    [Runtime.InteropServices.Marshal]::WriteIntPtr($runtimeFixtureSidAttributes, 0, $runtimeFixtureSid)
    $runtimeFixtureCreated = $runtimeFixtureNative::CreateRestrictedToken(
      $runtimeFixtureOriginalToken, 1, 1, $runtimeFixtureSidAttributes,
      0, [IntPtr]::Zero, 0, [IntPtr]::Zero, $runtimeFixtureFilteredOutput)
    $runtimeFixtureFilteredToken = [Runtime.InteropServices.Marshal]::ReadIntPtr($runtimeFixtureFilteredOutput)
    if (-not $runtimeFixtureCreated -or $runtimeFixtureFilteredToken -eq [IntPtr]::Zero -or
        $runtimeFixtureFilteredToken -eq [IntPtr](-1)) {
      throw 'FILTERED_RUNTIME_FIXTURE_RESTRICTED_TOKEN_UNPROVEN'
    }

    # Flag 1 is DISABLE_MAX_PRIVILEGE only: no SANDBOX_INERT or policy bypass.
    $runtimeFixtureContext = [Security.Principal.WindowsIdentity]::Impersonate($runtimeFixtureFilteredToken)
    $runtimeFixtureImpersonated = $true
    $runtimeFixtureDuring = [Security.Principal.WindowsIdentity]::GetCurrent($true)
    if ($null -eq $runtimeFixtureContext -or $null -eq $runtimeFixtureDuring -or
        $runtimeFixtureDuring.User.Value -ne $runtimeFixtureBeforeSid -or $runtimeFixtureDuring.IsSystem) {
      throw 'FILTERED_RUNTIME_FIXTURE_IMPERSONATION_UNPROVEN'
    }
    $runtimeFixturePrincipal = [Security.Principal.WindowsPrincipal]::new($runtimeFixtureDuring)
    if ($runtimeFixturePrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -or
        $runtimeFixtureNative::GetCurrentThreadId() -ne $runtimeFixtureThread) {
      throw 'FILTERED_RUNTIME_FIXTURE_ADMINISTRATOR_STILL_ENABLED'
    }

    # Buffer output until identity restoration and cleanup have succeeded.
    $runtimeFixtureResults = @(& $Action)
    $runtimeFixtureDuring.Dispose(); $runtimeFixtureDuring = $null
    $runtimeFixtureDuring = [Security.Principal.WindowsIdentity]::GetCurrent($true)
    if ($null -eq $runtimeFixtureDuring -or $runtimeFixtureDuring.User.Value -ne $runtimeFixtureBeforeSid -or
        ([Security.Principal.WindowsPrincipal]::new($runtimeFixtureDuring)).IsInRole(
          [Security.Principal.WindowsBuiltInRole]::Administrator) -or
        $runtimeFixtureNative::GetCurrentThreadId() -ne $runtimeFixtureThread) {
      throw 'FILTERED_RUNTIME_FIXTURE_ACTION_CONTEXT_CHANGED'
    }
  } catch {
    $runtimeFixtureFailure = $_
  } finally {
    if ($null -ne $runtimeFixtureContext) {
      try { $runtimeFixtureContext.Undo() } catch { $runtimeFixtureCleanupFailure = $_ }
      try { $runtimeFixtureContext.Dispose() } catch { if ($null -eq $runtimeFixtureCleanupFailure) { $runtimeFixtureCleanupFailure = $_ } }
    }
    if ($runtimeFixtureImpersonated) {
      try {
        $runtimeFixtureAfter = [Security.Principal.WindowsIdentity]::GetCurrent()
        if ($runtimeFixtureAfter.User.Value -ne $runtimeFixtureBeforeSid -or
            -not ([Security.Principal.WindowsPrincipal]::new($runtimeFixtureAfter)).IsInRole(
              [Security.Principal.WindowsBuiltInRole]::Administrator) -or
            $runtimeFixtureNative::GetCurrentThreadId() -ne $runtimeFixtureThread) {
          throw 'FILTERED_RUNTIME_FIXTURE_ORIGINAL_CONTEXT_NOT_RESTORED'
        }
      } catch { if ($null -eq $runtimeFixtureCleanupFailure) { $runtimeFixtureCleanupFailure = $_ } }
    }
    foreach ($runtimeFixtureIdentity in @($runtimeFixtureDuring, $runtimeFixtureProcess, $runtimeFixtureBefore, $runtimeFixtureAfter)) {
      if ($null -ne $runtimeFixtureIdentity) {
        try { $runtimeFixtureIdentity.Dispose() } catch { if ($null -eq $runtimeFixtureCleanupFailure) { $runtimeFixtureCleanupFailure = $_ } }
      }
    }
    foreach ($runtimeFixtureToken in @($runtimeFixtureFilteredToken, $runtimeFixtureOriginalToken)) {
      if ($runtimeFixtureToken -ne [IntPtr]::Zero -and $runtimeFixtureToken -ne [IntPtr](-1)) {
        try {
          if (-not $runtimeFixtureNative::CloseHandle($runtimeFixtureToken)) {
            throw 'FILTERED_RUNTIME_FIXTURE_TOKEN_CLOSE_FAILED'
          }
        } catch { if ($null -eq $runtimeFixtureCleanupFailure) { $runtimeFixtureCleanupFailure = $_ } }
      }
    }
    foreach ($runtimeFixtureBuffer in $runtimeFixtureBuffers) {
      try { [Runtime.InteropServices.Marshal]::FreeHGlobal($runtimeFixtureBuffer) }
      catch { if ($null -eq $runtimeFixtureCleanupFailure) { $runtimeFixtureCleanupFailure = $_ } }
    }
  }
  if ($null -ne $runtimeFixtureFailure) {
    if ($null -ne $runtimeFixtureCleanupFailure) {
      $runtimeFixtureFailure.Exception.Data['FilteredFixtureCleanupFailed'] = $true
    }
    throw $runtimeFixtureFailure
  }
  if ($null -ne $runtimeFixtureCleanupFailure) { throw $runtimeFixtureCleanupFailure }
  return $runtimeFixtureResults
}
