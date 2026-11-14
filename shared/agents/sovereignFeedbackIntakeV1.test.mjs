import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink, link } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  captureSovereignFeedbackArgumentsV1,
  createSovereignFeedbackIntakeV1,
  SOVEREIGN_FEEDBACK_CATEGORIES_V1,
  SOVEREIGN_FEEDBACK_OPERATION_IDS_V1,
  SOVEREIGN_FEEDBACK_LIMITS_V1,
} from './sovereignFeedbackIntakeV1.mjs';
import { writeAtomicJson, validateSharedWorkspaceRecord } from './sharedAgentWorkspaceStore.mjs';
import { readSharedWorkspaceRecordDirectory } from './shared-workspace-dashboard-feed.mjs';
import { extractSovereignNativeCapabilityGapsV1 } from './sovereignCommanderNativeGapIntakeV1.mjs';
import { buildSharedEngineeringLessonFromEventV1,
  promoteSharedWorkspaceLearningCandidatesV1 } from './flywheelLearningFabricV1.mjs';

const STAMP = '2026-11-07T00:20:00.000Z';
const ROUTE = Object.freeze({ commandPathProven: true, mcpSessionReady: true,
  transport: 'local-stdio-mcp', authenticatedMcp: false });
const HTTP_ROUTE = Object.freeze({ ...ROUTE, transport: 'authenticated-http-jsonrpc', authenticatedMcp: true });
const args = (overrides = {}) => ({ category: 'improvement', operation: 'general',
  message: 'Please explain the retained result limit more clearly.', ...overrides });
const digest = value => createHash('sha256').update(value).digest('hex');

async function workspace(run) {
  const base = await mkdtemp(join(tmpdir(), 'sovereign-feedback-'));
  const repoRoot = join(base, 'repo'), workspaceRoot = join(base, 'workspace');
  await mkdir(repoRoot);
  await mkdir(join(workspaceRoot, 'events'), { recursive: true });
  await mkdir(join(workspaceRoot, 'lessons'));
  try {
    await run({ base, repoRoot, workspaceRoot,
      options: { repoRoot, workspaceRoot, now: () => STAMP } });
  } finally { await rm(base, { recursive: true, force: true }); }
}

function execute(service, input = args(), route = ROUTE) {
  return service.execute('SUBMIT_FEEDBACK', input, route);
}

test('strict capture owns frozen sanitized data and covers the original outcomes without granting them', () => {
  const input = args({ message: '  Better progress text, please.\r\nKeep the original goal.  ' });
  const captured = captureSovereignFeedbackArgumentsV1(input);
  assert.deepEqual(captured, args({ message: 'Better progress text, please.\nKeep the original goal.' }));
  assert.ok(Object.isFrozen(captured));
  assert.notEqual(captured, input);
  assert.ok(input.message.startsWith('  '));
  assert.equal(SOVEREIGN_FEEDBACK_CATEGORIES_V1.length, 3);
  for (const operation of ['give_feedback_to_desktop_commander', 'interact_with_process', 'kill_process',
    'force_terminate', 'write_pdf', 'who_am_i', 'shutdown', 'submit_feedback']) {
    assert.ok(SOVEREIGN_FEEDBACK_OPERATION_IDS_V1.includes(operation));
    assert.equal(captureSovereignFeedbackArgumentsV1(args({ operation })).operation, operation);
  }
});

test('capture rejects caller authority, identities, paths, accessors, symbols and prototype tricks', () => {
  let getterReads = 0;
  const accessor = args();
  Object.defineProperty(accessor, 'message', { get() { getterReads++; throw new Error('private-value'); } });
  const invalid = [null, [], {}, Object.assign(Object.create(null), args()),
    Object.assign(Object.create({ trusted: true }), args()), accessor,
    { ...args(), [Symbol('extra')]: 'hidden' },
    ...['root', 'repoRoot', 'workspaceRoot', 'participantId', 'transport', 'evidenceRefs',
      'genuineCapabilityFailure', 'capabilityFailure', 'learningCandidate', 'eventId', 'timestampUtc']
      .map(key => ({ ...args(), [key]: 'caller-supplied' })),
    args({ category: 'CAPABILITY_GAP' }), args({ operation: 'arbitrary_shell' }), args({ message: 3 }),
    new Proxy({}, { getPrototypeOf() { throw new Error('private-value'); } }),
  ];
  for (const input of invalid) assert.equal(captureSovereignFeedbackArgumentsV1(input), null);
  assert.equal(getterReads, 0);
});

