import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConstraintLifecycleAudit,
  classifyConstraintCandidate,
  extractConstraintLifecycleAnnotation,
} from './constraintLifecycleAuditV1.mjs';

test('unannotated fail-closed signal requires lifecycle review', () => {
  const findings = classifyConstraintCandidate({
    file: 'shared/agents/example.mjs',
    line: 12,
    excerpt: 'Conflicting evidence must fail closed.',
    context: 'Conflicting evidence must fail closed.',
  });
  assert.equal(findings.some((finding) => finding.signalId === 'FAIL_CLOSED_SIGNAL'), true);
  assert.equal(findings.find((finding) => finding.signalId === 'FAIL_CLOSED_SIGNAL').needsLifecycleReview, true);
});

test('declared permanent constraint is recognised without being called stale', () => {
  const findings = classifyConstraintCandidate({
    file: 'shared/agents/example.mjs',
    line: 20,
    excerpt: 'Conflicting terminal receipts fail closed.',
    context: '// CONSTRAINT-LIFECYCLE: CONSTITUTIONAL_PERMANENT\nConflicting terminal receipts fail closed.',
  });
  const finding = findings.find((entry) => entry.signalId === 'FAIL_CLOSED_SIGNAL');
  assert.equal(finding.lifecycleState, 'CONSTITUTIONAL_PERMANENT');
  assert.equal(finding.needsLifecycleReview, false);
});

test('known mutation defaults and automatic launch denial are surfaced as one candidate family', () => {
  const findings = classifyConstraintCandidate({
    file: 'shared/agents/codexDispatchQueue.mjs',
    line: 9,
    excerpt: 'automaticCodexLaunchAllowed: false,',
    context: 'mutationAllowed: false, openClawMutationLocked: true, codexAutoDispatchAllowed: false, automaticCodexLaunchAllowed: false,',
  });
  assert.equal(findings.some((finding) => finding.constraintClass === 'MUTATION_DEFAULT_DENY'), true);
});

test('provider qualification without admission authority is surfaced', () => {
  const findings = classifyConstraintCandidate({
    file: 'shared/agents/openClawTaskClassPromotionCandidateV1.mjs',
    line: 300,
    excerpt: 'providerPoolAdmissionAllowed: false, providerQualificationAuthority: false,',
  });
  assert.equal(findings.some((finding) => finding.constraintClass === 'PROVIDER_ADMISSION_DENY'), true);
});

test('restart-intent-only recovery is surfaced', () => {
  const findings = classifyConstraintCandidate({
    file: 'shared/agents/battleBridgeSupervisor.test.mjs',
    line: 42,
    excerpt: "test('worker self-heal plan is restart-intent-only and never stores commands', () => {})",
  });
  assert.equal(findings.some((finding) => finding.constraintClass === 'DIAGNOSE_BUT_DO_NOT_ACT'), true);
});

test('provider qualification expiry is scoped to provider-like context', () => {
  const matching = classifyConstraintCandidate({
    file: 'shared/agents/openClawProviderPoolQualificationV1.mjs',
    line: 30,
    excerpt: 'expiresAtUtc',
    context: 'OpenClaw provider qualification receipt expiresAtUtc with MAX_RECEIPT_LIFETIME_MS',
  });
  assert.equal(matching.some((finding) => finding.constraintClass === 'FRESHNESS_OR_EXPIRY'), true);

  const unrelated = classifyConstraintCandidate({
    file: 'shared/agents/unrelated.mjs',
    line: 30,
    excerpt: 'expiresAtUtc',
    context: 'cache record expiresAtUtc',
  });
  assert.equal(unrelated.some((finding) => finding.constraintClass === 'FRESHNESS_OR_EXPIRY'), false);
});

test('unknown lifecycle annotation remains reviewable', () => {
  assert.equal(
    extractConstraintLifecycleAnnotation('// CONSTRAINT-LIFECYCLE: SOMETHING_NEW'),
    'UNKNOWN_REQUIRES_RECONSTRUCTION',
  );
});

test('audit summary is deterministic for a supplied timestamp', () => {
  const findings = [
    ...classifyConstraintCandidate({ file: 'b.mjs', line: 2, excerpt: 'SAFE_HOLD' }),
    ...classifyConstraintCandidate({ file: 'a.mjs', line: 1, excerpt: 'fail closed' }),
  ];
  const audit = buildConstraintLifecycleAudit(findings, { generatedAt: '2026-09-19T18:00:00.000Z' });
  assert.equal(audit.schemaVersion, 'stephanos.constraint-lifecycle-audit.v1');
  assert.equal(audit.generatedAt, '2026-09-19T18:00:00.000Z');
  assert.equal(audit.findingCount, 2);
  assert.equal(audit.unclassifiedCount, 2);
  assert.deepEqual(audit.findings.map((finding) => finding.file), ['a.mjs', 'b.mjs']);
});
