import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import {
  PERSONAL_REPOSITORY_AUTHORITY,
  PERSONAL_REPOSITORY_ARTIFACT_PAYLOAD_MAX_BYTES,
  PERSONAL_REPOSITORY_CHECK_SNAPSHOT_CONVERGENCE_TIMEOUT_MS,
  PERSONAL_REPOSITORY_CHECK_SNAPSHOT_POLL_INTERVAL_MS,
  PERSONAL_REPOSITORY_APPROVAL_JOB,
  PERSONAL_REPOSITORY_EVIDENCE_JOB,
  PERSONAL_REPOSITORY_MERGE_JOB,
  PERSONAL_REPOSITORY_MODE,
  PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX,
  PERSONAL_REPOSITORY_READ_MAX_ATTEMPTS,
  PERSONAL_REPOSITORY_REQUIRED_CHECK,
  PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS,
  PERSONAL_REPOSITORY_WORKFLOW_NAME,
  PERSONAL_REPOSITORY_WORKFLOW_PATH,
  buildPersonalRepositoryArtifactApiRequest,
  buildPersonalRepositoryArtifactArchiveRequest,
  buildPersonalRepositoryConfigurationEvidence,
  buildPersonalRepositoryApprovalReceipt,
  buildPersonalRepositoryCheckExpectation,
  executeBoundedPersonalRepositoryRead,
  executePersonalRepositoryArtifactArchiveTransport,
  extractPersonalRepositoryArtifactZip,
  parsePersonalRepositoryDispatchInputs,
  readBoundedPersonalRepositoryResponseBody,
  validatePersonalRepositoryApprovalReceipt,
  validatePersonalRepositoryArtifactArchiveRedirect,
  validatePersonalRepositoryArtifactArchiveResponse,
  validatePersonalRepositoryCheckRuns,
  validatePersonalRepositoryCheckRunsWithBoundedReread,
  validatePersonalRepositoryConfiguration,
  validatePersonalRepositoryDispatchExecution,
  validatePersonalRepositoryDispatchWorkflowDefinition,
  validatePersonalRepositoryEvidence,
  validatePersonalRepositoryPriorJobEnvelope,
  validatePersonalRepositoryRulesetProofRequest,
  validatePersonalRepositoryRulesetProofResponse,
  validatePersonalRepositoryReadOnlyPriorFailure,
  validatePersonalRepositorySquashCompletion,
  validatePersonalRepositoryWorkflowRuns,
  validatePersonalRepositoryWorkflowRunHydration,
} from './operatorPersonalRepositoryMergeV1.mjs';

const PERSONAL_REPOSITORY_MERGE_ENTRY = new URL(
  '../../scripts/operator-protected-personal-repository-merge.mjs',
  import.meta.url,
);

function response(status) {
  return { status, body: { cancel: async () => {} } };
}

function headers(values = {}) {
  const normalized = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name) => normalized[String(name).toLowerCase()] ?? null };
}

const ARTIFACT_API_PATH = '/repos/Cheekyfellastef/stephan-os/actions/artifacts/9140818868/zip';
const ARTIFACT_API_URL = `https://api.github.com${ARTIFACT_API_PATH}`;
const ARTIFACT_ARCHIVE_URL = 'https://productionresultssa17.blob.core.windows.net/actions-results/80c77559-8ff7-49a5-9d2f-08c5e8ff1b84/workflow-job-run-4d9be84b-e576-5bc3-a654-2085dc99aec3/artifacts/7fc179bd387fce1470d9f99f52fcca5a01ff1d1358562f69c71f5f1cf03b08f4.zip?rscd=attachment&rsct=application%2Fzip&se=2099-01-01T00%3A00%3A00Z&sig=signed&ske=2099-01-01T00%3A00%3A00Z&skoid=00000000-0000-0000-0000-000000000000&sks=b&skt=2099-01-01T00%3A00%3A00Z&sktid=00000000-0000-0000-0000-000000000000&skv=2025-11-05&sp=r&spr=https&sr=b&st=2099-01-01T00%3A00%3A00Z&sv=2025-11-05';

function artifactRedirectResponse(overrides = {}) {
  return {
    status: 302,
    redirected: false,
    url: ARTIFACT_API_URL,
    headers: headers({ location: ARTIFACT_ARCHIVE_URL }),
    body: { cancel: async () => {} },
    ...overrides,
  };
}

function artifactArchiveResponse(overrides = {}) {
  return {
    status: 200,
    redirected: false,
    url: ARTIFACT_ARCHIVE_URL,
    headers: headers({ 'content-type': 'application/zip', 'content-length': '1101' }),
    body: { cancel: async () => {} },
    ...overrides,
  };
}

const ARTIFACT_FILE = 'independent-review-result.json';
const TEST_CRC32_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

function testCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = TEST_CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function singleEntryZip({ payload = '{"ready":true}', fileName = ARTIFACT_FILE, method = 8, flags = 0, dataDescriptor = false } = {}) {
  const plain = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const compressed = method === 8 ? deflateRawSync(plain) : Buffer.from(plain);
  const name = Buffer.from(fileName, 'utf8');
  const crc = testCrc32(plain);
  const version = method === 8 ? 20 : 10;
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(version, 4);
  const resolvedFlags = flags | (dataDescriptor ? 0x0008 : 0);
  local.writeUInt16LE(resolvedFlags, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(dataDescriptor ? 0 : crc, 14);
  local.writeUInt32LE(dataDescriptor ? 0 : compressed.length, 18);
  local.writeUInt32LE(dataDescriptor ? 0 : plain.length, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);

  const descriptor = dataDescriptor ? Buffer.alloc(16) : Buffer.alloc(0);
  if (dataDescriptor) {
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(compressed.length, 8);
    descriptor.writeUInt32LE(plain.length, 12);
  }
  const centralOffset = local.length + compressed.length + descriptor.length;
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(version, 6);
  central.writeUInt16LE(resolvedFlags, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(plain.length, 24);
  central.writeUInt16LE(name.length, 28);
  name.copy(central, 46);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Object.freeze({
    archive: Buffer.concat([local, compressed, descriptor, central, end]),
    compressed,
    offsets: Object.freeze({
      data: local.length,
      central: centralOffset,
      end: centralOffset + central.length,
    }),
    plain,
  });
}

function mutateArchive(archive, mutate) {
  const copy = Buffer.from(archive);
  mutate(copy);
  return copy;
}

function assertZipBlocked(archive, expectedReason = null) {
  assert.throws(
    () => extractPersonalRepositoryArtifactZip(archive, ARTIFACT_FILE),
    (error) => {
      assert.equal(error.code, 'PERSONAL_REPOSITORY_ARTIFACT_ZIP_INVALID');
      if (expectedReason) assert.equal(error.reason, expectedReason);
      assert.doesNotMatch(error.message, /token-must-not-escape|github-token-must-not-escape/);
      return true;
    },
  );
}

test('check expectation binds trusted repository identity before exact check validation', () => {
  const input = {
    repository: 'Cheekyfellastef/stephan-os',
    identity: {
      prNumber: 1993,
      branch: 'codex/fix-ignition-porcelain-leading-status-v1',
      sourceHead: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
    },
    mergeStateStatus: 'clean',
  };
  const result = buildPersonalRepositoryCheckExpectation(input);
  assert.equal(result.valid, true);
  assert.deepEqual(result.expected, {
    repository: input.repository,
    prNumber: input.identity.prNumber,
    branch: input.identity.branch,
    sourceHead: input.identity.sourceHead,
    baseSha: input.identity.baseSha,
    mergeStateStatus: 'CLEAN',
  });
  assert.ok(buildPersonalRepositoryCheckExpectation({
    ...input,
    repository: '',
  }).blockers.includes('personal-repository-check-expectation-repository-invalid'));
});

test('protected merge entry constructs one repository-bound check expectation', () => {
  const source = readFileSync(PERSONAL_REPOSITORY_MERGE_ENTRY, 'utf8');
  assert.match(
    source,
    /const checkExpectation = buildPersonalRepositoryCheckExpectation\(\{[\s\S]*repository: context\.repository,[\s\S]*identity,[\s\S]*mergeStateStatus: review\.mergeStateStatus,[\s\S]*\}\);/,
  );
  assert.match(source, /expected: checkExpectation\.expected,/);
  assert.doesNotMatch(source, /expected:\s*\{\s*\.\.\.identity,\s*mergeStateStatus:/);
});

test('protected merge entry refreshes every authority input after bounded check convergence', () => {
  const source = readFileSync(PERSONAL_REPOSITORY_MERGE_ENTRY, 'utf8');
  const helper = source.match(
    /async function readPersonalRepositoryAuthoritySnapshot\([\s\S]*?\r?\n}\r?\n\r?\nasync function collectEvidence/,
  )?.[0] || '';
  for (const requiredRead of [
    /currentWorkflowExecution\(context\)/,
    /apiJson\(`\/repos\/\$\{context\.owner}\/\$\{context\.repo}`, \{ authorization: 'ruleset-proof' \}\)/,
    /pulls\/\$\{identity\.prNumber}/,
    /git\/ref\/heads\/main/,
    /git\/commits\/\$\{identity\.sourceHead}/,
    /compare\/\$\{identity\.baseSha}\.\.\.\$\{identity\.sourceHead}/,
    /pullRequestReviewState\(context\.owner, context\.repo, identity\.prNumber\)/,
    /environments\/operator-merge-approval/,
    /loadSelectedIndependentReview\([\s\S]*context,[\s\S]*identity,[\s\S]*text\(environment\?\.name\),[\s\S]*\)/,
  ]) assert.match(helper, requiredRead);

  const convergenceIndex = source.indexOf(
    'const checks = await validatePersonalRepositoryCheckRunsWithBoundedReread',
  );
  const refreshIndex = source.indexOf(
    'const refreshedAuthority = await readPersonalRepositoryAuthoritySnapshot(context, identity);',
  );
  assert.ok(convergenceIndex > 0);
  assert.ok(refreshIndex > convergenceIndex);
  assert.equal(
    source.match(/readPersonalRepositoryAuthoritySnapshot\(context, identity\)/g)?.length,
    3,
  );
  assert.match(
    source.slice(refreshIndex),
    /mergeStateStatus: refreshedAuthority\.review\.mergeStateStatus,[\s\S]*validatePersonalRepositoryCheckRuns\([\s\S]*refreshedCheckExpectation\.expected/,
  );
  assert.match(source.slice(refreshIndex), /\.\.\.refreshedReview,/);
  assert.match(source.slice(refreshIndex), /repository,\s*environment,\s*integrationId/);
  assert.match(source.slice(refreshIndex), /independentReview: refreshedIndependentReview/);
});

test('in-process artifact ZIP reader accepts exact stored and deflated single-entry archives', () => {
  for (const [method, dataDescriptor] of [[0, false], [8, false], [0, true], [8, true]]) {
    const fixture = singleEntryZip({ method, dataDescriptor });
    const payload = extractPersonalRepositoryArtifactZip(fixture.archive, ARTIFACT_FILE);
    assert.deepEqual(payload, fixture.plain);
  }
});

test('in-process artifact ZIP reader rejects authority-widening flags, formats and entry estates', () => {
  const exact = singleEntryZip();
  for (const [archive, reason] of [
    [mutateArchive(exact.archive, (bytes) => {
      bytes.writeUInt16LE(1, 6);
      bytes.writeUInt16LE(1, exact.offsets.central + 8);
    }), 'flags'],
    [mutateArchive(exact.archive, (bytes) => {
      bytes.writeUInt16LE(4, 6);
      bytes.writeUInt16LE(4, exact.offsets.central + 8);
    }), 'flags'],
    [mutateArchive(exact.archive, (bytes) => {
      bytes.writeUInt16LE(99, 8);
      bytes.writeUInt16LE(99, exact.offsets.central + 10);
    }), 'compression'],
    [mutateArchive(exact.archive, (bytes) => bytes.writeUInt32LE(0xffffffff, exact.offsets.central + 20)), 'zip64'],
    [mutateArchive(exact.archive, (bytes) => bytes.writeUInt16LE(45, exact.offsets.central + 6)), 'version'],
    [mutateArchive(exact.archive, (bytes) => bytes.writeUInt16LE(1, exact.offsets.end + 4)), 'multi-disk'],
    [mutateArchive(exact.archive, (bytes) => {
      bytes.writeUInt16LE(2, exact.offsets.end + 8);
      bytes.writeUInt16LE(2, exact.offsets.end + 10);
    }), 'entry-count'],
    [mutateArchive(exact.archive, (bytes) => bytes.writeUInt16LE(1, exact.offsets.end + 20)), 'archive-comment'],
    [mutateArchive(exact.archive, (bytes) => bytes.writeUInt16LE(1, exact.offsets.central + 30)), 'central-fields'],
  ]) assertZipBlocked(archive, reason);
});

test('in-process artifact ZIP reader rejects unsupported or mismatched data descriptors', () => {
  const exact = singleEntryZip({ dataDescriptor: true });
  const descriptorOffset = exact.offsets.central - 16;
  assertZipBlocked(mutateArchive(exact.archive, (bytes) => (
    bytes.writeUInt32LE(0, descriptorOffset)
  )), 'descriptor-signature');
  assertZipBlocked(mutateArchive(exact.archive, (bytes) => (
    bytes.writeUInt32LE(0, descriptorOffset + 4)
  )), 'descriptor-mismatch');
  assertZipBlocked(mutateArchive(exact.archive, (bytes) => (
    bytes.writeUInt32LE(1, 14)
  )), 'descriptor-local-fields');
  assertZipBlocked(mutateArchive(exact.archive, (bytes) => (
    bytes.writeUInt32LE(exact.offsets.central - 1, exact.offsets.end + 16)
  )), 'central-boundary');
});

test('in-process artifact ZIP reader rejects unsafe names, prefixes, trailing bytes and malformed boundaries', () => {
  assertZipBlocked(singleEntryZip({ fileName: '../independent-review-result.json' }).archive, 'filename-unsafe');
  const exact = singleEntryZip();
  assertZipBlocked(Buffer.concat([Buffer.from([0]), exact.archive]));
  assertZipBlocked(Buffer.concat([exact.archive, Buffer.from([0])]));
  assertZipBlocked(mutateArchive(exact.archive, (bytes) => (
    bytes.writeUInt32LE(exact.offsets.central + 1, exact.offsets.end + 16)
  )), 'central-boundary');
  assertZipBlocked(mutateArchive(exact.archive, (bytes) => (
    bytes.writeUInt32LE(1, exact.offsets.central + 42)
  )), 'archive-prefix');
  assertZipBlocked(mutateArchive(exact.archive, (bytes) => (
    bytes.writeUInt16LE(0, 8)
  )), 'local-central-mismatch');
  assertZipBlocked(mutateArchive(exact.archive, (bytes) => (
    bytes.writeUInt16LE(1, 10)
  )), 'local-central-mismatch');
});

test('in-process artifact ZIP reader rejects size, overlap, corruption and CRC attacks', () => {
  const exact = singleEntryZip();
  assertZipBlocked(mutateArchive(exact.archive, (bytes) => {
    bytes.writeUInt32LE(exact.compressed.length + 1, 18);
    bytes.writeUInt32LE(exact.compressed.length + 1, exact.offsets.central + 20);
  }), 'record-overlap-or-gap');
  assertZipBlocked(mutateArchive(exact.archive, (bytes) => {
    bytes.writeUInt32LE(exact.compressed.length - 1, 18);
    bytes.writeUInt32LE(exact.compressed.length - 1, exact.offsets.central + 20);
  }), 'record-overlap-or-gap');
  assertZipBlocked(mutateArchive(exact.archive, (bytes) => {
    bytes.writeUInt32LE(0, 14);
    bytes.writeUInt32LE(0, exact.offsets.central + 16);
  }), 'crc32');
  assertZipBlocked(mutateArchive(exact.archive, (bytes) => {
    bytes[exact.offsets.data] ^= 0xff;
  }));

  const stored = singleEntryZip({ method: 0 });
  assertZipBlocked(mutateArchive(stored.archive, (bytes) => {
    bytes.writeUInt32LE(stored.plain.length + 1, 22);
    bytes.writeUInt32LE(stored.plain.length + 1, stored.offsets.central + 24);
  }), 'stored-size');

  const oversized = singleEntryZip({ payload: Buffer.alloc(PERSONAL_REPOSITORY_ARTIFACT_PAYLOAD_MAX_BYTES + 1, 65) });
  assertZipBlocked(oversized.archive, 'payload-size');
});

test('in-process artifact ZIP failures remain credential-free and consume no process environment', () => {
  const secret = 'token-must-not-escape';
  const credentialNamed = singleEntryZip({ fileName: secret });
  assertZipBlocked(credentialNamed.archive, 'filename-mismatch');
  assert.doesNotMatch(extractPersonalRepositoryArtifactZip.toString(), /process\.env|child_process|spawn|unzip/i);
});

test('artifact archive transport accepts one exact GitHub-to-Azure redirect and builds a credential-free request', () => {
  const apiRequest = buildPersonalRepositoryArtifactApiRequest({
    path: ARTIFACT_API_PATH,
    repository: 'Cheekyfellastef/stephan-os',
  });
  assert.equal(apiRequest.valid, true);
  assert.deepEqual(apiRequest.request, {
    url: ARTIFACT_API_URL,
    method: 'GET',
    body: null,
    redirect: 'manual',
    headers: { Accept: 'application/vnd.github+json' },
  });
  assert.deepEqual(Object.keys(apiRequest.request.headers), ['Accept']);
  assert.doesNotMatch(JSON.stringify(apiRequest.request), /authorization|bearer|token|credential|secret/i);

  const redirect = validatePersonalRepositoryArtifactArchiveRedirect({
    path: ARTIFACT_API_PATH,
    repository: 'Cheekyfellastef/stephan-os',
    response: artifactRedirectResponse(),
  });
  assert.equal(redirect.valid, true);
  assert.equal(redirect.location, ARTIFACT_ARCHIVE_URL);

  const download = buildPersonalRepositoryArtifactArchiveRequest(redirect.location);
  assert.equal(download.valid, true);
  assert.deepEqual(download.request, {
    url: ARTIFACT_ARCHIVE_URL,
    method: 'GET',
    body: null,
    redirect: 'manual',
    headers: { Accept: 'application/zip' },
  });
  assert.deepEqual(Object.keys(download.request.headers), ['Accept']);
  assert.doesNotMatch(JSON.stringify(download.request), /authorization|bearer|token|credential|secret/i);

  const archive = validatePersonalRepositoryArtifactArchiveResponse({
    expectedUrl: download.request.url,
    response: artifactArchiveResponse(),
    maxBytes: 256 * 1024,
  });
  assert.equal(archive.valid, true);
  assert.equal(archive.contentLength, 1101);
});

test('shared artifact transport executes one authenticated API hop and one credential-free archive hop', async () => {
  const archiveBytes = Buffer.from('bounded-archive');
  const observed = [];
  const result = await executePersonalRepositoryArtifactArchiveTransport({
    path: ARTIFACT_API_PATH,
    repository: 'Cheekyfellastef/stephan-os',
    maxBytes: 256 * 1024,
    requestApiRedirect: async (request) => {
      observed.push({ stage: 'api', request });
      return artifactRedirectResponse();
    },
    requestArchive: async (request) => {
      observed.push({ stage: 'archive', request });
      let delivered = false;
      return artifactArchiveResponse({
        headers: headers({
          'content-type': 'application/zip',
          'content-length': String(archiveBytes.length),
        }),
        body: {
          getReader: () => ({
            read: async () => {
              if (delivered) return { done: true };
              delivered = true;
              return { done: false, value: archiveBytes };
            },
            cancel: async () => {},
            releaseLock: () => {},
          }),
        },
      });
    },
    delay: async () => {},
  });
  assert.deepEqual(result, archiveBytes);
  assert.deepEqual(observed.map(({ stage }) => stage), ['api', 'archive']);
  assert.deepEqual(observed[0].request, {
    url: ARTIFACT_API_URL,
    method: 'GET',
    body: null,
    redirect: 'manual',
    headers: { Accept: 'application/vnd.github+json' },
  });
  assert.deepEqual(observed[1].request, {
    url: ARTIFACT_ARCHIVE_URL,
    method: 'GET',
    body: null,
    redirect: 'manual',
    headers: { Accept: 'application/zip' },
  });
  assert.doesNotMatch(JSON.stringify(observed[1].request), /authorization|bearer|token|credential|secret/i);
});

test('shared artifact transport rejects widened identity, redirect, response and body proofs without a second hop', async () => {
  for (const mutation of [
    { repository: 'Other/stephan-os' },
    { response: artifactRedirectResponse({ status: 415 }) },
    { response: artifactRedirectResponse({ headers: headers({ location: `${ARTIFACT_ARCHIVE_URL}&sig=repeated` }) }) },
  ]) {
    let archiveRequests = 0;
    await assert.rejects(
      executePersonalRepositoryArtifactArchiveTransport({
        path: ARTIFACT_API_PATH,
        repository: 'Cheekyfellastef/stephan-os',
        maxBytes: 256 * 1024,
        requestApiRedirect: async () => mutation.response || artifactRedirectResponse(),
        requestArchive: async () => {
          archiveRequests += 1;
          return artifactArchiveResponse();
        },
        delay: async () => {},
        ...mutation,
      }),
      (error) => error.code === 'PERSONAL_REPOSITORY_READ_POLICY_VIOLATION',
    );
    assert.equal(archiveRequests, 0);
  }

  const bytes = Buffer.from('short');
  await assert.rejects(
    executePersonalRepositoryArtifactArchiveTransport({
      path: ARTIFACT_API_PATH,
      repository: 'Cheekyfellastef/stephan-os',
      maxBytes: 256 * 1024,
      requestApiRedirect: async () => artifactRedirectResponse(),
      requestArchive: async () => artifactArchiveResponse({
        headers: headers({ 'content-type': 'application/zip', 'content-length': '6' }),
        body: {
          getReader: () => {
            let delivered = false;
            return {
              read: async () => {
                if (delivered) return { done: true };
                delivered = true;
                return { done: false, value: bytes };
              },
              cancel: async () => {},
              releaseLock: () => {},
            };
          },
        },
      }),
      delay: async () => {},
    }),
    (error) => error.code === 'PERSONAL_REPOSITORY_READ_POLICY_VIOLATION'
      && error.blockers.includes('personal-repository-artifact-archive-body-length-mismatch'),
  );
});

test('artifact archive redirect rejects missing, malformed, repeated, widened, and credential-bearing locations', () => {
  const mutations = [
    '',
    'not-a-url',
    ARTIFACT_ARCHIVE_URL.replace('https://', 'http://'),
    ARTIFACT_ARCHIVE_URL.replace('https://', 'https://user:password@'),
    ARTIFACT_ARCHIVE_URL.replace('productionresultssa17.blob.core.windows.net', 'api.github.com'),
    ARTIFACT_ARCHIVE_URL.replace('productionresultssa17.blob.core.windows.net', 'attacker.blob.core.windows.net'),
    ARTIFACT_ARCHIVE_URL.replace('/actions-results/', '/other-results/'),
    `${ARTIFACT_ARCHIVE_URL}&sig=duplicate`,
    `${ARTIFACT_ARCHIVE_URL}&widened=true`,
    `${ARTIFACT_ARCHIVE_URL}#fragment`,
    ARTIFACT_ARCHIVE_URL.replace('spr=https', 'spr=http'),
    ARTIFACT_ARCHIVE_URL.replace('sp=r', 'sp=rw'),
    ARTIFACT_ARCHIVE_URL.replace('sr=b', 'sr=c'),
  ];
  for (const location of mutations) {
    const responseValue = artifactRedirectResponse({ headers: headers({ location }) });
    const verdict = validatePersonalRepositoryArtifactArchiveRedirect({
      path: ARTIFACT_API_PATH,
      repository: 'Cheekyfellastef/stephan-os',
      response: responseValue,
    });
    assert.equal(verdict.valid, false, location || 'missing location');
    assert.equal(buildPersonalRepositoryArtifactArchiveRequest(location).valid, false, location || 'missing location');
  }
});

test('artifact archive redirect binds repository, API response identity, and one manual hop', () => {
  for (const input of [
    { repository: 'Other/stephan-os' },
    { path: '/repos/Cheekyfellastef/stephan-os/actions/artifacts/0/zip' },
    { response: artifactRedirectResponse({ status: 200 }) },
    { response: artifactRedirectResponse({ status: 415, headers: headers({ 'content-type': 'application/json' }) }) },
    { response: artifactRedirectResponse({ redirected: true }) },
    { response: artifactRedirectResponse({ url: 'https://api.github.com/repos/Other/stephan-os/actions/artifacts/9140818868/zip' }) },
  ]) {
    const verdict = validatePersonalRepositoryArtifactArchiveRedirect({
      path: ARTIFACT_API_PATH,
      repository: 'Cheekyfellastef/stephan-os',
      response: artifactRedirectResponse(),
      ...input,
    });
    assert.equal(verdict.valid, false);
    assert.equal(verdict.location, '');
  }
});

test('artifact archive response rejects every further redirect and malformed binary proof before consumption', async () => {
  const responses = [
    artifactArchiveResponse({ status: 302, headers: headers({ location: ARTIFACT_ARCHIVE_URL }) }),
    artifactArchiveResponse({ redirected: true }),
    artifactArchiveResponse({ url: ARTIFACT_ARCHIVE_URL.replace('sig=signed', 'sig=changed') }),
    artifactArchiveResponse({ headers: headers({ 'content-type': 'application/json', 'content-length': '1101' }) }),
    artifactArchiveResponse({ headers: headers({ 'content-type': 'application/zip' }) }),
    artifactArchiveResponse({ headers: headers({ 'content-type': 'application/zip', 'content-length': String(256 * 1024 + 1) }) }),
  ];
  for (const responseValue of responses) {
    let consumed = false;
    await assert.rejects(
      executeBoundedPersonalRepositoryRead({
        path: `${ARTIFACT_API_PATH}#credential-free-archive-download`,
        request: async () => responseValue,
        validateResponse: (boundedResponse) => validatePersonalRepositoryArtifactArchiveResponse({
          expectedUrl: ARTIFACT_ARCHIVE_URL,
          response: boundedResponse,
          maxBytes: 256 * 1024,
        }),
        consume: async () => {
          consumed = true;
          return Buffer.alloc(0);
        },
        delay: async () => assert.fail('policy violations must not be retried'),
      }),
      (error) => error.code === 'PERSONAL_REPOSITORY_READ_POLICY_VIOLATION',
    );
    assert.equal(consumed, false);
  }
});

test('artifact archive body reader bounds streamed bytes independently of declared length', async () => {
  let cancelled = 0;
  let released = 0;
  const chunks = [Buffer.alloc(4, 1), Buffer.alloc(5, 2)];
  const exact = await readBoundedPersonalRepositoryResponseBody({
    body: {
      getReader: () => ({
        read: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true }),
        cancel: async () => { cancelled += 1; },
        releaseLock: () => { released += 1; },
      }),
    },
  }, 9);
  assert.equal(exact.length, 9);
  assert.equal(cancelled, 0);
  assert.equal(released, 1);

  let overrunCancelled = 0;
  await assert.rejects(
    readBoundedPersonalRepositoryResponseBody({
      body: {
        getReader: () => ({
          read: async () => ({ done: false, value: Buffer.alloc(10, 3) }),
          cancel: async () => { overrunCancelled += 1; },
          releaseLock: () => {},
        }),
      },
    }, 9),
    (error) => error.code === 'PERSONAL_REPOSITORY_READ_POLICY_VIOLATION'
      && error.blockers.includes('personal-repository-artifact-archive-body-size-exceeded'),
  );
  assert.equal(overrunCancelled, 1);
});

test('artifact archive body reader rejects empty, malformed and unavailable streams without throwing secrets', async () => {
  for (const responseValue of [
    {},
    { body: { getReader: () => ({ read: async () => ({ done: true }), releaseLock: () => {} }) } },
    { body: { getReader: () => ({ read: async () => ({ done: false, value: 'not-bytes' }), cancel: async () => {}, releaseLock: () => {} }) } },
  ]) {
    await assert.rejects(
      readBoundedPersonalRepositoryResponseBody(responseValue, 9),
      (error) => {
        assert.equal(error.code, 'PERSONAL_REPOSITORY_READ_POLICY_VIOLATION');
        assert.doesNotMatch(error.message, /token|authorization|bearer|secret/i);
        return true;
      },
    );
  }
});

test('artifact archive transport retries genuine transient reads before applying terminal response policy', async () => {
  const statuses = [503, 502, 200];
  let validations = 0;
  const result = await executeBoundedPersonalRepositoryRead({
    path: `${ARTIFACT_API_PATH}#credential-free-archive-download`,
    request: async () => artifactArchiveResponse({ status: statuses.shift() }),
    validateResponse: (boundedResponse) => {
      validations += 1;
      return validatePersonalRepositoryArtifactArchiveResponse({
        expectedUrl: ARTIFACT_ARCHIVE_URL,
        response: boundedResponse,
        maxBytes: 256 * 1024,
      });
    },
    delay: async () => {},
  });
  assert.equal(result.attempts, 3);
  assert.equal(validations, 1);
});

test('bounded personal-repository reads recover from transient transport failures', async () => {
  let attempts = 0;
  const delays = [];
  const result = await executeBoundedPersonalRepositoryRead({
    path: '/repos/Cheekyfellastef/stephan-os',
    request: async () => {
      attempts += 1;
      if (attempts < PERSONAL_REPOSITORY_READ_MAX_ATTEMPTS) {
        const error = new TypeError('fetch failed: bearer secret-must-not-escape');
        error.cause = { code: attempts === 1 ? 'EAI_AGAIN' : 'ECONNRESET' };
        throw error;
      }
      return response(200);
    },
    delay: async (milliseconds) => delays.push(milliseconds),
  });
  assert.equal(attempts, 3);
  assert.equal(result.attempts, 3);
  assert.equal(result.response.status, 200);
  assert.deepEqual(delays, [250, 1_000]);
});

test('bounded personal-repository reads retry only transient gateway responses', async () => {
  const statuses = [503, 200];
  const result = await executeBoundedPersonalRepositoryRead({
    path: '/repos/Cheekyfellastef/stephan-os/git/ref/heads/main',
    request: async () => response(statuses.shift()),
    delay: async () => {},
  });
  assert.equal(result.attempts, 2);
  assert.equal(result.response.status, 200);

  let forbiddenAttempts = 0;
  const forbidden = await executeBoundedPersonalRepositoryRead({
    path: '/repos/Cheekyfellastef/stephan-os',
    request: async () => {
      forbiddenAttempts += 1;
      return response(403);
    },
    delay: async () => assert.fail('403 responses must not be retried'),
  });
  assert.equal(forbiddenAttempts, 1);
  assert.equal(forbidden.response.status, 403);
});

test('bounded personal-repository reads retry transport failures while consuming the response body', async () => {
  let requests = 0;
  let consumptions = 0;
  const result = await executeBoundedPersonalRepositoryRead({
    path: '/repos/Cheekyfellastef/stephan-os/pulls/1762',
    request: async () => {
      requests += 1;
      return response(200);
    },
    consume: async () => {
      consumptions += 1;
      if (consumptions === 1) {
        const error = new TypeError('terminated while reading Authorization: Bearer secret-value');
        error.cause = { code: 'UND_ERR_SOCKET' };
        throw error;
      }
      return Buffer.from('{"state":"open"}');
    },
    delay: async () => {},
  });
  assert.equal(requests, 2);
  assert.equal(consumptions, 2);
  assert.equal(result.attempts, 2);
  assert.equal(result.result.toString('utf8'), '{"state":"open"}');
});

test('body-consumption exhaustion emits the same bounded secret-free transport proof', async () => {
  await assert.rejects(
    executeBoundedPersonalRepositoryRead({
      path: '/repos/Cheekyfellastef/stephan-os/actions/runs/31562891459/artifacts',
      request: async () => response(200),
      consume: async () => {
        const error = new TypeError('body failed with bearer secret-value');
        error.cause = { code: 'UND_ERR_SOCKET' };
        throw error;
      },
      delay: async () => {},
    }),
    (error) => {
      assert.equal(error.code, 'PERSONAL_REPOSITORY_READ_TRANSPORT_EXHAUSTED');
      assert.equal(error.attempts, PERSONAL_REPOSITORY_READ_MAX_ATTEMPTS);
      assert.equal(error.transportCode, 'UND_ERR_SOCKET');
      assert.doesNotMatch(error.message, /secret-value|bearer/i);
      return true;
    },
  );
});

test('bounded personal-repository reads exhaust with endpoint-specific secret-free proof', async () => {
  let attempts = 0;
  await assert.rejects(
    executeBoundedPersonalRepositoryRead({
      path: '/repos/Cheekyfellastef/stephan-os/actions/runs/31562891459',
      request: async () => {
        attempts += 1;
        const error = new TypeError('fetch failed with Authorization: Bearer secret-value');
        error.cause = { code: 'ECONNRESET' };
        throw error;
      },
      delay: async () => {},
    }),
    (error) => {
      assert.equal(error.code, 'PERSONAL_REPOSITORY_READ_TRANSPORT_EXHAUSTED');
      assert.equal(error.endpoint, '/repos/Cheekyfellastef/stephan-os/actions/runs/31562891459');
      assert.equal(error.attempts, PERSONAL_REPOSITORY_READ_MAX_ATTEMPTS);
      assert.equal(error.transportCode, 'ECONNRESET');
      assert.doesNotMatch(error.message, /secret-value|Authorization|Bearer/);
      return true;
    },
  );
  assert.equal(attempts, PERSONAL_REPOSITORY_READ_MAX_ATTEMPTS);
});

test('personal-repository mutations and body-bearing requests are never retried', async () => {
  for (const requestShape of [
    { method: 'PUT', body: { merge_method: 'squash' } },
    { method: 'POST', body: { body: 'completion' } },
    { method: 'GET', body: { widened: true } },
  ]) {
    let attempts = 0;
    await assert.rejects(
      executeBoundedPersonalRepositoryRead({
        path: '/repos/Cheekyfellastef/stephan-os/pulls/1762/merge',
        ...requestShape,
        request: async () => {
          attempts += 1;
          throw new TypeError('fetch failed');
        },
        delay: async () => assert.fail('mutating or body-bearing requests must not be delayed'),
      }),
      /fetch failed/,
    );
    assert.equal(attempts, 1);
  }
});

test('configuration-proof responses reject same-origin and cross-origin redirects without consumption', async () => {
  const path = '/repos/Cheekyfellastef/stephan-os';
  for (const url of [
    'https://api.github.com/repositories/1179385578',
    'https://example.invalid/repos/Cheekyfellastef/stephan-os',
  ]) {
    let cancellations = 0;
    let consumptions = 0;
    await assert.rejects(
      executeBoundedPersonalRepositoryRead({
        path,
        request: async () => ({
          status: 200,
          redirected: true,
          url,
          body: { cancel: async () => { cancellations += 1; } },
        }),
        validateResponse: (redirectedResponse) => validatePersonalRepositoryRulesetProofResponse({
          path,
          response: redirectedResponse,
        }),
        consume: async () => {
          consumptions += 1;
          return Buffer.from('{}');
        },
        delay: async () => assert.fail('policy violations must not be retried'),
      }),
      (error) => {
        assert.equal(error.code, 'PERSONAL_REPOSITORY_READ_POLICY_VIOLATION');
        assert.ok(error.blockers.includes('personal-repository-ruleset-proof-response-redirected'));
        return true;
      },
    );
    assert.equal(cancellations, 1);
    assert.equal(consumptions, 0);
  }
});

test('configuration-proof responses require the exact requested API URL even if redirect reporting is false', async () => {
  const path = '/repos/Cheekyfellastef/stephan-os/rulesets/20640195?includes_parents=true';
  const exact = validatePersonalRepositoryRulesetProofResponse({
    path,
    response: { redirected: false, url: `https://api.github.com${path}` },
  });
  assert.equal(exact.valid, true);

  const mismatch = validatePersonalRepositoryRulesetProofResponse({
    path,
    response: {
      redirected: false,
      url: 'https://api.github.com/repos/Cheekyfellastef/stephan-os/rulesets/20640196?includes_parents=true',
    },
  });
  assert.equal(mismatch.valid, false);
  assert.ok(mismatch.blockers.includes('personal-repository-ruleset-proof-response-url-mismatch'));
});

const repository = 'Cheekyfellastef/stephan-os';
const prNumber = 1739;
const branch = 'agent/watchdog-acceptance-pid-binding-v1';
const sourceHead = 'a'.repeat(40);
const sourceTree = 'b'.repeat(40);
const baseSha = 'c'.repeat(40);
const runId = 31390000001;
const runAttempt = 1;
const integrationId = 15368;
const review = Object.freeze({
  workflowRunId: 31376952437,
  workflowRunAttempt: 1,
  artifactId: 9058301333,
  artifactDigest: `sha256:${'d'.repeat(64)}`,
  payloadSha256: 'e'.repeat(64),
});
const dispatchWorkflowId = 7199;
const dispatchTitle = `Protected operator merge ${sourceHead}`;

function dispatchWorkflowDefinition(overrides = {}) {
  return {
    id: dispatchWorkflowId,
    name: PERSONAL_REPOSITORY_WORKFLOW_NAME,
    path: PERSONAL_REPOSITORY_WORKFLOW_PATH,
    state: 'active',
    ...overrides,
  };
}

function dispatchRun(overrides = {}) {
  return {
    id: runId,
    run_attempt: runAttempt,
    workflow_id: dispatchWorkflowId,
    name: dispatchTitle,
    display_title: dispatchTitle,
    event: 'workflow_dispatch',
    repository: { full_name: repository },
    head_sha: baseSha,
    head_branch: 'main',
    path: `${repository}/${PERSONAL_REPOSITORY_WORKFLOW_PATH}@refs/heads/main`,
    triggering_actor: { login: 'Cheekyfellastef' },
    status: 'in_progress',
    ...overrides,
  };
}

function dispatchExecutionInput(overrides = {}) {
  return {
    definitions: [dispatchWorkflowDefinition()],
    run: dispatchRun(),
    priorRuns: [dispatchRun()],
    ...overrides,
  };
}

function priorFailureJobs(overrides = {}, attempts = 1, parentRunId = runId + 10) {
  const jobs = Array.from({ length: attempts }, (_, index) => {
    const attempt = index + 1;
    return [
      [(attempt * 100) + 1, PERSONAL_REPOSITORY_EVIDENCE_JOB, 'failure'],
      [(attempt * 100) + 2, PERSONAL_REPOSITORY_APPROVAL_JOB, 'skipped'],
      [(attempt * 100) + 3, PERSONAL_REPOSITORY_MERGE_JOB, 'skipped'],
    ].map(([id, name, conclusion]) => ({
      id,
      run_id: parentRunId,
      run_attempt: attempt,
      workflow_name: dispatchTitle,
      head_branch: 'main',
      head_sha: baseSha,
      url: `https://api.github.com/repos/${repository}/actions/jobs/${id}`,
      run_url: `https://api.github.com/repos/${repository}/actions/runs/${parentRunId}`,
      check_run_url: `https://api.github.com/repos/${repository}/check-runs/${id}`,
      html_url: `https://github.com/${repository}/actions/runs/${parentRunId}/job/${id}`,
      name,
      status: 'completed',
      conclusion,
    }));
  }).flat();
  for (const [name, mutation] of Object.entries(overrides)) {
    for (const [index, job] of jobs.entries()) {
      if (job.name === name) jobs[index] = { ...job, ...mutation };
    }
  }
  return jobs;
}

function normalizedPriorFailureJobs(attempts = 1, parentRunId = runId + 10) {
  return priorFailureJobs({}, attempts, parentRunId).map((job) => ({
    id: job.id,
    runId: job.run_id,
    runAttempt: job.run_attempt,
    workflowName: job.workflow_name,
    headBranch: job.head_branch,
    headSha: job.head_sha,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    url: job.url,
    runUrl: job.run_url,
    checkRunUrl: job.check_run_url,
    htmlUrl: job.html_url,
  }));
}

const expectedDispatchExecution = Object.freeze({
  repository,
  sourceHead,
  baseSha,
  workflowRunId: runId,
  workflowRunAttempt: runAttempt,
});

function dispatchInputs(overrides = {}) {
  return {
    mode: PERSONAL_REPOSITORY_MODE,
    pr_number: String(prNumber),
    expected_branch: branch,
    expected_head: sourceHead,
    expected_head_tree: sourceTree,
    expected_base: baseSha,
    independent_review_run_id: String(review.workflowRunId),
    independent_review_run_attempt: String(review.workflowRunAttempt),
    independent_review_artifact_id: String(review.artifactId),
    independent_review_artifact_digest: review.artifactDigest,
    independent_review_payload_sha256: review.payloadSha256,
    ...overrides,
  };
}

function workflowDefinitions() {
  return PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS.map((required, index) => ({
    id: 7100 + index,
    name: required.name,
    path: required.path,
    state: 'active',
  }));
}

function workflowRuns() {
  return PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS.map((required, index) => ({
    id: 9100 + index,
    run_number: 100 + index,
    run_attempt: 1,
    workflow_id: 7100 + index,
    name: required.name,
    path: `${repository}/${required.path}@refs/heads/${branch}`,
    event: required.event,
    repository: { full_name: repository },
    head_sha: sourceHead,
    status: 'completed',
    conclusion: 'success',
    check_suite_id: 8100 + index,
    pull_requests: [{
      number: prNumber,
      head: { sha: sourceHead, ref: branch },
      base: { sha: baseSha, ref: 'main' },
    }],
  }));
}

function escalationWorkflowRun(overrides = {}) {
  return {
    id: 9199,
    run_number: 199,
    run_attempt: 1,
    workflow_id: 7199,
    check_suite_id: 8199,
    name: 'Stephanos Exact-Head Review',
    path: `${repository}/.github/workflows/stephanos-exact-head-review.yml@refs/heads/main`,
    event: 'pull_request_target',
    repository: { full_name: repository },
    head_sha: sourceHead,
    status: 'completed',
    conclusion: 'failure',
    pull_requests: [{
      number: prNumber,
      head: { sha: sourceHead, ref: branch },
      base: { sha: baseSha, ref: 'main' },
    }],
    ...overrides,
  };
}

function checkRun(run, overrides = {}) {
  const id = overrides.id || (run.check_suite_id + 1000);
  return {
    id,
    name: 'exact-head-review',
    head_sha: sourceHead,
    status: 'completed',
    conclusion: 'failure',
    details_url: `https://github.com/${repository}/actions/runs/${run.id}/job/${id}`,
    app: { id: 15368, slug: 'github-actions' },
    check_suite: { id: run.check_suite_id },
    ...overrides,
  };
}

function evidenceInput(overrides = {}) {
  return {
    repository,
    repositoryOwnerType: 'User',
    eventName: 'workflow_dispatch',
    triggeringActor: 'Cheekyfellastef',
    workflowRunId: runId,
    workflowRunAttempt: runAttempt,
    pullRequest: {
      number: prNumber,
      state: 'open',
      draft: false,
      head: { sha: sourceHead, ref: branch },
      base: { sha: baseSha, ref: 'main' },
    },
    liveMainRef: { object: { sha: baseSha } },
    headCommit: { sha: sourceHead, tree: { sha: sourceTree } },
    reviewDecision: null,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    unresolvedThreadCount: 0,
    comparison: {
      status: 'ahead',
      ahead_by: 1,
      behind_by: 0,
      base_commit: { sha: baseSha },
      merge_base_commit: { sha: baseSha },
    },
    ...overrides,
  };
}

function environment() {
  return {
    name: 'operator-merge-approval',
    can_admins_bypass: false,
    deployment_branch_policy: {
      protected_branches: true,
      custom_branch_policies: false,
    },
    protection_rules: [{
      type: 'required_reviewers',
      prevent_self_review: false,
      reviewers: [{ type: 'User', reviewer: { login: 'Cheekyfellastef' } }],
    }],
  };
}

function activeRules() {
  return [
    { type: 'deletion', ruleset_id: 91 },
    { type: 'non_fast_forward', ruleset_id: 91 },
    {
      type: 'pull_request',
      ruleset_id: 91,
      parameters: {
        required_approving_review_count: 0,
        required_review_thread_resolution: true,
        dismiss_stale_reviews_on_push: true,
        require_last_push_approval: false,
        require_code_owner_review: false,
      },
    },
    {
      type: 'required_status_checks',
      ruleset_id: 91,
      parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: [{
          context: PERSONAL_REPOSITORY_REQUIRED_CHECK,
          integration_id: integrationId,
        }],
      },
    },
  ];
}

function configuration(overrides = {}) {
  return {
    repository: {
      owner: { type: 'User' },
      private: false,
      visibility: 'public',
      default_branch: 'main',
      allow_squash_merge: true,
      delete_branch_on_merge: false,
    },
    environment: environment(),
    activeRules: activeRules(),
    rulesets: [{
      id: 91,
      enforcement: 'active',
      updated_at: '2026-08-10T12:00:00Z',
      bypass_actors: [],
    }],
    ...overrides,
  };
}

const expectedEvidence = Object.freeze({
  repository,
  prNumber,
  branch,
  sourceHead,
  sourceTree,
  baseSha,
  workflowRunId: runId,
  workflowRunAttempt: runAttempt,
});

test('dispatch inputs require an exact positive identity and immutable review artifact', () => {
  assert.equal(parsePersonalRepositoryDispatchInputs(dispatchInputs()).valid, true);
  for (const [key, value, blocker] of [
    ['mode', 'other', 'personal-repository-mode-not-exact'],
    ['pr_number', '0', 'personal-repository-pr-invalid'],
    ['expected_head', 'abc', 'personal-repository-head-invalid'],
    ['expected_head_tree', 'abc', 'personal-repository-tree-invalid'],
    ['expected_base', 'abc', 'personal-repository-base-invalid'],
    ['independent_review_run_id', '-1', 'personal-repository-review-run-invalid'],
    ['independent_review_artifact_digest', 'sha256:nope', 'personal-repository-review-artifact-digest-invalid'],
    ['independent_review_payload_sha256', 'nope', 'personal-repository-review-payload-digest-invalid'],
  ]) {
    const result = parsePersonalRepositoryDispatchInputs(dispatchInputs({ [key]: value }));
    assert.ok(result.blockers.includes(blocker), `${key} should produce ${blocker}`);
  }
});

test('ruleset proof authority is GET-only and restricted to exact configuration surfaces', () => {
  for (const path of [
    '/repos/Cheekyfellastef/stephan-os',
    '/repos/Cheekyfellastef/stephan-os/rules/branches/main?per_page=100&page=1',
    '/repos/Cheekyfellastef/stephan-os/rules/branches/main?per_page=100&page=20',
    '/repos/Cheekyfellastef/stephan-os/rulesets/20640195?includes_parents=true',
  ]) {
    assert.equal(validatePersonalRepositoryRulesetProofRequest({ path, repository }).valid, true, path);
  }

  for (const input of [
    ...['POST', 'PUT', 'PATCH', 'DELETE'].map((method) => ({
      path: '/repos/Cheekyfellastef/stephan-os',
      method,
    })),
    { path: '/repos/Cheekyfellastef/stephan-os', body: {} },
    { path: '/graphql' },
    { path: '/repos/Cheekyfellastef/stephan-os/pulls/1762' },
    { path: '/repos/Cheekyfellastef/stephan-os/rules/branches/feature?per_page=100&page=1' },
    { path: '/repos/Cheekyfellastef/stephan-os/rules/branches/main?per_page=100&page=21' },
    { path: '/repos/Cheekyfellastef/stephan-os/rules/branches/main?page=1&per_page=100' },
    { path: '/repos/Cheekyfellastef/stephan-os/rulesets/20640195' },
    { path: '/repos/Cheekyfellastef/other', repository },
  ]) {
    const blocked = validatePersonalRepositoryRulesetProofRequest({ repository, ...input });
    assert.equal(blocked.valid, false, JSON.stringify(input));
    assert.ok(blocked.blockers.length > 0, JSON.stringify(input));
  }
});

test('dispatch workflow definition must be one exact static active definition', () => {
  const ready = validatePersonalRepositoryDispatchWorkflowDefinition([
    dispatchWorkflowDefinition(),
  ]);
  assert.equal(ready.valid, true);
  assert.deepEqual(ready.definition, dispatchWorkflowDefinition());

  for (const definitions of [
    null,
    [],
    [dispatchWorkflowDefinition({ name: 'Protected operator merge dynamic-title' })],
    [dispatchWorkflowDefinition({ path: '.github/workflows/lookalike.yml' })],
    [dispatchWorkflowDefinition({ state: 'disabled_manually' })],
    [dispatchWorkflowDefinition({ id: String(dispatchWorkflowId) })],
    [dispatchWorkflowDefinition(), dispatchWorkflowDefinition({ id: dispatchWorkflowId + 1 })],
  ]) {
    const blocked = validatePersonalRepositoryDispatchWorkflowDefinition(definitions);
    assert.equal(blocked.valid, false);
    assert.ok(blocked.blockers.length > 0);
  }
});

test('current protected dispatch binds every exact dynamic run identity field', () => {
  const ready = validatePersonalRepositoryDispatchExecution(
    dispatchExecutionInput(),
    expectedDispatchExecution,
  );
  assert.equal(ready.valid, true);
  assert.deepEqual(ready.currentMismatches, []);

  const mutations = [
    ['run-id', { id: runId + 1 }],
    ['run-attempt', { run_attempt: runAttempt + 1 }],
    ['workflow-id', { workflow_id: dispatchWorkflowId + 1 }],
    ['run-name', { name: 'Protected Operator Merge Queue Boundary' }],
    ['display-title', { display_title: `${dispatchTitle}-widened` }],
    ['event', { event: 'repository_dispatch' }],
    ['repository', { repository: { full_name: 'Cheekyfellastef/lookalike' } }],
    ['base-head', { head_sha: 'f'.repeat(40) }],
    ['base-branch', { head_branch: 'lookalike-main' }],
    ['workflow-path', { path: `${repository}/${PERSONAL_REPOSITORY_WORKFLOW_PATH}@feature` }],
    ['triggering-actor', { triggering_actor: { login: 'lookalike-operator' } }],
    ['run-status', { status: 'completed' }],
  ];
  for (const [field, mutation] of mutations) {
    const blocked = validatePersonalRepositoryDispatchExecution(
      dispatchExecutionInput({ run: dispatchRun(mutation) }),
      expectedDispatchExecution,
    );
    assert.equal(blocked.valid, false, field);
    assert.ok(blocked.currentMismatches.includes(field), field);
  }

  const widened = validatePersonalRepositoryDispatchExecution(
    dispatchExecutionInput({ run: [dispatchRun(), dispatchRun()] }),
    expectedDispatchExecution,
  );
  assert.equal(widened.valid, false);
  assert.ok(widened.currentMismatches.length > 0);
});

test('prior authority jobs bind one complete canonical parent-run envelope', () => {
  const parentRunId = runId + 10;
  const parent = dispatchRun({ id: parentRunId, status: 'completed', conclusion: 'failure' });
  const job = priorFailureJobs({}, 1, parentRunId)[0];
  const ready = validatePersonalRepositoryPriorJobEnvelope(parent, job);
  assert.equal(ready.valid, true);
  assert.deepEqual(ready.receipt, normalizedPriorFailureJobs(1, parentRunId)[0]);

  const mutations = [
    ['job-id', { id: 0 }],
    ['parent-run', { run_id: parentRunId + 1 }],
    ['attempt', { run_attempt: 2 }],
    ['workflow', { workflow_name: `${dispatchTitle}-lookalike` }],
    ['branch', { head_branch: 'lookalike-main' }],
    ['head', { head_sha: 'f'.repeat(40) }],
    ['job-url', { url: `${job.url}-lookalike` }],
    ['run-url', { run_url: `${job.run_url}-lookalike` }],
    ['check-url', { check_run_url: `${job.check_run_url}-lookalike` }],
    ['html-url', { html_url: `${job.html_url}-lookalike` }],
  ];
  for (const [name, mutation] of mutations) {
    const blocked = validatePersonalRepositoryPriorJobEnvelope(parent, { ...job, ...mutation });
    assert.equal(blocked.valid, false, name);
    assert.ok(blocked.blockers.length > 0, name);
    assert.equal(blocked.receipt, null, name);
  }
});

test('same-base prior protected dispatch remains a replay without exact read-only job proof', () => {
  const priorRunId = runId + 10;
  const blocked = validatePersonalRepositoryDispatchExecution(
    dispatchExecutionInput({
      priorRuns: [
        dispatchRun(),
        dispatchRun({
          id: priorRunId,
          status: 'completed',
          conclusion: 'failure',
        }),
      ],
    }),
    expectedDispatchExecution,
  );
  assert.equal(blocked.valid, false);
  assert.deepEqual(blocked.replayRunIds, [priorRunId]);
  assert.ok(blocked.blockers.includes('personal-repository-prior-attempt-exists'));
});

test('same-base failed dispatch is retryable only when evidence failed and both later authority jobs were skipped', () => {
  for (const priorRunAttempt of [1, 2]) {
    const priorRunId = runId + 10;
    const priorRun = dispatchRun({
      id: priorRunId,
      run_attempt: priorRunAttempt,
      status: 'completed',
      conclusion: 'failure',
    });
    const jobs = priorFailureJobs({}, priorRunAttempt);
    const retryProof = validatePersonalRepositoryReadOnlyPriorFailure(priorRun, jobs);
    assert.equal(retryProof.valid, true);
    assert.equal(retryProof.finalVerdict, 'PERSONAL_REPOSITORY_PRIOR_FAILURE_READ_ONLY');

    const ready = validatePersonalRepositoryDispatchExecution(
      dispatchExecutionInput({
        priorRuns: [dispatchRun(), priorRun],
        priorRunJobSets: [{ runId: priorRunId, jobs }],
      }),
      expectedDispatchExecution,
    );
    assert.equal(ready.valid, true);
    assert.deepEqual(ready.replayRunIds, []);
    assert.deepEqual(ready.retryablePriorRunIds, [priorRunId]);
    assert.deepEqual(ready.retryablePriorFailures, [{
      runId: priorRunId,
      runAttempt: priorRunAttempt,
      status: 'completed',
      conclusion: 'failure',
      jobs: normalizedPriorFailureJobs(priorRunAttempt),
    }]);
  }
});

test('multi-attempt prior dispatch requires read-only proof for every attempt, not only the latest jobs', () => {
  const priorRunId = runId + 10;
  const priorRun = dispatchRun({
    id: priorRunId,
    run_attempt: 2,
    status: 'completed',
    conclusion: 'failure',
  });
  const latestOnly = priorFailureJobs({}, 2).filter((job) => job.run_attempt === 2);
  const earlierMergeStarted = priorFailureJobs({}, 2).map((job) => (
    job.run_attempt === 1 && job.name === PERSONAL_REPOSITORY_MERGE_JOB
      ? { ...job, conclusion: 'failure' }
      : job
  ));
  for (const jobs of [latestOnly, earlierMergeStarted]) {
    const blocked = validatePersonalRepositoryDispatchExecution(
      dispatchExecutionInput({
        priorRuns: [dispatchRun(), priorRun],
        priorRunJobSets: [{ runId: priorRunId, jobs }],
      }),
      expectedDispatchExecution,
    );
    assert.equal(blocked.valid, false, JSON.stringify(jobs));
    assert.deepEqual(blocked.replayRunIds, [priorRunId], JSON.stringify(jobs));
    assert.deepEqual(blocked.retryablePriorFailures, [], JSON.stringify(jobs));
  }
});

test('prior dispatch retry proof fails closed if the approval or merge job was not skipped', () => {
  const priorRunId = runId + 10;
  const priorRun = dispatchRun({ id: priorRunId, status: 'completed', conclusion: 'failure' });
  const hostileJobSets = [
    priorFailureJobs({ [PERSONAL_REPOSITORY_EVIDENCE_JOB]: { conclusion: 'success' } }),
    priorFailureJobs({ [PERSONAL_REPOSITORY_APPROVAL_JOB]: { conclusion: 'success' } }),
    priorFailureJobs({ [PERSONAL_REPOSITORY_MERGE_JOB]: { conclusion: 'failure' } }),
    priorFailureJobs({ [PERSONAL_REPOSITORY_MERGE_JOB]: { status: 'in_progress', conclusion: null } }),
    priorFailureJobs().filter((job) => job.name !== PERSONAL_REPOSITORY_MERGE_JOB),
    [...priorFailureJobs(), { id: 104, name: PERSONAL_REPOSITORY_MERGE_JOB, status: 'completed', conclusion: 'skipped' }],
    priorFailureJobs({ [PERSONAL_REPOSITORY_MERGE_JOB]: { id: 0 } }),
    priorFailureJobs({ [PERSONAL_REPOSITORY_MERGE_JOB]: { id: 102 } }),
  ];
  for (const jobs of hostileJobSets) {
    const blocked = validatePersonalRepositoryDispatchExecution(
      dispatchExecutionInput({
        priorRuns: [dispatchRun(), priorRun],
        priorRunJobSets: [{ runId: priorRunId, jobs }],
      }),
      expectedDispatchExecution,
    );
    assert.equal(blocked.valid, false, JSON.stringify(jobs));
    assert.deepEqual(blocked.replayRunIds, [priorRunId], JSON.stringify(jobs));
    assert.deepEqual(blocked.retryablePriorRunIds, [], JSON.stringify(jobs));
  }

  for (const runMutation of [
    { status: 'in_progress', conclusion: null },
    { status: 'completed', conclusion: 'cancelled' },
    { status: 'completed', conclusion: 'success' },
  ]) {
    const mutatedRun = dispatchRun({ id: priorRunId, ...runMutation });
    const blocked = validatePersonalRepositoryDispatchExecution(
      dispatchExecutionInput({
        priorRuns: [dispatchRun(), mutatedRun],
        priorRunJobSets: [{ runId: priorRunId, jobs: priorFailureJobs() }],
      }),
      expectedDispatchExecution,
    );
    assert.equal(blocked.valid, false, JSON.stringify(runMutation));
    assert.deepEqual(blocked.replayRunIds, [priorRunId], JSON.stringify(runMutation));
  }

  const bounded = validatePersonalRepositoryDispatchExecution(
    dispatchExecutionInput({
      priorRunJobSets: Array.from({ length: PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX + 1 }, (_, index) => ({
        runId: runId + 100 + index,
        jobs: priorFailureJobs(),
      })),
    }),
    expectedDispatchExecution,
  );
  assert.equal(bounded.valid, false);
  assert.ok(bounded.blockers.includes('personal-repository-prior-run-jobs-limit-exceeded'));

  const duplicateProof = validatePersonalRepositoryDispatchExecution(
    dispatchExecutionInput({
      priorRuns: [dispatchRun(), priorRun],
      priorRunJobSets: [
        { runId: priorRunId, jobs: priorFailureJobs() },
        { runId: priorRunId, jobs: priorFailureJobs() },
      ],
    }),
    expectedDispatchExecution,
  );
  assert.equal(duplicateProof.valid, false);
  assert.deepEqual(duplicateProof.replayRunIds, [priorRunId]);

  const invalidContainer = validatePersonalRepositoryDispatchExecution(
    dispatchExecutionInput({ priorRunJobSets: {} }),
    expectedDispatchExecution,
  );
  assert.equal(invalidContainer.valid, false);
  assert.ok(invalidContainer.blockers.includes('personal-repository-prior-run-jobs-invalid'));

  const excessiveAttemptRun = dispatchRun({
    id: priorRunId,
    run_attempt: PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX + 1,
    status: 'completed',
    conclusion: 'failure',
  });
  assert.equal(validatePersonalRepositoryReadOnlyPriorFailure(
    excessiveAttemptRun,
    priorFailureJobs({}, PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX + 1),
  ).valid, false);
  const excessiveAttempt = validatePersonalRepositoryDispatchExecution(
    dispatchExecutionInput({
      priorRuns: [dispatchRun(), excessiveAttemptRun],
      priorRunJobSets: [{
        runId: priorRunId,
        jobs: priorFailureJobs({}, PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX + 1),
      }],
    }),
    expectedDispatchExecution,
  );
  assert.equal(excessiveAttempt.valid, false);
  assert.equal(excessiveAttempt.sameBasePriorAttemptCount, PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX + 1);
  assert.ok(excessiveAttempt.blockers.includes('personal-repository-prior-run-attempt-limit-exceeded'));

  const priorRun2 = dispatchRun({ id: priorRunId + 1, status: 'completed', conclusion: 'failure' });
  const duplicateJobEstate = validatePersonalRepositoryDispatchExecution(
    dispatchExecutionInput({
      priorRuns: [dispatchRun(), priorRun, priorRun2],
      priorRunJobSets: [
        { runId: priorRunId, jobs: priorFailureJobs() },
        { runId: priorRunId + 1, jobs: priorFailureJobs({}, 1, priorRunId + 1) },
      ],
    }),
    expectedDispatchExecution,
  );
  assert.equal(duplicateJobEstate.valid, false);
  assert.ok(duplicateJobEstate.blockers.includes('personal-repository-prior-run-proof-duplicate'));
  assert.deepEqual(duplicateJobEstate.retryablePriorFailures, []);
});

test('retried current workflow run is a replay even when GitHub retains or omits the run ID', () => {
  for (const [attempt, priorRuns] of [
    [2, [dispatchRun({ run_attempt: 2 })]],
    [3, []],
  ]) {
    const retriedRun = dispatchRun({ run_attempt: attempt });
    const blocked = validatePersonalRepositoryDispatchExecution(
      dispatchExecutionInput({ run: retriedRun, priorRuns }),
      {
        ...expectedDispatchExecution,
        workflowRunAttempt: attempt,
      },
    );
    assert.equal(blocked.valid, false, attempt);
    assert.deepEqual(blocked.currentMismatches, [], attempt);
    assert.deepEqual(blocked.replayRunIds, [runId], attempt);
    assert.ok(blocked.blockers.includes('personal-repository-prior-attempt-exists'), attempt);
  }
});

test('malformed retried current run fails closed without claiming an exact replay', () => {
  const blocked = validatePersonalRepositoryDispatchExecution(
    dispatchExecutionInput({
      run: dispatchRun({
        run_attempt: 2,
        triggering_actor: { login: 'lookalike-operator' },
      }),
      priorRuns: [],
    }),
    {
      ...expectedDispatchExecution,
      workflowRunAttempt: 2,
    },
  );
  assert.equal(blocked.valid, false);
  assert.deepEqual(blocked.currentMismatches, ['triggering-actor']);
  assert.deepEqual(blocked.replayRunIds, []);
  assert.ok(blocked.blockers.includes('personal-repository-workflow-run-identity-mismatch'));
});

test('different exact base is a fresh protected dispatch identity, not a replay', () => {
  const priorRunId = runId + 11;
  const ready = validatePersonalRepositoryDispatchExecution(
    dispatchExecutionInput({
      priorRuns: [
        dispatchRun(),
        dispatchRun({
          id: priorRunId,
          head_sha: 'f'.repeat(40),
          status: 'completed',
          conclusion: 'failure',
        }),
      ],
    }),
    expectedDispatchExecution,
  );
  assert.equal(ready.valid, true);
  assert.deepEqual(ready.replayRunIds, []);
  assert.deepEqual(ready.differentBasePriorRunIds, [priorRunId]);
});

test('malformed source-matching prior run blocks instead of evading replay proof', () => {
  const malformedCandidates = [
    (value) => { delete value.head_sha; },
    (value) => { delete value.triggering_actor; },
    (value) => { value.run_attempt = String(value.run_attempt); },
    (value) => { value.workflow_id += 1; },
    (value) => { value.name = PERSONAL_REPOSITORY_WORKFLOW_NAME; },
    (value) => { value.display_title = `${dispatchTitle}-widened`; },
    (value) => { value.event = 'repository_dispatch'; },
    (value) => { value.repository = { full_name: 'Cheekyfellastef/lookalike' }; },
    (value) => { value.head_branch = 'lookalike-main'; },
    (value) => { value.path = `${repository}/${PERSONAL_REPOSITORY_WORKFLOW_PATH}@feature`; },
  ];
  for (const [index, mutate] of malformedCandidates.entries()) {
    const priorRunId = runId + 20 + index;
    const malformed = dispatchRun({ id: priorRunId });
    mutate(malformed);
    const blocked = validatePersonalRepositoryDispatchExecution(
      dispatchExecutionInput({ priorRuns: [dispatchRun(), malformed] }),
      expectedDispatchExecution,
    );
    assert.equal(blocked.valid, false, index);
    assert.deepEqual(blocked.malformedPriorRunIds, [priorRunId], index);
    assert.ok(blocked.blockers.includes('personal-repository-prior-attempt-invalid'), index);
  }

  const invalidContainer = validatePersonalRepositoryDispatchExecution(
    dispatchExecutionInput({ priorRuns: {} }),
    expectedDispatchExecution,
  );
  assert.equal(invalidContainer.valid, false);
  assert.ok(invalidContainer.blockers.includes('personal-repository-prior-runs-invalid'));
});

test('wrong actor or source title cannot become an exact prior operator replay', () => {
  const ready = validatePersonalRepositoryDispatchExecution(
    dispatchExecutionInput({
      priorRuns: [
        dispatchRun(),
        dispatchRun({ id: runId + 13, triggering_actor: { login: 'lookalike-operator' } }),
        dispatchRun({
          id: runId + 14,
          name: `Protected operator merge ${'9'.repeat(40)}`,
          display_title: `Protected operator merge ${'9'.repeat(40)}`,
        }),
      ],
    }),
    expectedDispatchExecution,
  );
  assert.equal(ready.valid, true);
  assert.deepEqual(ready.replayRunIds, []);
  assert.deepEqual(ready.malformedPriorRunIds, []);
});

test('all seven universally applicable exact-head workflow identities must be active and successful', () => {
  assert.deepEqual(PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS.map((workflow) => workflow.name), [
    'OpenClaw GitHub Operator',
    'Protected Operator Merge Source Proof',
    'Exact-Head Review Dispatch',
    'PR Clean Guard',
    'Build Stephanos UI',
    'Battle Bridge Publisher Proof',
    'Codex Dispatch Queue Proof',
  ]);
  const ready = validatePersonalRepositoryWorkflowRuns(
    workflowDefinitions(),
    workflowRuns(),
    expectedEvidence,
  );
  assert.equal(ready.valid, true);
  assert.equal(ready.evidence.length, 7);

  const failed = workflowRuns();
  failed[3] = { ...failed[3], conclusion: 'failure' };
  const blocked = validatePersonalRepositoryWorkflowRuns(
    workflowDefinitions(),
    failed,
    expectedEvidence,
  );
  assert.ok(blocked.blockers.includes(
    `personal-repository-workflow-run-not-exact-green:${PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS[3].name}`,
  ));
});

test('workflow run hydration replaces permission-trimmed summaries only with exact individual identities', () => {
  const details = [...workflowRuns(), escalationWorkflowRun()];
  const summaries = details.map((run) => ({
    id: run.id,
    workflow_id: run.workflow_id,
    check_suite_id: run.check_suite_id,
    head_sha: run.head_sha,
    pull_requests: [],
  }));
  const hydrated = validatePersonalRepositoryWorkflowRunHydration(
    summaries,
    details,
    { sourceHead },
  );
  assert.equal(hydrated.valid, true);
  assert.deepEqual(hydrated.runs, details);
  assert.equal(hydrated.runs[0].pull_requests.length, 1);
});

test('workflow run hydration rejects omissions, substitutions, duplicates and stale heads', () => {
  const details = workflowRuns();
  const summaries = details.map((run) => ({
    id: run.id,
    workflow_id: run.workflow_id,
    check_suite_id: run.check_suite_id,
    head_sha: run.head_sha,
  }));
  const hostilePairs = [
    [summaries, details.slice(1)],
    [summaries, details.map((run, index) => index === 0 ? { ...run, workflow_id: run.workflow_id + 1 } : run)],
    [summaries, details.map((run, index) => index === 0 ? { ...run, check_suite_id: run.check_suite_id + 1 } : run)],
    [summaries, details.map((run, index) => index === 0 ? { ...run, head_sha: 'f'.repeat(40) } : run)],
    [[...summaries, summaries[0]], details],
    [summaries, [...details, details[0]]],
  ];
  for (const [candidateSummaries, candidateDetails] of hostilePairs) {
    const blocked = validatePersonalRepositoryWorkflowRunHydration(
      candidateSummaries,
      candidateDetails,
      { sourceHead },
    );
    assert.equal(blocked.valid, false);
    assert.deepEqual(blocked.runs, []);
    assert.ok(blocked.blockers.length > 0);
  }
});

test('personal repository evidence binds operator, PR, branch, head, tree and current base', () => {
  assert.equal(validatePersonalRepositoryEvidence(evidenceInput(), expectedEvidence).valid, true);
  for (const [overrides, blocker] of [
    [{ repositoryOwnerType: 'Organization' }, 'personal-repository-owner-not-user'],
    [{ triggeringActor: 'someone-else' }, 'personal-repository-triggering-actor-not-operator'],
    [{ liveMainRef: { object: { sha: 'f'.repeat(40) } } }, 'personal-repository-live-main-mismatch'],
    [{ unresolvedThreadCount: 1 }, 'personal-repository-conversations-not-resolved'],
    [{ comparison: { ...evidenceInput().comparison, behind_by: 1 } }, 'personal-repository-comparison-not-exact-forward'],
  ]) {
    assert.ok(validatePersonalRepositoryEvidence(evidenceInput(overrides), expectedEvidence).blockers.includes(blocker));
  }
  const drifted = validatePersonalRepositoryEvidence(evidenceInput(), {
    ...expectedEvidence,
    sourceHead: 'f'.repeat(40),
  });
  assert.ok(drifted.blockers.includes('personal-repository-expected-head-mismatch'));
});

test('only a proved clean independent review admits GitHub UNSTABLE review escalation', () => {
  const unstable = evidenceInput({ mergeStateStatus: 'UNSTABLE' });
  const unproved = validatePersonalRepositoryEvidence(unstable, expectedEvidence);
  assert.equal(unproved.valid, false);
  assert.ok(unproved.blockers.includes('personal-repository-pr-not-clean'));

  const proved = validatePersonalRepositoryEvidence(unstable, expectedEvidence, {
    cleanIndependentReviewProved: true,
    reviewEscalationChecksProved: true,
  });
  assert.equal(proved.valid, true);
  assert.equal(proved.identity.mergeStateStatus, 'UNSTABLE');
  assert.equal(proved.identity.reviewAdjudication, 'clean-independent-review');

  for (const mergeStateStatus of ['BLOCKED', 'DIRTY', 'BEHIND', 'UNKNOWN', 'HAS_HOOKS']) {
    const hostile = validatePersonalRepositoryEvidence(
      evidenceInput({ mergeStateStatus }),
      expectedEvidence,
      { cleanIndependentReviewProved: true, reviewEscalationChecksProved: true },
    );
    assert.equal(hostile.valid, false, mergeStateStatus);
    assert.ok(hostile.blockers.includes('personal-repository-pr-not-clean'), mergeStateStatus);
  }
});

test('UNSTABLE admission binds the one failing check to the exact reviewed escalation workflow', () => {
  const escalationRun = escalationWorkflowRun();
  const greenRun = workflowRuns()[0];
  const greenCheck = checkRun(greenRun, {
    id: 9301,
    name: 'verify-mission-operations',
    conclusion: 'success',
  });
  const escalationCheck = checkRun(escalationRun);
  const expected = { ...expectedEvidence, mergeStateStatus: 'UNSTABLE' };
  const runs = [...workflowRuns(), escalationRun];
  const admitted = validatePersonalRepositoryCheckRuns(
    [greenCheck, escalationCheck],
    runs,
    [],
    expected,
    { cleanIndependentReviewProved: true },
  );
  assert.equal(admitted.valid, true);
  assert.equal(admitted.admittedReviewEscalations, 1);
  assert.equal(admitted.evidence.find((item) => item.name === 'exact-head-review').disposition, 'clean-independent-review');

  const unreviewed = validatePersonalRepositoryCheckRuns(
    [greenCheck, escalationCheck],
    runs,
    [],
    expected,
  );
  assert.equal(unreviewed.valid, false);

  for (const hostileCheck of [
    checkRun(escalationRun, { name: 'unrelated-security-check' }),
    checkRun(escalationRun, { status: 'in_progress', conclusion: '' }),
    checkRun(escalationRun, { app: { id: 999, slug: 'github-actions' } }),
    checkRun(escalationRun, { head_sha: 'f'.repeat(40) }),
    checkRun(escalationRun, { details_url: 'https://example.test/not-the-bound-job' }),
  ]) {
    const rejected = validatePersonalRepositoryCheckRuns(
      [greenCheck, hostileCheck],
      runs,
      [],
      expected,
      { cleanIndependentReviewProved: true },
    );
    assert.equal(rejected.valid, false);
  }

  const unrelatedFailure = checkRun(greenRun, {
    id: 9302,
    name: 'unrelated-security-check',
    conclusion: 'failure',
  });
  const extraFailure = validatePersonalRepositoryCheckRuns(
    [greenCheck, escalationCheck, unrelatedFailure],
    runs,
    [],
    expected,
    { cleanIndependentReviewProved: true },
  );
  assert.equal(extraFailure.valid, false);
  assert.ok(extraFailure.blockers.includes('personal-repository-check-run-not-exact-green'));

  const legacyFailure = validatePersonalRepositoryCheckRuns(
    [greenCheck, escalationCheck],
    runs,
    [{ sha: sourceHead, state: 'failure' }],
    expected,
    { cleanIndependentReviewProved: true },
  );
  assert.equal(legacyFailure.valid, false);
  assert.ok(legacyFailure.blockers.includes('personal-repository-commit-status-not-exact-green'));
});

test('a later exact successful review neutralizes only its bound historical draft skip', () => {
  const skippedRun = escalationWorkflowRun({
    id: 9198,
    check_suite_id: 8198,
    conclusion: 'skipped',
  });
  const successfulRun = escalationWorkflowRun({
    id: 9199,
    check_suite_id: 8199,
    conclusion: 'success',
  });
  const skippedCheck = checkRun(skippedRun, {
    id: 9298,
    conclusion: 'skipped',
  });
  const successfulCheck = checkRun(successfulRun, {
    id: 9299,
    conclusion: 'success',
  });
  const exact = validatePersonalRepositoryCheckRuns(
    [skippedCheck, successfulCheck],
    [skippedRun, successfulRun],
    [],
    expectedEvidence,
  );
  assert.equal(exact.valid, true);
  assert.equal(exact.evidence.find(({ checkId }) => checkId === 9298).disposition, 'superseded-draft-skip');

  for (const [candidateCheck, candidateRun] of [
    [successfulCheck, { ...successfulRun, id: 9197 }],
    [{ ...successfulCheck, conclusion: 'failure' }, successfulRun],
    [{ ...successfulCheck, head_sha: 'f'.repeat(40) }, successfulRun],
    [{ ...successfulCheck, app: { id: 999, slug: 'github-actions' } }, successfulRun],
    [{ ...successfulCheck, name: 'unrelated-review' }, successfulRun],
    [successfulCheck, { ...successfulRun, path: `${repository}/.github/workflows/other.yml@refs/heads/main` }],
  ]) {
    const blocked = validatePersonalRepositoryCheckRuns(
      [skippedCheck, candidateCheck],
      [skippedRun, candidateRun],
      [],
      expectedEvidence,
    );
    assert.equal(blocked.valid, false);
    assert.ok(blocked.blockers.length > 0);
  }
});

test('deadline convergence admits every exact snapshot arrival within the bounded window', async () => {
  assert.equal(PERSONAL_REPOSITORY_CHECK_SNAPSHOT_CONVERGENCE_TIMEOUT_MS, 120_000);
  assert.equal(PERSONAL_REPOSITORY_CHECK_SNAPSHOT_POLL_INTERVAL_MS, 5_000);
  const escalationRun = escalationWorkflowRun();
  const greenRun = workflowRuns()[0];
  const expected = { ...expectedEvidence, mergeStateStatus: 'UNSTABLE' };
  const exactSnapshot = {
    checkRuns: [
      checkRun(greenRun, { id: 9301, name: 'verify-mission-operations', conclusion: 'success' }),
      checkRun(escalationRun),
    ],
    workflowRuns: [...workflowRuns(), escalationRun],
    commitStatuses: [],
  };
  const inconsistentSnapshot = {
    ...exactSnapshot,
    workflowRuns: workflowRuns(),
  };
  for (const exactSnapshotAttempt of [1, 2, 3, 4, 7, 13, 25]) {
    let clockMs = 0;
    const reads = [];
    const waits = [];
    const recovered = await validatePersonalRepositoryCheckRunsWithBoundedReread({
      readSnapshot: async (attempt) => {
        reads.push(attempt);
        return attempt < exactSnapshotAttempt ? inconsistentSnapshot : exactSnapshot;
      },
      waitBeforeReread: async (delayMs) => {
        waits.push(delayMs);
        clockMs += delayMs;
      },
      monotonicNow: () => clockMs,
      expected,
      options: { cleanIndependentReviewProved: true },
    });
    assert.equal(recovered.valid, true);
    assert.equal(recovered.snapshotAttempt, exactSnapshotAttempt);
    assert.deepEqual(reads, Array.from({ length: exactSnapshotAttempt }, (_, index) => index + 1));
    assert.equal(waits.length, exactSnapshotAttempt - 1);
    assert.ok(clockMs <= PERSONAL_REPOSITORY_CHECK_SNAPSHOT_CONVERGENCE_TIMEOUT_MS);
    assert.equal(recovered.admittedReviewEscalations, 1);
    assert.deepEqual(recovered.selectedSnapshot.workflowRuns, exactSnapshot.workflowRuns);
    assert.notStrictEqual(recovered.selectedSnapshot.workflowRuns, exactSnapshot.workflowRuns);
    assert.equal(Object.isFrozen(recovered.selectedSnapshot.workflowRuns), true);
    assert.equal(recovered.convergenceDeadlineReached, false);
  }
});

test('deadline convergence rereads a transient partial check identity but admits only the later exact snapshot', async () => {
  const greenRun = workflowRuns()[0];
  const expected = { ...expectedEvidence, mergeStateStatus: 'CLEAN' };
  const exactCheck = checkRun(greenRun, {
    id: 9301,
    name: 'verify-mission-operations',
    conclusion: 'success',
  });
  const partialSnapshot = {
    checkRuns: [{ ...exactCheck, details_url: '' }],
    workflowRuns: workflowRuns(),
    commitStatuses: [],
  };
  const exactSnapshot = {
    checkRuns: [exactCheck],
    workflowRuns: workflowRuns(),
    commitStatuses: [],
  };
  let clockMs = 0;
  const recovered = await validatePersonalRepositoryCheckRunsWithBoundedReread({
    readSnapshot: async (attempt) => attempt === 1 ? partialSnapshot : exactSnapshot,
    waitBeforeReread: async (delayMs) => {
      clockMs += delayMs;
    },
    monotonicNow: () => clockMs,
    expected,
    options: { cleanIndependentReviewProved: true },
  });
  assert.equal(recovered.valid, true);
  assert.equal(recovered.snapshotAttempt, 2);
  assert.deepEqual(recovered.snapshotAttempts, [
    {
      attempt: 1,
      valid: false,
      retryable: true,
      blockers: ['personal-repository-check-run-identity-invalid'],
    },
    { attempt: 2, valid: true, retryable: false, blockers: [] },
  ]);
  assert.equal(recovered.selectedSnapshot.checkRuns[0].details_url, exactCheck.details_url);
});

test('deadline convergence expires closed for persistent GitHub identity inconsistency', async () => {
  const escalationRun = escalationWorkflowRun();
  const exactSnapshot = {
    checkRuns: [checkRun(escalationRun)],
    workflowRuns: workflowRuns(),
    commitStatuses: [],
  };
  let clockMs = 0;
  let reads = 0;
  const blocked = await validatePersonalRepositoryCheckRunsWithBoundedReread({
    readSnapshot: async () => {
      reads += 1;
      return exactSnapshot;
    },
    waitBeforeReread: async (delayMs) => {
      clockMs += delayMs;
    },
    monotonicNow: () => clockMs,
    expected: { ...expectedEvidence, mergeStateStatus: 'UNSTABLE' },
    options: { cleanIndependentReviewProved: true },
  });
  assert.equal(blocked.valid, false);
  assert.equal(blocked.snapshotAttempt, 0);
  assert.equal(blocked.selectedSnapshot, null);
  assert.equal(blocked.convergenceDeadlineReached, true);
  assert.equal(clockMs, PERSONAL_REPOSITORY_CHECK_SNAPSHOT_CONVERGENCE_TIMEOUT_MS);
  assert.equal(reads, 25);
  assert.equal(blocked.snapshotAttempts.every((snapshot) => snapshot.retryable), true);
});

test('deadline convergence expires closed for a persistent hostile check identity', async () => {
  const greenRun = workflowRuns()[0];
  const hostileSnapshot = {
    checkRuns: [checkRun(greenRun, {
      id: 9301,
      name: 'verify-mission-operations',
      head_sha: 'f'.repeat(40),
    })],
    workflowRuns: workflowRuns(),
    commitStatuses: [],
  };
  let clockMs = 0;
  let reads = 0;
  const blocked = await validatePersonalRepositoryCheckRunsWithBoundedReread({
    readSnapshot: async () => {
      reads += 1;
      return hostileSnapshot;
    },
    waitBeforeReread: async (delayMs) => {
      clockMs += delayMs;
    },
    monotonicNow: () => clockMs,
    expected: { ...expectedEvidence, mergeStateStatus: 'CLEAN' },
    options: { cleanIndependentReviewProved: true },
  });
  assert.equal(blocked.valid, false);
  assert.equal(blocked.snapshotAttempt, 0);
  assert.equal(blocked.selectedSnapshot, null);
  assert.equal(blocked.convergenceDeadlineReached, true);
  assert.equal(clockMs, PERSONAL_REPOSITORY_CHECK_SNAPSHOT_CONVERGENCE_TIMEOUT_MS);
  assert.equal(reads, 25);
  assert.deepEqual(blocked.blockers, ['personal-repository-check-run-identity-invalid']);
  assert.equal(blocked.snapshotAttempts.every((snapshot) => snapshot.retryable), true);
});

test('deadline convergence does not reread terminal stale and unrelated failures', async () => {
  const escalationRun = escalationWorkflowRun();
  const greenRun = workflowRuns()[0];
  const expected = { ...expectedEvidence, mergeStateStatus: 'UNSTABLE' };
  const hostileSnapshots = [
    {
      checkRuns: [
        checkRun(escalationRun),
        checkRun(greenRun, { id: 9302, name: 'unrelated-security-check', conclusion: 'failure' }),
      ],
      workflowRuns: [...workflowRuns(), escalationRun],
      commitStatuses: [],
    },
    {
      checkRuns: [checkRun(escalationRun)],
      workflowRuns: [...workflowRuns(), escalationRun],
      commitStatuses: [{ sha: sourceHead, state: 'failure' }],
    },
  ];
  for (const hostileSnapshot of hostileSnapshots) {
    let reads = 0;
    let waits = 0;
    const blocked = await validatePersonalRepositoryCheckRunsWithBoundedReread({
      readSnapshot: async () => {
        reads += 1;
        return hostileSnapshot;
      },
      waitBeforeReread: async () => {
        waits += 1;
      },
      monotonicNow: () => 0,
      expected,
      options: { cleanIndependentReviewProved: true },
    });
    assert.equal(blocked.valid, false);
    assert.equal(blocked.snapshotAttempt, 0);
    assert.equal(blocked.selectedSnapshot, null);
    assert.equal(reads, 1);
    assert.equal(waits, 0);
    assert.equal(blocked.snapshotAttempts[0].retryable, false);
  }
});

test('configuration requires the exact protected environment and an active no-bypass main ruleset', () => {
  const ready = validatePersonalRepositoryConfiguration(configuration(), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
  });
  assert.equal(ready.valid, true);

  const restrictedTokenRepository = { ...configuration().repository };
  delete restrictedTokenRepository.allow_squash_merge;
  delete restrictedTokenRepository.delete_branch_on_merge;
  const hiddenSettings = validatePersonalRepositoryConfiguration(configuration({
    repository: restrictedTokenRepository,
  }), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
  });
  assert.ok(hiddenSettings.blockers.includes('personal-repository-squash-not-enabled'));
  assert.ok(hiddenSettings.blockers.includes('personal-repository-auto-delete-not-disabled'));

  const contextOnlyRules = activeRules();
  delete contextOnlyRules[3].parameters.required_status_checks[0].integration_id;
  assert.ok(validatePersonalRepositoryConfiguration(configuration({
    activeRules: contextOnlyRules,
  }), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
  }).blockers.includes('personal-repository-required-check-not-exact'));

  for (const repositoryOverride of [
    { ...configuration().repository, private: true, visibility: 'private' },
    { ...configuration().repository, visibility: '' },
  ]) {
    assert.ok(validatePersonalRepositoryConfiguration(configuration({ repository: repositoryOverride }), {
      requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
      expectedIntegrationId: integrationId,
    }).blockers.includes('personal-repository-rules-api-not-public'));
  }

  const unsafeEnvironment = environment();
  unsafeEnvironment.can_admins_bypass = true;
  assert.ok(validatePersonalRepositoryConfiguration(configuration({ environment: unsafeEnvironment }), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
  }).blockers.includes('environment-admin-bypass-not-disabled'));

  const bypass = validatePersonalRepositoryConfiguration(configuration({
    rulesets: [{
      id: 91,
      enforcement: 'active',
      updated_at: '2026-08-10T12:00:00Z',
      bypass_actors: [{ actor_id: 1 }],
    }],
  }), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
  });
  assert.ok(bypass.blockers.includes('personal-repository-ruleset-bypass-present:91'));

  const partialProof = validatePersonalRepositoryConfiguration(configuration({
    rulesets: [{ id: 91, enforcement: 'active', updated_at: '2026-08-10T12:00:00Z' }],
  }), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
    requireBypassProof: false,
  });
  assert.equal(partialProof.valid, true);
  assert.equal(partialProof.bypassProven, false);
  assert.equal(
    partialProof.finalVerdict,
    'PERSONAL_REPOSITORY_CONFIGURATION_PARTIAL_PROOF_READY',
  );
  assert.ok(validatePersonalRepositoryConfiguration(configuration({
    rulesets: [{ id: 91, enforcement: 'active', updated_at: '2026-08-10T12:00:00Z' }],
  }), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
  }).blockers.includes('CONFIGURATION_NOT_PROVED:personal-repository-ruleset-bypass-actors:91'));
  for (const malformedBypassActors of [null, {}, 'none']) {
    assert.ok(validatePersonalRepositoryConfiguration(configuration({
      rulesets: [{
        id: 91,
        enforcement: 'active',
        updated_at: '2026-08-10T12:00:00Z',
        bypass_actors: malformedBypassActors,
      }],
    }), {
      requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
      expectedIntegrationId: integrationId,
    }).blockers.includes('CONFIGURATION_NOT_PROVED:personal-repository-ruleset-bypass-actors:91'));
  }
  assert.ok(validatePersonalRepositoryConfiguration(configuration({
    rulesets: [{ id: 91, enforcement: 'active', bypass_actors: [] }],
  }), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
  }).blockers.includes('CONFIGURATION_NOT_PROVED:personal-repository-ruleset-updated-at:91'));

  const queueRule = validatePersonalRepositoryConfiguration(configuration({
    activeRules: [...activeRules(), { type: 'merge_queue', ruleset_id: 91 }],
  }), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
  });
  assert.ok(queueRule.blockers.includes('personal-repository-unavailable-merge-queue-rule-present'));
});