test('message limits apply to raw UTF-8 bytes and reject control or empty content', () => {
  assert.ok(captureSovereignFeedbackArgumentsV1(args({ message: 'é'.repeat(512) })));
  for (const message of ['é'.repeat(513), 'x'.repeat(1025), ' '.repeat(1025) + 'useful',
    '\n ', 'bad\0text', 'bad\ttext', 'bad\u202etext', 'bad\u007ftext', 'bad\rtext']) {
    assert.equal(captureSovereignFeedbackArgumentsV1(args({ message })), null);
  }
});

test('known credentials, private keys, URLs, email and spaced absolute paths are projected out before admission', () => {
  const privateParts = [
    'Bearer abcdefghijk123', 'password="a secret with spaces"',
    'sk-proj-abcdefghijk123456', 'github_pat_abcdefghijk123456', 'AKIA1234567890123456',
    'https://example.invalid/private?q=sentinel', 'operator@example.invalid',
    'C:\\Users\\Private Operator\\secret file.txt', '/home/private operator/secret.txt',
    '\\\\private-server\\home\\personal notes.txt',
    '-----BEGIN PRIVATE KEY-----\nPRIVATE-KEY-SENTINEL\n-----END PRIVATE KEY-----',
  ];
  const message = `Please improve result explanations.\n${privateParts.join('\n')}\nKeep the same goal.`;
  const captured = captureSovereignFeedbackArgumentsV1(args({ message }));
  assert.ok(captured);
  assert.match(captured.message, /Please improve result explanations/);
  assert.match(captured.message, /Keep the same goal/);
  for (const value of privateParts) assert.ok(!captured.message.includes(value), value);
  for (const value of ['private-server', 'Private Operator', 'PRIVATE-KEY-SENTINEL', 'secret with spaces'])
    assert.ok(!captured.message.includes(value), value);
  assert.deepEqual(captureSovereignFeedbackArgumentsV1(captured), captured);
  assert.equal(captureSovereignFeedbackArgumentsV1(args({ message: 'password=only-secret' })), null);
  assert.equal(captureSovereignFeedbackArgumentsV1(args({ message: 'https://example.invalid/private' })), null);
});

