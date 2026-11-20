import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath, link } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadSovereignCommanderTailnetOriginV1, normalizeSovereignCommanderCaravanOriginV1,
  runSovereignCommanderHttpServer,
} from './sovereign-commander-http.mjs';

const ORIGIN = 'https://battle-bridge.tail123.ts.net:18791', HEAD = 'c'.repeat(40), TOKEN = 'o'.repeat(48);
const windows = process.platform === 'win32';
const scriptPath = fileURLToPath(new URL('./windows/configure-sovereign-commander-tailscale.ps1', import.meta.url));
const scriptSource = readFileSync(scriptPath, 'utf8');
const configPath = profile => join(profile, 'Documents', 'OpenClaw-Standalone', 'mission-runner',
  'sovereign-commander-tailnet-origin.v1.json');
const observation = () => ({ schemaVersion: 'stephanos.sovereign-commander-tailnet-origin.v1', origin: ORIGIN,
  localTarget: 'http://127.0.0.1:18791', tailnetOnly: true, observedAtUtc: new Date().toISOString(),
  source: 'TAILSCALE_SERVE_STATUS', executionAuthorityGranted: false, enrollmentQualified: false });
const serve = () => ({ TCP: { 18791: { HTTPS: true } },
  Web: { 'battle-bridge.tail123.ts.net:18791': { Handlers: { '/': { Proxy: 'http://127.0.0.1:18791' } } } } });
const quote = value => "'" + value.replaceAll("'", "''") + "'";
async function profileFixture(run) {
  const profile = await realpath(await mkdtemp(join(tmpdir(), 'stephanos-origin-')));
  try { return await run(profile); }
  finally { await rm(profile, { recursive: true, force: true }); }
}
async function writeObservation(profile, value) {
  await mkdir(dirname(configPath(profile)), { recursive: true });
  await writeFile(configPath(profile), typeof value === 'string' ? value : JSON.stringify(value));
}
function producerFixture(profile, configs, write = false) {
  // Extract ONLY the two pure/configuration functions. Never execute the script's
  // top-level CLI/network/exposure path or invoke Tailscale in this fixture.
  const encoded = Buffer.from(JSON.stringify(configs)).toString('base64');
  const ps = `$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
if($env:USERPROFILE -cne ${quote(profile)}){throw 'FIXTURE_PROFILE_MISMATCH'}
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile(${quote(scriptPath)},[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'SCRIPT_SYNTAX'}
$names=@('Get-SovereignCommanderPrivateOriginObservationV1','Write-SovereignCommanderPrivateOriginObservationV1')
$definitions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $names -contains $node.Name},$true))
if($definitions.Count -ne 2){throw 'FIXTURE_FUNCTIONS'}
foreach($definition in $definitions){Invoke-Expression $definition.Extent.Text}
$configs=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json
$rows=@(foreach($config in $configs){try{
  $result=Get-SovereignCommanderPrivateOriginObservationV1 -DnsName ([string]$config.dns) -ServeConfig $config.serve
  ${write ? 'Write-SovereignCommanderPrivateOriginObservationV1 -Observation $result' : ''}
  [pscustomobject]@{ok=$true;observation=$result}
}catch{[pscustomobject]@{ok=$false;reason=$_.Exception.Message}}})
ConvertTo-Json -InputObject $rows -Depth 8 -Compress`;
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000, env: { ...process.env, USERPROFILE: profile },
  }).trim());
}