test('configuration evidence binds repository merge settings and exact bypass actors', () => {
  const exact = configuration();
  exact.repository.id = 1179385578;
  const baseline = buildPersonalRepositoryConfigurationEvidence(exact);
  assert.equal(baseline.repository.allow_squash_merge, true);
  assert.equal(baseline.repository.delete_branch_on_merge, false);
  assert.equal(baseline.environment.name, 'operator-merge-approval');
  assert.equal(baseline.environment.can_admins_bypass, false);
  assert.equal(baseline.environment.protection_rules[0].reviewers[0].reviewer.login, 'Cheekyfellastef');
  assert.deepEqual(baseline.rulesets[0].bypass_actors, []);

  for (const changed of [
    configuration({ repository: { ...exact.repository, allow_squash_merge: false } }),
    configuration({ repository: { ...exact.repository, delete_branch_on_merge: true } }),
    configuration({
      repository: exact.repository,
      rulesets: [{ ...exact.rulesets[0], bypass_actors: [{ actor_id: 1 }] }],
    }),
    configuration({
      repository: exact.repository,
      environment: { ...exact.environment, can_admins_bypass: true },
    }),
    configuration({
      repository: exact.repository,
      environment: {
        ...exact.environment,
        deployment_branch_policy: {
          ...exact.environment.deployment_branch_policy,
          protected_branches: false,
        },
      },
    }),
    configuration({
      repository: exact.repository,
      environment: {
        ...exact.environment,
        protection_rules: [{
          ...exact.environment.protection_rules[0],
          prevent_self_review: true,
        }],
      },
    }),
    configuration({
      repository: exact.repository,
      environment: {
        ...exact.environment,
        protection_rules: [{
          ...exact.environment.protection_rules[0],
          reviewers: [{ type: 'User', reviewer: { login: 'lookalike-operator' } }],
        }],
      },
    }),
  ]) {
    assert.notDeepEqual(buildPersonalRepositoryConfigurationEvidence(changed), baseline);
  }
});