test('prefixed and suffixed credential assignments and private-key variants are absent from real stored events', async () => {
  await workspace(async ({ options, workspaceRoot, repoRoot }) => {
    const service = createSovereignFeedbackIntakeV1(options);
    const variants = [
      ['OPENAI_API_KEY=FAKE_REVIEW_CREDENTIAL_123456', 'FAKE_REVIEW_CREDENTIAL_123456'],
      ['AWS_SECRET_ACCESS_KEY=FAKE_AWS_SECRET_CANARY', 'FAKE_AWS_SECRET_CANARY'],
      ['AWS_SESSION_TOKEN=FAKE_AWS_TEMPORARY_CANARY', 'FAKE_AWS_TEMPORARY_CANARY'],
      ['SERVICE_API_KEY_PRIMARY=FAKE_SUFFIX_CANARY', 'FAKE_SUFFIX_CANARY'],
      ['"OPENAI_API_KEY": "FAKE_QUOTED_JSON_CANARY"', 'FAKE_QUOTED_JSON_CANARY'],
      ['"AWS_SECRET_ACCESS_KEY": "FAKE_QUOTED_AWS_CANARY"', 'FAKE_QUOTED_AWS_CANARY'],
      ['"AWS_SESSION_TOKEN": "FAKE_QUOTED_TEMPORARY_CANARY"', 'FAKE_QUOTED_TEMPORARY_CANARY'],
      ['"openaiApiKeyPrimary": "FAKE_CAMELCASE_CANARY"', 'FAKE_CAMELCASE_CANARY'],
      ['"OPENAI\\u005fAPI\\u005fKEY": "FAKE_ESCAPED_NAME_CANARY"', 'FAKE_ESCAPED_NAME_CANARY'],
      ["'provider.access-key.current' = 'FAKE_DOTTED_NAME_CANARY'", 'FAKE_DOTTED_NAME_CANARY'],
      ['mode=manual; AWS_ACCESS_KEY_ID=FAKE_SECOND_ASSIGNMENT_CANARY', 'FAKE_SECOND_ASSIGNMENT_CANARY'],
      ...['PRIVATE KEY', 'ENCRYPTED PRIVATE KEY', 'RSA PRIVATE KEY', 'OPENSSH PRIVATE KEY',
        'PGP PRIVATE KEY BLOCK'].map((label, i) => {
        const canary = `FAKE_ARMORED_KEY_CANARY_${i}`;
        return [`-----BEGIN ${label}-----\n${canary}\n-----END ${label}-----`, canary];
      }),
    ];
    const canaries = variants.map(([, canary]) => canary);
    for (const [index, [sensitive, canary]] of variants.entries()) {
      const input = args({ message: `Improve feedback guidance ${index}.\n${sensitive}\nKeep the original goal.` });
      const captured = captureSovereignFeedbackArgumentsV1(input);
      assert.ok(captured, String(index));
      assert.ok(!captured.message.includes(canary), String(index));
      assert.deepEqual(captureSovereignFeedbackArgumentsV1(captured), captured);
      const receipt = await execute(service, input, HTTP_ROUTE);
      assert.equal(receipt.feedbackState, 'PERSISTED', String(index));
      const bytes = await readFile(join(workspaceRoot, 'events', `${receipt.eventId}.json`));
      assert.equal(receipt.recordSha256, digest(bytes));
      const stored = bytes.toString('utf8');
      assert.ok(!stored.includes(canary), String(index));
      assert.ok(!stored.includes(digest(input.message)), String(index));
      assert.ok(!JSON.stringify(receipt).includes(canary), String(index));
      assert.equal(JSON.parse(stored).feedback.message, captured.message);
    }
    const canonical = await readSharedWorkspaceRecordDirectory(workspaceRoot, 'events',
      { repoRoot, nowMs: Date.parse(STAMP) });
    assert.deepEqual(canonical.errors, []);
    assert.equal(canonical.records.length, variants.length);
    const readerOutput = JSON.stringify(canonical.records);
    for (const canary of canaries) assert.ok(!readerOutput.includes(canary), canary);
    assert.equal(extractSovereignNativeCapabilityGapsV1(canonical.records, { nowUtc: STAMP }).candidateCount, 0);
    service.dispose();
  });
});