test('approved Tailscale source emits only the exact private HTTPS root route and observation is inert', { skip: !windows }, async () => {
  await profileFixture(async profile => {
    const good = { dns: 'battle-bridge.tail123.ts.net', serve: serve() }, bad = [];
    for (const dns of ['example.com', 'host.ts.net', 'host.tail.ts.net.evil', 'HOST.tail123.ts.net', 'host..ts.net'])
      bad.push({ ...good, dns });
    for (const change of [
      c => { c.TCP[18791].HTTPS = false; }, c => { c.TCP[18791].HTTPS = 'true'; },
      c => { c.TCP[18791].HTTP = true; }, c => { c.TCP[18791].TCPForward = 'evil:9'; },
      c => { c.Web['battle-bridge.tail123.ts.net:18791'].Handlers['/'].Proxy = 'http://localhost:18791'; },
      c => { c.Web['battle-bridge.tail123.ts.net:18791'].Handlers['/caravan'] = { Proxy: 'http://evil:9' }; },
      c => { c.Web['battle-bridge.tail123.ts.net:18791'].Handlers['/'].Path = 'C:\\'; },
      c => { c.AllowFunnel = { 'battle-bridge.tail123.ts.net:18791': true }; },
      c => { c.AllowFunnel = { 'battle-bridge.tail123.ts.net:18791': 'false' }; },
      c => { delete c.TCP[18791]; }, c => { delete c.Web['battle-bridge.tail123.ts.net:18791']; },
    ]) { const value = serve(); change(value); bad.push({ ...good, serve: value }); }
    const rows = producerFixture(profile, [good, ...bad]);
    assert.equal(rows[0].ok, true); assert.equal(rows[0].observation.origin, ORIGIN);
    assert.equal(rows[0].observation.executionAuthorityGranted, false);
    assert.equal(rows[0].observation.enrollmentQualified, false);
    assert.equal(rows.slice(1).every(row => row.ok === false), true);
    const written = producerFixture(profile, [good], true);
    assert.equal(written[0].ok, true, written[0].reason);
    assert.equal(await loadSovereignCommanderTailnetOriginV1({ USERPROFILE: profile }), ORIGIN);
    assert.equal(JSON.parse(await readFile(configPath(profile), 'utf8')).origin, ORIGIN);
  });
});

test('fixed origin reader refuses missing, malformed, oversized, nonregular, redirected and authority-bearing config', async () => {
  await profileFixture(async profile => {
    const load = () => loadSovereignCommanderTailnetOriginV1({ USERPROFILE: profile,
      STEPHANOS_SOVEREIGN_COMMANDER_PUBLIC_ORIGIN: ORIGIN, STEPHANOS_SOVEREIGN_COMMANDER_ORIGIN_FILE: 'ignored' });
    assert.equal(await load(), '');
    const bad = ['{', ' '.repeat(2049), Buffer.from([0xff]).toString(),
      ...Object.entries({ schemaVersion: 'wrong', origin: 'https://public.example:18791',
        localTarget: 'http://127.0.0.1:1', tailnetOnly: 'true', source: 'CALLER',
        executionAuthorityGranted: true, enrollmentQualified: true, observedAtUtc: 'yesterday' })
        .map(([key, value]) => ({ ...observation(), [key]: value })),
      { ...observation(), extra: true }, { ...observation(), observedAtUtc: new Date(Date.now() + 600_000).toISOString() },
      ...['http://battle-bridge.tail123.ts.net:18791', 'https://battle-bridge.tail123.ts.net',
        ORIGIN + '/', ORIGIN + '/caravan', ORIGIN + '?x=1', 'https://user@battle-bridge.tail123.ts.net:18791',
        'https://battle-bridge.tail123.ts.net.evil:18791'].map(origin => ({ ...observation(), origin }))];
    for (const value of bad) { await writeObservation(profile, value); assert.equal(await load(), ''); }
    await rm(configPath(profile)); await mkdir(configPath(profile)); assert.equal(await load(), '');
    await rm(configPath(profile), { recursive: true });
    const target = join(profile, 'other.json'); await writeFile(target, JSON.stringify(observation()));
    await link(target, configPath(profile)); assert.equal(await load(), '');
    await rm(configPath(profile));
    const leafTarget = join(profile, 'leaf-target'); await mkdir(leafTarget);
    await symlink(leafTarget, configPath(profile), 'junction'); assert.equal(await load(), '');
    await rm(configPath(profile));
    const realDirectory = dirname(configPath(profile)); const otherDirectory = join(profile, 'redirected');
    await rm(realDirectory, { recursive: true }); await mkdir(otherDirectory);
    await writeFile(join(otherDirectory, 'sovereign-commander-tailnet-origin.v1.json'), JSON.stringify(observation()));
    await symlink(otherDirectory, realDirectory, 'junction'); assert.equal(await load(), '');
  });
});