test('approval receipt is exact-head, exact-base, immutable-review and squash-only', () => {
  const evidence = validatePersonalRepositoryEvidence(evidenceInput(), expectedEvidence);
  const workflows = validatePersonalRepositoryWorkflowRuns(workflowDefinitions(), workflowRuns(), expectedEvidence);
  const config = validatePersonalRepositoryConfiguration(configuration(), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
  });
  const receipt = buildPersonalRepositoryApprovalReceipt({
    evidence,
    workflows,
    configuration: config,
    independentReviewWorkflowRunId: review.workflowRunId,
    independentReviewWorkflowRunAttempt: review.workflowRunAttempt,
    independentReviewArtifactId: review.artifactId,
    independentReviewArtifactDigest: review.artifactDigest,
    independentReviewPayloadSha256: review.payloadSha256,
    evidenceSha256: 'f'.repeat(64),
    approvedAtUtc: '2026-08-10T12:00:00Z',
  });
  assert.equal(receipt.authority, PERSONAL_REPOSITORY_AUTHORITY);
  assert.equal(receipt.mergeMethod, 'squash');
  assert.equal(receipt.reusableAcrossHeads, false);
  assert.equal(receipt.reusableAcrossBases, false);
  assert.equal(validatePersonalRepositoryApprovalReceipt(receipt, receipt).valid, true);
  assert.ok(validatePersonalRepositoryApprovalReceipt(receipt, {
    ...receipt,
    sourceHead: '0'.repeat(40),
  }).blockers.includes('personal-repository-approval-head-mismatch'));
});

test('squash completion requires one base parent, the reviewed tree and a retained source branch', () => {
  const mergeSha = '9'.repeat(40);
  const completion = validatePersonalRepositorySquashCompletion({
    mergeResponse: { merged: true, sha: mergeSha },
    pullRequest: { merged: true, merge_commit_sha: mergeSha },
    liveMainRef: { object: { sha: mergeSha } },
    mergeCommit: { sha: mergeSha, tree: { sha: sourceTree }, parents: [{ sha: baseSha }] },
    branchRef: { object: { sha: sourceHead } },
  }, expectedEvidence);
  assert.equal(completion.valid, true);

  const deletedBranch = validatePersonalRepositorySquashCompletion({
    mergeResponse: { merged: true, sha: mergeSha },
    pullRequest: { merged: true, merge_commit_sha: mergeSha },
    liveMainRef: { object: { sha: mergeSha } },
    mergeCommit: { sha: mergeSha, tree: { sha: sourceTree }, parents: [{ sha: baseSha }] },
    branchRef: {},
  }, expectedEvidence);
  assert.ok(deletedBranch.blockers.includes('personal-repository-source-branch-deleted-or-moved'));
});