test('credential projection preserves explanatory prose and is idempotent across a bounded assignment model', async () => {
  await workspace(async ({ options, workspaceRoot, repoRoot }) => {
    const assignments = [
      value => `api_key=${value}`,
      value => `OPENAI_API_KEY=${value}`,
      value => `AWS_SECRET_ACCESS_KEY="${value} with spaces"`,
      value => `AWS_SESSION_TOKEN='${value}'`,
      value => `"openaiApiKeyPrimary": "${value}"`,
      value => `"OPENAI\\u005fAPI\\u005fKEY": "${value}"`,
      value => `api key = "${value} with spaces"`,
      value => `client secret IS '${value}'`,
    ];
    const prefixes = ['Please improve this error. ', 'Context: mode=manual; ',
      'Reported issue\nUseful prefix: '];
    // An unquoted/spaced value still consumes its own line conservatively.
    // Text after that line remains useful feedback and must survive unchanged.
    const suffixes = ['', '\nKeep the original goal and improve progress messages.'];
    const eventIds = new Set();
    for (const prefix of prefixes) for (const suffix of suffixes) {
      const service = createSovereignFeedbackIntakeV1(options);
      const expectedMessage = `${prefix}[redacted]${suffix}`;
      let expectedEventId;
      for (const [index, assignment] of assignments.entries()) {
        const canary = `FAKE_ASSIGNMENT_MODEL_CANARY_${index}`;
        const input = args({ message: prefix + assignment(canary) + suffix });
        const captured = captureSovereignFeedbackArgumentsV1(input);
        assert.ok(captured, input.message);
        assert.equal(captured.message, expectedMessage);
        assert.deepEqual(captureSovereignFeedbackArgumentsV1(captured), captured);
        assert.ok(!captured.message.includes(canary));
        const receipt = await execute(service, input, HTTP_ROUTE);
        assert.equal(receipt.feedbackState, 'PERSISTED');
        expectedEventId ??= receipt.eventId;
        assert.equal(receipt.eventId, expectedEventId);
        eventIds.add(receipt.eventId);
        const stored = await readFile(join(workspaceRoot, 'events', `${receipt.eventId}.json`), 'utf8');
        assert.equal(JSON.parse(stored).feedback.message, expectedMessage);
        assert.equal(receipt.recordSha256, digest(stored));
        assert.ok(!stored.includes(canary));
        assert.ok(!stored.includes(digest(input.message)));
        assert.ok(!JSON.stringify(receipt).includes(canary));
      }
      service.dispose();
    }
    const canonical = await readSharedWorkspaceRecordDirectory(workspaceRoot, 'events',
      { repoRoot, nowMs: Date.parse(STAMP) });
    assert.deepEqual(canonical.errors, []);
    assert.equal(canonical.records.length, prefixes.length * suffixes.length);
    assert.equal(eventIds.size, canonical.records.length);
    assert.ok(!JSON.stringify(canonical.records).includes('FAKE_ASSIGNMENT_MODEL_CANARY'));
  });
});

test('real persisted feedback is readable by the existing store and cannot qualify native gaps or Flywheel lessons', async () => {
  await workspace(async ({ options, workspaceRoot, repoRoot }) => {
    const service = createSovereignFeedbackIntakeV1(options);
    const input = args({ category: 'problem', operation: 'start_process',
      message: 'The requested action appears unavailable; please investigate before changing it.' });
    const receipt = await execute(service, input, HTTP_ROUTE);
    assert.equal(receipt.ok, true);
    assert.equal(receipt.feedbackState, 'PERSISTED');
    assert.equal(receipt.canonicalOwnerGoal, '#2573');
    assert.equal(receipt.advisoryOnly, true);
    for (const flag of ['evidenceVerified', 'operatorIdentityVerified', 'automaticAdmissionAllowed',
      'executionAuthority', 'runtimeParityProven', 'externalSubmission', 'retryAllowed'])
      assert.equal(receipt[flag], false, flag);
    const path = join(workspaceRoot, 'events', `${receipt.eventId}.json`);
    const bytes = await readFile(path);
    assert.equal(receipt.recordBytes, bytes.length);
    assert.equal(receipt.recordSha256, digest(bytes));
    const record = JSON.parse(bytes);
    assert.equal(validateSharedWorkspaceRecord(record).valid, true);
    assert.equal(record.eventKind, 'sovereign-user-feedback');
    assert.equal(record.feedback.provenance, 'CALLER_SUBMITTED_UNVERIFIED');
    assert.equal(record.feedback.transport, 'authenticated-http-jsonrpc');
    assert.equal(record.feedback.message, input.message);
    const canonical = await readSharedWorkspaceRecordDirectory(workspaceRoot, 'events',
      { repoRoot, nowMs: Date.parse(STAMP) });
    assert.deepEqual(canonical.errors, []);
    assert.deepEqual(canonical.records, [record]);
    for (const key of ['capabilityFailure', 'closedLoopLearning', 'learningCandidate', 'capabilityGapCandidate'])
      assert.equal(Object.hasOwn(record, key), false);
    assert.equal(extractSovereignNativeCapabilityGapsV1(canonical.records, { nowUtc: STAMP }).candidateCount, 0);
    assert.equal(buildSharedEngineeringLessonFromEventV1(record), null);
    const learning = await promoteSharedWorkspaceLearningCandidatesV1({ root: workspaceRoot,
      repoRoot, nowMs: Date.parse(STAMP) });
    assert.equal(learning.ok, true);
    assert.deepEqual(learning.promotedLessonIds, []);
    assert.deepEqual(await readdir(join(workspaceRoot, 'lessons')), []);
    assert.ok(!JSON.stringify(receipt).includes(input.message));
    assert.ok(!JSON.stringify(receipt).includes(workspaceRoot));
    service.dispose();
  });
});

