import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  detectOrphanFlywheelEndpoints,
  scanConstraintLifecycleCandidates,
} from './constraint-lifecycle-audit.mjs';

test('repository scan finds source candidates and skips generated/dependency directories', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'constraint-lifecycle-audit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.mkdir(path.join(root, 'shared'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  await fs.mkdir(path.join(root, 'apps', 'demo', 'dist'), { recursive: true });

  await fs.writeFile(path.join(root, 'shared', 'live.mjs'), 'const state = "WAITING_FOR_OPERATOR";\n');
  await fs.writeFile(path.join(root, 'node_modules', 'pkg', 'ignored.mjs'), 'fail closed\n');
  await fs.writeFile(path.join(root, 'apps', 'demo', 'dist', 'ignored.js'), 'fail closed\n');

  const findings = await scanConstraintLifecycleCandidates(root);
  assert.equal(findings.some((finding) => finding.file === 'shared/live.mjs'), true);
  assert.equal(findings.some((finding) => finding.file.includes('node_modules')), false);
  assert.equal(findings.some((finding) => finding.file.includes('/dist/')), false);
});

test('nearby lifecycle annotation applies to a candidate', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'constraint-lifecycle-audit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(
    path.join(root, 'policy.mjs'),
    '// CONSTRAINT-LIFECYCLE: CONDITIONAL_ACTIVE\n// hazard: conflicting identity\nconst rule = "fail closed";\n',
  );

  const findings = await scanConstraintLifecycleCandidates(root);
  const failClosed = findings.find((finding) => finding.signalId === 'FAIL_CLOSED_SIGNAL');
  assert.equal(failClosed.lifecycleState, 'CONDITIONAL_ACTIVE');
  assert.equal(failClosed.needsLifecycleReview, false);
});

test('orphaned flywheel-facing modules are surfaced when only tests reference them', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'constraint-lifecycle-audit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.mkdir(path.join(root, 'shared', 'agents'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'shared', 'agents', 'exampleGapIntakeV1.mjs'),
    'export function evaluateExampleGapIntakeV1() { return { ok: true }; }\n',
  );
  await fs.writeFile(
    path.join(root, 'shared', 'agents', 'exampleGapIntakeV1.test.mjs'),
    "import { evaluateExampleGapIntakeV1 } from './exampleGapIntakeV1.mjs';\nvoid evaluateExampleGapIntakeV1;\n",
  );

  const findings = await scanConstraintLifecycleCandidates(root);
  const orphan = findings.find((finding) => finding.signalId === 'ORPHAN_FLYWHEEL_ENDPOINT_SIGNAL');
  assert.equal(orphan?.file, 'shared/agents/exampleGapIntakeV1.mjs');
  assert.equal(orphan?.constraintClass, 'FLYWHEEL_CONTINUITY');
});

test('a real production importer closes the orphan flywheel finding', async () => {
  const records = [
    {
      relativePath: 'shared/agents/exampleExecutionHandoffV1.mjs',
      content: 'export function buildExampleExecutionHandoffV1() { return {}; }',
    },
    {
      relativePath: 'stephanos-server/services/exampleConsumer.js',
      content: "import { buildExampleExecutionHandoffV1 } from '../../shared/agents/exampleExecutionHandoffV1.mjs';\nvoid buildExampleExecutionHandoffV1;",
    },
    {
      relativePath: 'shared/agents/exampleExecutionHandoffV1.test.mjs',
      content: "import './exampleExecutionHandoffV1.mjs';",
    },
  ];

  const findings = detectOrphanFlywheelEndpoints(records);
  assert.equal(findings.length, 0);
});

test('unrelated exported utility modules are not treated as flywheel endpoints', () => {
  const findings = detectOrphanFlywheelEndpoints([
    {
      relativePath: 'shared/agents/plainUtilityV1.mjs',
      content: 'export function plainUtilityV1() { return true; }',
    },
  ]);
  assert.equal(findings.length, 0);
});
