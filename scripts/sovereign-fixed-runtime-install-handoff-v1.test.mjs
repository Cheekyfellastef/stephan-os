import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {
  FIXED_RUNTIME_INSTALL_HANDOFF_SCHEMA_V1,
  inspectFixedRuntimeInstallHandoffV1,
  prepareFixedRuntimeInstallHandoffV1,
} from './sovereign-fixed-runtime-install-handoff-v1.mjs';
import { FIXED_RUNTIME_SOURCE_PATHS_V1 } from './sovereign-fixed-runtime-installer-candidate-v1.mjs';

const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const ROOT = 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os';
const SID = 'S-1-5-21-1-2-3-1001';
const blobSha = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');

function fixture(overrides = {}) {
  const bytesByPath = new Map(FIXED_RUNTIME_SOURCE_PATHS_V1.map(path => [path, Buffer.from('fixture:' + path)]));
  const shaToBytes = new Map([...bytesByPath.entries()].map(([, bytes]) => [blobSha(bytes), bytes]));
  let persisted = null;
  const deps = {
    platform: 'win32',
    repoRoot: ROOT,
    truthFn: () => ({ ok: true, head: HEAD, originHead: HEAD, branch: 'main', workingTreeDirty: false }),
    gitCapture: (_root, args, options = {}) => {
      const joined = args.join(' ');
      if (joined === 'rev-parse HEAD' || joined === 'rev-parse refs/remotes/origin/main') return HEAD;
      if (joined === 'rev-parse HEAD^{tree}') return TREE;
      if (args[0] === 'rev-parse' && args[1].startsWith('HEAD:')) {
        const path = args[1].slice(5);
        return blobSha(bytesByPath.get(path));
      }
      if (args[0] === 'cat-file' && args[1] === 'blob') {
        const bytes = shaToBytes.get(args[2]);
        return options.binary ? Buffer.from(bytes) : bytes.toString('utf8');
      }
      throw new Error('unexpected git fixture: ' + joined);
    },
    readFile: absolute => {
      const found = [...bytesByPath.entries()].find(([path]) => resolve(ROOT, path) === absolute);
      if (!found) throw new Error('fixture path missing');
      return Buffer.from(found[1]);
    },
    readOperatorSid: () => SID,
    inspect: () => ({ ok: false, reason: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING' }),
    buildCandidate: ({ expectedMain, sourceTree, operatorSid, records }) => ({
      expectedMain, sourceTree, operatorSid, records,
      payloadPath: 'C:\\Users\\Stephan Callear\\AppData\\Local\\Temp\\StephanosFixedRuntimeInstall-' + expectedMain + '.json',
      payloadBytes: Buffer.from('fixed-payload'),
      payloadSha256: createHash('sha256').update('fixed-payload').digest('hex'),
      powershellExecutable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      encodedCommand: 'QUJDRA==',
      independentSourceAuthorityProven: false,
      operatorApprovalProven: false,
      elevationPerformed: false,
      installed: false,
      custodyReleased: false,
    }),
    persistPayload: candidate => {
      persisted = candidate;
      return { path: candidate.payloadPath, sha256: candidate.payloadSha256, bytes: candidate.payloadBytes.length };
    },
    ...overrides,
  };
  return { deps, get persisted() { return persisted; }, bytesByPath };
}

test('exact current source prepares only a private operator approval candidate', () => {
  const f = fixture();
  const result = prepareFixedRuntimeInstallHandoffV1({ expectedMain: HEAD, testOnly: true, deps: f.deps });
  assert.equal(result.schemaVersion, FIXED_RUNTIME_INSTALL_HANDOFF_SCHEMA_V1);
  assert.equal(result.ok, true);
  assert.equal(result.state, 'READY_FOR_OPERATOR_APPROVAL');
  assert.equal(result.expectedMain, HEAD);
  assert.equal(result.sourceTree, TREE);
  assert.equal(result.sourceFileCount, FIXED_RUNTIME_SOURCE_PATHS_V1.length);
  assert.equal(result.containsPrivateOperatorIdentity, true);
  assert.equal(result.installationPerformed, false);
  assert.equal(result.elevationPerformed, false);
  assert.equal(result.pcRestartPerformed, false);
  assert.equal(result.laterFullBootRequired, true);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(f.persisted.expectedMain, HEAD);
});

test('source movement and local materialization drift refuse before candidate persistence', () => {
  let writes = 0;
  const moved = fixture({
    truthFn: () => ({ ok: true, head: 'c'.repeat(40), originHead: 'c'.repeat(40), branch: 'main', workingTreeDirty: false }),
    persistPayload: () => { writes += 1; },
  });
  assert.equal(prepareFixedRuntimeInstallHandoffV1({ expectedMain: HEAD, testOnly: true, deps: moved.deps }).blocker,
    'FIXED_RUNTIME_HANDOFF_CANONICAL_SOURCE_UNPROVEN');
  assert.equal(writes, 0);

  const changed = fixture();
  const first = FIXED_RUNTIME_SOURCE_PATHS_V1[0];
  changed.deps.readFile = absolute => absolute === resolve(ROOT, first)
    ? Buffer.from('changed') : fixture().deps.readFile(absolute);
  const result = prepareFixedRuntimeInstallHandoffV1({ expectedMain: HEAD, testOnly: true, deps: changed.deps });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'FIXED_RUNTIME_HANDOFF_MATERIALIZATION_CHANGED');
});

test('status distinguishes missing, pending later boot and qualified runtime without installing', () => {
  const missing = fixture();
  assert.equal(inspectFixedRuntimeInstallHandoffV1({ expectedMain: HEAD, testOnly: true, deps: missing.deps }).state, 'MISSING');

  const pending = fixture({ inspect: () => ({ ok: false, reason: 'RUNTIME_PENDING_LATER_BOOT_UNPROVEN' }) });
  const p = inspectFixedRuntimeInstallHandoffV1({ expectedMain: HEAD, testOnly: true, deps: pending.deps });
  assert.equal(p.ok, true);
  assert.equal(p.state, 'PENDING_REBOOT');
  assert.equal(p.laterFullBootRequired, true);

  const qualified = fixture({ inspect: () => ({ ok: true, sourceHead: HEAD }) });
  const q = inspectFixedRuntimeInstallHandoffV1({ expectedMain: HEAD, testOnly: true, deps: qualified.deps });
  assert.equal(q.ok, true);
  assert.equal(q.state, 'QUALIFIED');
  assert.equal(q.laterFullBootRequired, false);
});

test('handoff refuses widened candidate authority or malformed expected main', () => {
  const elevated = fixture({
    buildCandidate: ({ expectedMain, sourceTree }) => ({
      expectedMain, sourceTree,
      payloadPath: 'fixed',
      payloadBytes: Buffer.from('x'),
      payloadSha256: 'd'.repeat(64),
      powershellExecutable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      encodedCommand: 'QUJD',
      independentSourceAuthorityProven: false,
      operatorApprovalProven: true,
      elevationPerformed: false,
      installed: false,
      custodyReleased: false,
    }),
  });
  assert.equal(prepareFixedRuntimeInstallHandoffV1({ expectedMain: HEAD, testOnly: true, deps: elevated.deps }).blocker,
    'FIXED_RUNTIME_HANDOFF_CANDIDATE_UNPROVEN');
  assert.equal(prepareFixedRuntimeInstallHandoffV1({ expectedMain: 'bad', testOnly: true, deps: elevated.deps }).ok, false);
});