test('identical sanitized feedback deduplicates across handlers while its advisory timestamp may refresh', async () => {
  await workspace(async ({ options, workspaceRoot }) => {
    const first = createSovereignFeedbackIntakeV1(options);
    const second = createSovereignFeedbackIntakeV1({ ...options, now: () => '2026-11-07T00:21:00.000Z' });
    const a = await execute(first, args({ message: 'Improve this result.\npassword=private-one' }));
    const b = await execute(second, args({ message: 'Improve this result.\npassword=private-two' }));
    assert.equal(a.feedbackState, 'PERSISTED');
    assert.equal(b.feedbackState, 'PERSISTED');
    assert.equal(a.eventId, b.eventId);
    assert.notEqual(a.recordedAtUtc, b.recordedAtUtc);
    assert.notEqual(a.recordSha256, b.recordSha256);
    assert.deepEqual(await readdir(join(workspaceRoot, 'events')), [`${a.eventId}.json`]);
    const c = await execute(second, args({ message: 'A different improvement.' }));
    assert.notEqual(c.eventId, a.eventId);
    const content = await readFile(join(workspaceRoot, 'events', `${a.eventId}.json`), 'utf8');
    for (const value of ['private-one', 'private-two', digest('private-one'), digest('private-two')])
      assert.ok(!content.includes(value));
    first.dispose(); second.dispose();
  });
});

test('service directly requires the trusted private route and does not accept caller transport claims', async () => {
  await workspace(async ({ options, workspaceRoot }) => {
    const service = createSovereignFeedbackIntakeV1(options);
    let getterReads = 0;
    const accessor = { ...ROUTE };
    Object.defineProperty(accessor, 'mcpSessionReady', { get() { getterReads++; return true; } });
    for (const route of [undefined, {}, { ...ROUTE, commandPathProven: false },
      { ...ROUTE, mcpSessionReady: false }, { ...HTTP_ROUTE, authenticatedMcp: false },
      { ...ROUTE, transport: 'github-mailbox' }, accessor]) {
      const result = await service.execute('SUBMIT_FEEDBACK', args(), route);
      assert.equal(result.feedbackState, 'NOT_STARTED');
      assert.equal(result.blocker, 'SOVEREIGN_FEEDBACK_PRIVATE_ROUTE_REQUIRED');
    }
    assert.equal(getterReads, 0);
    assert.equal((await execute(service, { ...args(), transport: ROUTE.transport })).feedbackState, 'NOT_STARTED');
    assert.equal((await service.execute('REPORT_CAPABILITY_GAP', args(), ROUTE)).feedbackState, 'NOT_STARTED');
    assert.deepEqual(await readdir(join(workspaceRoot, 'events')), []);
    service.dispose();
  });
});

