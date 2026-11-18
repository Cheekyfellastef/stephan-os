import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { executeStarfieldVrNativeBuild, projectStarfieldVrNativeBuildReceipt,
  STARFIELD_VR_NATIVE_BUILD_OPERATION as OP, STARFIELD_VR_NATIVE_BUILD_RECIPE as RECIPE,
  STARFIELD_VR_NATIVE_BUILD_SCHEMA as SCHEMA, validateStarfieldVrNativeBuildRecipe,
} from './starfieldVrNativeBuildV1.mjs';

const PREFIX = 'VR-Research-Lab/native/starfield-paired-observer-v1/';
const RUNNER = 'scripts/windows/starfield-native-build/native_build.py';
const JOB = 'scripts/windows/starfield-native-build/owned_job.py';
const LAUNCHER = 'scripts/windows/starfield-native-build/start_native_build.ps1';
const RUNTIME_MODULE = 'scripts/windows/starfield-native-build/pinned_python_runtime.ps1';
const RUNTIME_MANIFEST = 'scripts/windows/starfield-native-build/python_runtime_v1.json';
const USER = 'C:\\Users\\Stephan Callear';
const PATHS = { userProfile: USER, repoRoot: `${USER}\\Documents\\GitHub\\stephan-os`,
  powershellExe: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' };
const REQUEST = 'starfield-paired-build-test-0001';
const ARTIFACTS = ['test-scoped-eye-ledger.exe', 'test-paired-scoped-eye-ledger.exe',
  'test-paired-source-observation.exe', 'native-paired-source-observe-test.exe', 'native-paired-source-observe.dll'];
const digest = raw => createHash('sha256').update(raw).digest('hex');
const objectId = (type, raw) => createHash('sha1').update(`${type} ${raw.length}\0`).update(raw).digest('hex');

function fixture() {
  const publicFiles = {
    [PREFIX + 'reconstruct_paired_observer.py']: Buffer.from('# owned reconstruction\n'),
    [PREFIX + 'paired-source-observation.h']: Buffer.from('// owned observer model\n'),
    [PREFIX + 'build-paired-source-observe.cmd']: Buffer.from('@echo off\r\nexit /b 0\r\n'),
  };
  const recipe = { schemaVersion: 'stephanos.starfield-native-build-recipe.v1', stage: 'paired-source-observe-v1',
    originalPackageSha256: '1ea602071f2452f0afc70de1b9a63e6e99ef765f9edccb160b1c8a8f9ffca951',
    publicMembers: Object.entries(publicFiles).map(([path, raw]) => ({ path, sha256: digest(raw) })) };
  const files = { ...publicFiles, [RECIPE]: Buffer.from(JSON.stringify(recipe)),
    [RUNNER]: Buffer.from('# bounded runner\n'), [JOB]: Buffer.from('# owned Job\n'),
    [LAUNCHER]: Buffer.from('# fixed interpreter launcher\n'),
    [RUNTIME_MODULE]: Buffer.from('# fixed runtime closure\n'),
    [RUNTIME_MANIFEST]: Buffer.from('{"fixture":"runtime manifest"}\n') };
  const objects = new Map(); const root = {};
  const put = (type, raw) => { const id = objectId(type, raw); objects.set(id, { type, raw }); return id; };
  for (const [path, raw] of Object.entries(files)) {
    const parts = path.split('/'); let node = root;
    for (const part of parts.slice(0, -1)) node = node[part] ||= {};
    node[parts.at(-1)] = put('blob', raw);
  }
  function tree(node) {
    const rows = Object.entries(node).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => {
      const directory = typeof value !== 'string'; const id = directory ? tree(value) : value;
      return Buffer.concat([Buffer.from(`${directory ? '40000' : '100644'} ${name}\0`), Buffer.from(id, 'hex')]);
    });
    return put('tree', Buffer.concat(rows));
  }
  const treeId = tree(root);
  const head = put('commit', Buffer.from(`tree ${treeId}\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\nFixture\n`));
  return { head, objects, files, recipe };
}

function proof(packet, change = {}) {
  return { schemaVersion: SCHEMA, sourceHead: packet.sourceHead, requestId: packet.requestId,
    stage: 'paired-source-observe-v1', finalVerdict: 'STARFIELD_VR_NATIVE_BUILD_PASSED',
    reason: 'FIXED_BUILD_AND_SELF_TESTS_PASSED', originalSourceVerified: true, originalSourceUnchanged: true,
    sourceClosureVerified: true, isolatedBuildCreated: true, toolchainObserved: true,
    buildPassed: true, testsPassed: true, allJobsEmpty: true, executionCustodyReleased: true,
    outputComplete: true, terminalFinalized: true, stagesCompleted: 1, sourceClosureSha256: packet.sourceClosureSha256,
    recipeSha256: packet.files[RECIPE].sha256,
    artifacts: ARTIFACTS.map(name => ({ name, sha256: 'a'.repeat(64), bytes: 1024 })),
    arbitraryShellAllowed: false, arbitraryPathAllowed: false, arbitraryExecutableAllowed: false,
    providerMutationAllowed: false, sourceMutationAllowed: false, launchAllowed: false,
    pixelsCaptured: false, gpuCommandsIssued: false, openXrSubmitted: false, headsetPlaytestReady: false,
    ...change };
}