test('production startup loads the emitted fixed observation while private auth and exact browser origin remain binding', { skip: !windows }, async () => {
  await profileFixture(async profile => {
    const written = producerFixture(profile, [{ dns: 'battle-bridge.tail123.ts.net', serve: serve() }], true);
    assert.equal(written[0].ok, true, written[0].reason);
    const now = Date.now();
    const context = { schemaVersion: 'stephanos.mobile-installer-first-device-context.v1', repository: 'Cheekyfellastef/stephan-os',
      issueNumber: 1814, action: 'CAPTURE_MOBILE_INSTALLER_FIRST_DEVICE_V1', sourceHead: HEAD, sourceTree: 'd'.repeat(40),
      machineHash: 'b'.repeat(64), operatorSid: 'S-1-5-21-1-2-3-1001', enrollmentGeneration: 1,
      packageSha256: 'e'.repeat(64), closureSha256: 'f'.repeat(64), releaseProofSha256: '1'.repeat(64),
      origin: ORIGIN, rpId: 'battle-bridge.tail123.ts.net', userHandle: Buffer.alloc(32, 4).toString('base64url'),
      nonce: 'a'.repeat(64), issuedAtUtc: new Date(now).toISOString(), expiresAtUtc: new Date(now + 900_000).toISOString() };
    let observed = 0;
    const provider = { observe: async () => { observed++; return { nativeObservation: {
      reason: 'MOBILE_INSTALL_ENROLLMENT_MISSING', enrollmentObservation: { state: 'MISSING' } } }; } };
    for (const verb of ['prepare', 'approve', 'cancel', 'reconcile']) provider[verb] = () => assert.fail('native mutation');
    const app = await runSovereignCommanderHttpServer({ token: TOKEN, env: { USERPROFILE: profile }, port: 0,
      readRecoverySource: () => HEAD, continuousRepairEnabled: false, custodyStore: { status: () => ({ held: false }), close() {} },
      mobileInstallationProvider: provider });
    try {
      const base = 'http://127.0.0.1:' + app.server.address().port;
      const init = { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ context }) };
      let response = await fetch(base + '/caravan/setup/arm', { ...init, headers: { ...init.headers, authorization: 'Bearer bad' } });
      assert.equal(response.status, 403); assert.equal(observed, 0);
      response = await fetch(base + '/caravan/setup/arm', init); assert.equal(response.status, 200);
      const body = await response.json(); assert.equal(body.executionAuthorityGranted, false);
      const capability = new URL(body.captureUrl).hash.slice('#pairing='.length);
      response = await fetch(base + '/caravan/setup/status', { headers: { origin: ORIGIN,
        'x-stephanos-pairing-capture': capability } }); assert.equal(response.status, 200);
      response = await fetch(base + '/caravan/setup/status', { headers: { origin: 'https://other.tail123.ts.net:18791',
        'x-stephanos-pairing-capture': capability } }); assert.equal(response.status, 403);
      response = await fetch(base + '/caravan/setup/arm', { ...init, body: JSON.stringify({ context: { ...context, origin: 'https://other.tail123.ts.net:18791',
        rpId: 'other.tail123.ts.net' } }) }); assert.equal(response.status, 400);
    } finally { app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); }
  });
});

test('constructor injection validates canonical HTTPS and ObserveExistingOnly cannot invoke mutating serve', () => {
  assert.equal(normalizeSovereignCommanderCaravanOriginV1('https://caravan.example'), 'https://caravan.example');
  for (const value of ['', null, 'http://caravan.example', 'https://caravan.example/',
    'https://u:p@caravan.example', 'https://caravan.example?q=1', 'https://caravan.example#x'])
    assert.equal(normalizeSovereignCommanderCaravanOriginV1(value), '');
  assert.match(scriptSource, /if \(-not \$ObserveExistingOnly\) \{\s*& \$tailscale.Source serve --bg --https=\$servePort \$target\s*if \(\$LASTEXITCODE -ne 0\) \{ throw 'TAILSCALE_SERVE_CONFIGURATION_FAILED' \}\s*\}/);
  assert.match(scriptSource, /if \(-not \$ObserveExistingOnly -and -not \$ApproveTailnetExposure\)/);
  assert.match(scriptSource, /if \(\$ObserveExistingOnly -and \$ApproveTailnetExposure\)/);
  assert.equal((scriptSource.match(/serve --bg/g) || []).length, 1);
  assert.ok(scriptSource.indexOf('Write-SovereignCommanderPrivateOriginObservationV1 -Observation $originObservation')
    > scriptSource.indexOf('$serveJson = @(& $tailscale.Source serve status --json'));
  assert.doesNotMatch(scriptSource, /\bfunnel\s+(?:--|reset|off|on)/i);
});
