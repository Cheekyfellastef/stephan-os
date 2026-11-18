# Parameterless, separately elevated installer bootstrap. Deliver these exact
# reviewed bytes as an EncodedCommand; do not elevate a mutable .ps1 pathname.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false,$true)
$sourceCommit='3f4fea8b205e516b9aa0f77fa4cfaac776813cc9'
$moduleSha256='2bb909987d68cccf31ad026e9c56369199b0a2b987c9e22da0f5c66fbc7ac25b'
$manifestSha256='cd4d94e5bbb28e644113013617363541d957bd50c403ca37ed4b56fe42ef8e92'
function Install-Deny { throw 'FIXED_RUNTIME_INSTALL_UNPROVEN' }
function Read-InstallSource([string]$url,[int]$maximum,[string]$expected) {
  $request=[Net.HttpWebRequest]::Create($url)
  $request.Method='GET';$request.AllowAutoRedirect=$false;$request.Proxy=$null
  $request.Credentials=$null;$request.UseDefaultCredentials=$false
  $request.Timeout=15000;$request.ReadWriteTimeout=5000
  [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
  $response=$stream=$null;$bytes=[IO.MemoryStream]::new();$clock=[Diagnostics.Stopwatch]::StartNew()
  try {
    $response=$request.GetResponse()
    if([int]$response.StatusCode -ne 200 -or $response.ResponseUri.AbsoluteUri -cne $url -or $response.ContentLength -gt $maximum){Install-Deny}
    $stream=$response.GetResponseStream();$buffer=[byte[]]::new(65536)
    while(($count=$stream.Read($buffer,0,$buffer.Length)) -gt 0){
      if($clock.Elapsed.TotalSeconds -gt 30 -or $bytes.Length+$count -gt $maximum){Install-Deny}
      $bytes.Write($buffer,0,$count)
    }
    if($bytes.Length -eq 0){Install-Deny}
    $bytes.Position=0;$hash=[Security.Cryptography.SHA256]::Create()
    try{$actual=([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
    if($actual -cne $expected){Install-Deny}
    return ,$bytes.ToArray()
  }finally{if($null -ne $stream){$stream.Dispose()};if($null -ne $response){$response.Dispose()};$bytes.Dispose()}
}
try {
  if($args.Count -ne 0 -or [IntPtr]::Size -ne 8 -or $sourceCommit -cnotmatch '^[a-f0-9]{40}$' -or $moduleSha256 -cnotmatch '^[a-f0-9]{64}$'){Install-Deny}
  $principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){Install-Deny}
  $base='https://raw.githubusercontent.com/Cheekyfellastef/stephan-os/'+$sourceCommit+'/scripts/windows/starfield-native-build/'
  $moduleBytes=Read-InstallSource ($base+'pinned_python_runtime.ps1') 65536 $moduleSha256
  $manifestBytes=Read-InstallSource ($base+'python_runtime_v1.json') 16384 $manifestSha256
  $utf8=[Text.UTF8Encoding]::new($false,$true)
  . ([scriptblock]::Create($utf8.GetString($moduleBytes)))
  $manifest=$utf8.GetString($manifestBytes)|ConvertFrom-Json
  $receipt=Install-FixedPythonRuntime $manifest
  $receipt|ConvertTo-Json -Compress -Depth 3
  exit 0
}catch{
  [Console]::WriteLine('{"schemaVersion":"stephanos.starfield-python-install.v1","status":"INSTALLATION_UNPROVEN"}')
  exit 3
}