function host(f = fixture(), changes = {}) {
  const calls = []; let remoteCount = 0; let packet;
  const invoke = (exe, args, options) => {
    calls.push({ exe, args, options });
    if (exe === 'C:\\Program Files\\Git\\cmd\\git.exe') {
      assert.equal(args[0], '--no-replace-objects');
      assert.equal(options.env.GIT_NO_REPLACE_OBJECTS, '1');
      assert.equal(options.env.GIT_NO_LAZY_FETCH, '1');
      assert.equal(options.env.GIT_CONFIG_GLOBAL, 'NUL');
      assert.equal(options.env.GIT_DIR, undefined);
      assert.equal(options.env.GIT_CONFIG_COUNT, undefined);
      if (args.includes('rev-parse')) return { status: 0, stdout: f.head + '\n' };
      if (args.includes('ls-remote')) {
        remoteCount++;
        assert.equal(options.cwd, 'C:\\Windows\\System32');
        assert(args.includes('https://github.com/Cheekyfellastef/stephan-os.git'));
        assert(!args.some(value => value.startsWith('--git-dir=')));
        return { status: 0, stdout: `${changes.mainMoves && remoteCount === 2 ? 'b'.repeat(40) : f.head}\trefs/heads/main\n` };
      }
      const at = args.indexOf('cat-file');
      if (at >= 0) {
        assert(args.includes('protocol.allow=never'), 'reading a local object cannot invoke a configured promisor transport');
        const item = f.objects.get(args[at + 2]);
        if (!item || item.type !== args[at + 1]) return { status: 1, stdout: Buffer.alloc(0) };
        return { status: 0, stdout: changes.corruptType === item.type ? Buffer.from('replaced') : item.raw };
      }
      assert.fail('Unexpected Git operation');
    }
    assert.fail('The long launcher must never use the synchronous Git seam');
  };
  const launch = async (exe, args, options) => {
    calls.push({ exe, args, options, asynchronousLauncher: true });
    assert.equal(exe, PATHS.powershellExe, 'no interpreter or launcher is resolved through PATH');
    assert.equal(options.cwd, 'C:\\Windows\\System32');
    assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    assert.equal(options.timeout, 690_000); assert.equal(options.maxBuffer, 64 * 1024);
    assert.deepEqual(args.slice(0, -1), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']);
    assert.equal(options.env.NODE_OPTIONS, undefined);
    assert.equal(options.env.PSModulePath, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
    assert.deepEqual(Buffer.from(args.at(-1), 'base64').toString('utf16le'), f.files[LAUNCHER].toString('utf8'));
    packet = JSON.parse(options.input);
    assert.deepEqual(Object.keys(packet).sort(), ['files', 'parentPid', 'requestId', 'schemaVersion', 'sourceClosureSha256', 'sourceHead', 'stage']);
    if (changes.launcherWait) await changes.launcherWait;
    if (changes.executionReject) throw new Error('PRIVATE rejected launcher details');
    if (changes.executionError) return { status: null, error: new Error('private raw source must not escape') };
    return { status: changes.exitStatus ?? 0, stdout: JSON.stringify(changes.rawTerminal ?? proof(packet, changes.receipt)) };
  };
  return { f, calls, invoke, launch, get packet() { return packet; }, execute: (extra = {}) => executeStarfieldVrNativeBuild({
    operation: OP, expectedHead: f.head, requestId: REQUEST,
  }, PATHS, { spawnSyncFn: invoke, runLauncherFn: launch, parentPid: 123, admissionFn: () => ({ ok: true }),
    env: { USERPROFILE: USER, SystemRoot: 'C:\\Windows', GIT_DIR: 'C:\\wrong', GIT_CONFIG_COUNT: '9',
      NODE_OPTIONS: '--require=C:\\untrusted.js', PATH: 'C:\\untrusted' }, ...extra }) };
}

test('fixed build recipe refuses source/path/command expansion', () => {
  const { recipe } = fixture(); assert(validateStarfieldVrNativeBuildRecipe(recipe));
  for (const change of [{ command: 'caller command' }, { stage: 'headset' }, { publicMembers: [] }]) {
    assert.equal(validateStarfieldVrNativeBuildRecipe({ ...recipe, ...change }), false);
  }
  for (const path of [PREFIX + '../escape.py', 'scripts/arbitrary.py', PREFIX + 'nested/escape.py', RECIPE]) {
    assert.equal(validateStarfieldVrNativeBuildRecipe({ ...recipe, publicMembers: [...recipe.publicMembers.slice(0, 2), { path, sha256: 'a'.repeat(64) }] }), false);
  }
});

test('committed root, trees and blobs bind the bytes passed to the fixed build', async () => {
  const h = host(); const result = await h.execute();
  assert.equal(result.ok, true); assert.equal(result.nativeBuild.sourceHead, h.f.head);
  for (const [path, raw] of Object.entries(h.f.files)) assert.deepEqual(Buffer.from(h.packet.files[path].base64, 'base64'), raw);
  assert.equal(h.packet.sourceClosureSha256, digest(Object.keys(h.packet.files).sort().map(path => `${path}\0${h.packet.files[path].sha256}\n`).join('')));
  assert.equal(result.headsetPlaytestReady, false); assert.equal(result.launchAllowed, false);
});

for (const type of ['commit', 'tree', 'blob']) test(`substituted ${type} bytes cannot execute`, async () => {
  const h = host(fixture(), { corruptType: type }); const result = await h.execute();
  assert.equal(result.ok, false); assert.equal(result.blocker, 'STARFIELD_VR_NATIVE_BUILD_SOURCE_UNAVAILABLE');
  assert.equal(h.packet, undefined);
});

test('current main is rechecked after source collection and before execution', async () => {
  const h = host(fixture(), { mainMoves: true }); const result = await h.execute();
  assert.equal(result.ok, false); assert.equal(result.blocker, 'STARFIELD_VR_NATIVE_BUILD_PROTECTED_HEAD_UNPROVEN');
  assert.equal(h.packet, undefined);
});

test('gaming holds prevent any compiler stage and recheck holds remain binding', async () => {
  for (const changedLater of [false, true]) {
    const h = host(); let admitted = 0;
    const result = await h.execute({ admissionFn: () => ({ ok: changedLater && ++admitted === 1 }) });
    assert.equal(result.blocker, 'STARFIELD_VR_NATIVE_BUILD_GAMING_HOLD'); assert.equal(h.packet, undefined);
  }
});

test('missing terminal proof retains custody without exposing raw errors', async () => {
  const h = host(fixture(), { executionError: true }); const result = await h.execute();
  assert.equal(result.ok, false); assert.equal(result.executionCustodyReleased, false);
  assert(!JSON.stringify(result).includes('private raw'));
});

test('the mailbox heartbeat can run while the fixed launcher is awaited', async () => {
  let release; let heartbeats = 0;
  const launcherWait = new Promise(resolve => { release = resolve; });
  const h = host(fixture(), { launcherWait });
  const heartbeat = setInterval(() => { heartbeats++; }, 1);
  try {
    const pending = h.execute();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert(h.packet, 'source collection reached the async launcher');
    assert(heartbeats > 0, 'timers remain runnable before launcher completion');
    release(); assert.equal((await pending).ok, true);
    assert.equal(h.calls.filter(call => call.asynchronousLauncher).length, 1);
  } finally { release(); clearInterval(heartbeat); }
});

test('async rejection, timeout and overflow cannot release execution custody', async () => {
  for (const error of [Object.assign(new Error('PRIVATE timeout'), { code: 'ETIMEDOUT' }),
    Object.assign(new Error('PRIVATE output'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })]) {
    const h = host();
    const result = await h.execute({ runLauncherFn: async () => ({ status: null, error, stdout: 'PRIVATE partial output' }) });
    assert.equal(result.blocker, 'STARFIELD_VR_NATIVE_BUILD_TERMINAL_UNPROVEN');
    assert.equal(result.executionCustodyReleased, false); assert(!JSON.stringify(result).includes('PRIVATE'));
  }
  const rejected = await host(fixture(), { executionReject: true }).execute();
  assert.equal(rejected.blocker, 'STARFIELD_VR_NATIVE_BUILD_TERMINAL_UNPROVEN');
  assert.equal(rejected.executionCustodyReleased, false); assert(!JSON.stringify(rejected).includes('PRIVATE'));
});

test('actual nonzero launcher exit codes retain typed failed or held receipts', async () => {
  for (const [exitStatus, verdict, released] of [[2, 'STARFIELD_VR_NATIVE_BUILD_FAILED', true],
    [3, 'STARFIELD_VR_NATIVE_BUILD_CUSTODY_HELD', false]]) {
    const h = host(fixture(), { exitStatus, receipt: { finalVerdict: verdict,
      reason: 'COMPILER_OR_SELF_TEST_FAILED', buildPassed: false, testsPassed: false,
      allJobsEmpty: released, executionCustodyReleased: released, artifacts: [] } });
    const result = await h.execute();
    assert.equal(result.ok, false); assert.equal(result.finalVerdict, verdict);
    assert.equal(result.nativeBuild.executionCustodyReleased, released);
  }
});

test('fixed launcher phases give bounded diagnostics without echoing raw fields', async () => {
  for (const phase of ['INPUT', 'OWNER', 'RUNTIME', 'SELECTION', 'START', 'IMAGE', 'EXECUTION', 'TERMINAL']) {
    const reason = `FIXED_PYTHON_${phase}_UNPROVEN`;
    const h = host(fixture(), { exitStatus: 3, rawTerminal: {
      schemaVersion: 'stephanos.starfield-native-build-launcher.v1',
      finalVerdict: 'STARFIELD_VR_NATIVE_BUILD_BLOCKED', reason, executionCustodyReleased: false,
      rawOutput: 'PRIVATE PATH OR CREDENTIAL', arbitraryCommand: 'PRIVATE COMMAND',
    } });
    const result = await h.execute();
    assert.equal(result.blocker, reason); assert.equal(result.executionCustodyReleased, false);
    assert.equal(result.headsetPlaytestReady, false); assert(!JSON.stringify(result).includes('PRIVATE'));
  }
  const invalid = await host(fixture(), { exitStatus: 3, rawTerminal: {
    schemaVersion: 'stephanos.starfield-native-build-launcher.v1',
    finalVerdict: 'STARFIELD_VR_NATIVE_BUILD_BLOCKED', reason: 'FIXED_PYTHON_PRIVATE_PATH_UNPROVEN', executionCustodyReleased: false,
  } }).execute();
  assert.equal(invalid.blocker, 'STARFIELD_VR_NATIVE_BUILD_RECEIPT_INVALID');
});

test('zero exit alone cannot fabricate build, tests, original preservation or native zero', async () => {
  for (const receipt of [{ allJobsEmpty: false }, { testsPassed: false }, { outputComplete: false },
    { sourceClosureVerified: false }, { originalSourceUnchanged: false }, { pixelsCaptured: true },
    { executionCustodyReleased: false }, { artifacts: [] }, { stagesCompleted: 2 }, { testsPassed: 1 }]) {
    const h = host(fixture(), { receipt }); const result = await h.execute();
    assert.equal(result.ok, false, JSON.stringify(receipt)); assert.equal(result.blocker, 'STARFIELD_VR_NATIVE_BUILD_RECEIPT_INVALID');
  }
});

test('source and request mismatch cannot reuse another build receipt', async () => {
  for (const receipt of [{ sourceHead: 'c'.repeat(40) }, { requestId: 'other-build-test-0001' },
    { recipeSha256: 'c'.repeat(64) }, { sourceClosureSha256: 'd'.repeat(64) }]) {
    const h = host(fixture(), { receipt }); const result = await h.execute(); assert.equal(result.ok, false);
  }
});

test('public build proof is a closed projection without source paths or compiler output', async () => {
  const h = host(fixture(), { receipt: { rawOutput: 'PRIVATE COMPILER LOG', root_image_path: 'C:\\private',
    credentials: 'PRIVATE TOKEN', arbitraryCommand: 'caller' } });
  const result = await h.execute(); assert.equal(result.ok, true);
  const encoded = JSON.stringify(result); assert(!encoded.includes('PRIVATE')); assert(!encoded.includes('C:\\private'));
  assert.equal(result.nativeBuild.workerGoal, 1595); assert.equal(result.nativeBuild.missionGoal, 1769);
});

test('typed proof projection requires exact false claims and exact artifact identities', async () => {
  const h = host(); await h.execute(); const accepted = proof(h.packet);
  assert(projectStarfieldVrNativeBuildReceipt(accepted, h.f.head, REQUEST));
  assert.equal(projectStarfieldVrNativeBuildReceipt({
    schemaVersion: 'stephanos.starfield-native-build-terminal-proposal.v1',
    sourceHead: h.f.head, requestId: REQUEST, candidate: accepted,
  }, h.f.head, REQUEST), null, 'a private proposal containing a candidate PASS is not a public receipt');
  for (const change of [{ stage: 'different' }, { arbitraryPathAllowed: 0 }, { openXrSubmitted: 'false' },
    { artifacts: [{ name: 'unknown.exe', bytes: 1, sha256: 'a'.repeat(64) }] }]) {
    assert.equal(projectStarfieldVrNativeBuildReceipt({ ...accepted, ...change }, h.f.head, REQUEST), null);
  }
});