test('existing store validation remains unchanged and rejected text is not echoed or persisted', async () => {
  await workspace(async ({ options, workspaceRoot }) => {
    const service = createSovereignFeedbackIntakeV1(options);
    const input = args({ message: 'The session should retain this private-note sentinel.' });
    const result = await execute(service, input);
    assert.equal(result.feedbackState, 'NOT_STARTED');
    assert.equal(result.blocker, 'SOVEREIGN_FEEDBACK_CONTENT_REJECTED');
    assert.ok(!JSON.stringify(result).includes('sentinel'));
    assert.deepEqual(await readdir(join(workspaceRoot, 'events')), []);
    service.dispose();
  });
});

test('missing, linked, inside-repository or incomplete workspaces cannot be created or used by caller feedback', async () => {
  await workspace(async ({ base, options, workspaceRoot, repoRoot }) => {
    const missing = join(base, 'missing'), incomplete = join(base, 'incomplete');
    await mkdir(incomplete);
    const linked = join(base, 'linked');
    await symlink(workspaceRoot, linked, process.platform === 'win32' ? 'junction' : 'dir');
    let writes = 0;
    for (const root of [missing, incomplete, join(repoRoot, 'feedback'), linked]) {
      const service = createSovereignFeedbackIntakeV1({ ...options, workspaceRoot: root,
        writeEvent() { writes++; throw new Error('must not write'); } });
      const result = await execute(service);
      assert.equal(result.feedbackState, 'NOT_STARTED');
      assert.equal(result.blocker, 'SOVEREIGN_FEEDBACK_WORKSPACE_UNAVAILABLE');
      assert.ok(!JSON.stringify(result).includes(base));
      service.dispose();
    }
    assert.equal(writes, 0);
    await assert.rejects(readdir(missing), { code: 'ENOENT' });
    assert.deepEqual(await readdir(incomplete), []);
  });
});

test('an events-directory link and an existing hard-linked destination are refused before publication', async () => {
  await workspace(async ({ base, options, workspaceRoot }) => {
    const nested = join(base, 'nested'), outside = join(base, 'outside');
    await mkdir(nested); await mkdir(outside);
    await symlink(outside, join(nested, 'events'), process.platform === 'win32' ? 'junction' : 'dir');
    const linked = createSovereignFeedbackIntakeV1({ ...options, workspaceRoot: nested });
    assert.equal((await execute(linked)).feedbackState, 'NOT_STARTED');
    assert.deepEqual(await readdir(outside), []);
    const normal = createSovereignFeedbackIntakeV1(options);
    const receipt = await execute(normal);
    assert.equal(receipt.feedbackState, 'PERSISTED');
    await link(join(workspaceRoot, 'events', `${receipt.eventId}.json`), join(outside, 'copy.json'));
    const refused = await execute(normal);
    assert.equal(refused.feedbackState, 'NOT_STARTED');
    assert.equal(refused.blocker, 'SOVEREIGN_FEEDBACK_WORKSPACE_UNAVAILABLE');
    linked.dispose(); normal.dispose();
  });
});

test('lost writer acknowledgement stays UNKNOWN and the same feedback cannot silently retry in that handler', async () => {
  await workspace(async ({ options, workspaceRoot }) => {
    let writes = 0;
    const service = createSovereignFeedbackIntakeV1({ ...options, writeEvent: async (...call) => {
      writes++;
      await writeAtomicJson(...call);
      throw new Error('private failure at C:\\Operator\\secret');
    } });
    const first = await execute(service);
    assert.equal(first.feedbackState, 'UNKNOWN');
    assert.equal(first.retryAllowed, false);
    assert.equal(first.blocker, 'SOVEREIGN_FEEDBACK_PERSISTENCE_UNPROVEN');
    assert.equal((await readdir(join(workspaceRoot, 'events'))).length, 1);
    const again = await execute(service);
    assert.equal(again.feedbackState, 'UNKNOWN');
    assert.equal(again.blocker, 'SOVEREIGN_FEEDBACK_PRIOR_WRITE_UNCERTAIN');
    assert.equal(writes, 1);
    assert.ok(!JSON.stringify([first, again]).includes('private failure'));
    assert.ok(!JSON.stringify([first, again]).includes('Operator'));
    service.dispose();
  });
});

