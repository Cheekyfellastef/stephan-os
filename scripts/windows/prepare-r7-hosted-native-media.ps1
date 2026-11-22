# Fixed public media acquisition into one existing hosted-run preparation directory.
# Downloads and read-only extraction only: no image application, EULA acceptance,
# VM, certificate, driver, host policy or production operation.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:RUNNER_OS -cne 'Windows' -or $env:ImageOS -cne 'win22' -or $env:GITHUB_EVENT_NAME -cne 'workflow_dispatch' -or $env:GITHUB_RUN_ATTEMPT -cne '1' -or $env:GITHUB_RUN_ID -cnotmatch '^[1-9][0-9]{0,15}$') {throw 'R7_FIXED_HOSTED_MEDIA_CONTEXT_REQUIRED'}
$root=Join-Path ([IO.Path]::GetFullPath($env:RUNNER_TEMP)) ('r7-native-invocation-'+$env:GITHUB_RUN_ID)
$preparation=Get-Content -LiteralPath (Join-Path $root 'preparation.json') -Raw | ConvertFrom-Json
if ([string]$preparation.workflowRunId -cne $env:GITHUB_RUN_ID -or $preparation.guestExecutionAuthority -ne $false) {throw 'R7_HOSTED_MEDIA_PREPARATION_REQUIRED'}
$media=Join-Path $root 'media-input'
New-Item -ItemType Directory -Path $media -ErrorAction Stop | Out-Null
$inputs=@(
 @{name='SERVER_EVAL_x64FRE_en-us.iso';bytes=5044094976;sha='3e4fa6d8507b554856fc9ca6079cc402df11a8b79344871669f0251535255325';url='https://software-static.download.prss.microsoft.com/sg/download/888969d5-f34g-4e03-ac9d-1f9786c66749/SERVER_EVAL_x64FRE_en-us.iso'},
 @{name='pycdlib-1.22.0-py3-none-any.whl';bytes=238118;sha='bfa0b3631345a14b2741fe088398b6b8dc2838442ea607fd07d027dcc67b9e94';url='https://files.pythonhosted.org/packages/7c/64/5a5912a3f3ba47dba3eb7f707e51f91926b26be4bde25fe2da483f3c4a9b/pycdlib-1.22.0-py3-none-any.whl'}
)
$handler=[Net.Http.HttpClientHandler]::new();$handler.AllowAutoRedirect=$false
$client=[Net.Http.HttpClient]::new($handler)
$client.Timeout=[TimeSpan]::FromMinutes(15)
try {
 foreach($item in $inputs) {
  $cancel=[Threading.CancellationTokenSource]::new([TimeSpan]::FromMinutes(15))
  $response=$null;$reader=$null;$writer=$null
  try {
   $response=$client.GetAsync($item.url,[Net.Http.HttpCompletionOption]::ResponseHeadersRead,$cancel.Token).GetAwaiter().GetResult()
   if ([int]$response.StatusCode -ne 200 -or ($response.Content.Headers.ContentLength -and $response.Content.Headers.ContentLength -ne $item.bytes)) {throw 'R7_FIXED_MEDIA_RESPONSE_MISMATCH'}
   $reader=$response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
   $path=Join-Path $media $item.name
   $writer=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
   $buffer=[byte[]]::new(524288);$total=0L
   while (($count=$reader.ReadAsync($buffer,0,$buffer.Length,$cancel.Token).GetAwaiter().GetResult()) -gt 0) {
    $total+=$count;if ($total -gt $item.bytes) {throw 'R7_FIXED_MEDIA_DOWNLOAD_BOUND'}
    $writer.Write($buffer,0,$count)
   }
   $writer.Flush($true);$writer.Dispose();$writer=$null
   if ($total -ne $item.bytes -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $item.sha) {throw 'R7_FIXED_MEDIA_DIGEST_MISMATCH'}
  } finally {
   if($writer){$writer.Dispose()};if($reader){$reader.Dispose()};if($response){$response.Dispose()};$cancel.Dispose()
  }
 }
} finally {$client.Dispose();$handler.Dispose()}
& python -I (Join-Path $PSScriptRoot 'prepare-r7-isolated-windows-media.py') (Join-Path $media $inputs[0].name) (Join-Path $media $inputs[1].name) (Join-Path $root 'windows')
if ($LASTEXITCODE -ne 0) {throw 'R7_FIXED_WIM_EXTRACTION_FAILED'}