test('a false writer result, absent readback, changed record or oversized readback cannot become persisted proof', async () => {
  for (const mode of ['refused', 'missing', 'changed', 'oversized']) {
    await workspace(async ({ options }) => {
      const service = createSovereignFeedbackIntakeV1({ ...options,
        writeEvent: async (root, segments, record, writerOptions) => {
          if (mode === 'refused') return { ok: false, reason: 'private-path-sentinel' };
          if (mode === 'changed') {
            await writeAtomicJson(root, segments, { ...record, summary: 'Different record' }, writerOptions);
          }
          if (mode === 'oversized') await writeFile(join(root, ...segments),
            'private-readback-sentinel'.repeat(SOVEREIGN_FEEDBACK_LIMITS_V1.recordBytes));
          return { ok: true };
        } });
      const receipt = await execute(service);
      assert.equal(receipt.ok, false, mode);
      assert.equal(receipt.feedbackState, 'UNKNOWN', mode);
      assert.equal(receipt.retryAllowed, false, mode);
      assert.ok(!JSON.stringify(receipt).includes('sentinel'), mode);
      service.dispose();
    });
  }
});

test('one publication owns admission until settlement and disposal does not claim to cancel its write', async () => {
  await workspace(async ({ options, workspaceRoot }) => {
    let entered, release;
    const started = new Promise(resolve => { entered = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    const service = createSovereignFeedbackIntakeV1({ ...options,
      writeEvent: async (...call) => { entered(); await held; return writeAtomicJson(...call); } });
    const active = execute(service);
    await started;
    const second = await execute(service, args({ message: 'Different request.' }));
    assert.equal(second.feedbackState, 'NOT_STARTED');
    assert.equal(second.blocker, 'SOVEREIGN_FEEDBACK_PUBLICATION_IN_FLIGHT');
    assert.deepEqual(service.dispose(), { closed: true, inFlight: true });
    release();
    assert.equal((await active).feedbackState, 'PERSISTED');
    const third = await execute(service);
    assert.equal(third.feedbackState, 'NOT_STARTED');
    assert.equal(third.blocker, 'SOVEREIGN_FEEDBACK_HANDLER_CLOSED');
    assert.equal((await readdir(join(workspaceRoot, 'events'))).length, 1);
  });
});

test('the fixed per-handler publication cap prevents a seventeenth write', async () => {
  await workspace(async ({ options, workspaceRoot }) => {
    const service = createSovereignFeedbackIntakeV1(options);
    for (let i = 0; i < SOVEREIGN_FEEDBACK_LIMITS_V1.submissions; i++) {
      const receipt = await execute(service, args({ message: `Feedback item ${i}: improve the explanation.` }));
      assert.equal(receipt.feedbackState, 'PERSISTED');
    }
    const denied = await execute(service, args({ message: 'One more improvement.' }));
    assert.equal(denied.feedbackState, 'NOT_STARTED');
    assert.equal(denied.blocker, 'SOVEREIGN_FEEDBACK_SUBMISSION_LIMIT');
    assert.equal((await readdir(join(workspaceRoot, 'events'))).length, 16);
    service.dispose();
  });
});

test('invalid host clocks fail before any persistence and never echo exception content', async () => {
  await workspace(async ({ options, workspaceRoot }) => {
    for (const now of [() => 'invalid-private-clock', () => 123,
      () => { throw new Error('private clock state'); }]) {
      const service = createSovereignFeedbackIntakeV1({ ...options, now });
      const receipt = await execute(service);
      assert.equal(receipt.feedbackState, 'NOT_STARTED');
      assert.equal(receipt.blocker, 'SOVEREIGN_FEEDBACK_CLOCK_INVALID');
      assert.ok(!JSON.stringify(receipt).includes('private clock'));
      service.dispose();
    }
    assert.deepEqual(await readdir(join(workspaceRoot, 'events')), []);
  });
});
