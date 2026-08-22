import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SOFTWARE_ENGINEERING_SOURCE_AUTHORITY_V1,
  SOFTWARE_ENGINEERING_SOURCE_RECORD_SCHEMA_V1,
  SOFTWARE_ENGINEERING_TECHNIQUE_CANDIDATE_SCHEMA_V1,
  buildSoftwareEngineeringSourceRecordV1,
  buildSoftwareEngineeringTechniqueCandidateV1,
  selectPreferredSoftwareEngineeringSourceV1,
  validateSoftwareEngineeringSourceRecordInputV1,
} from './softwareEngineeringSourceRegistryV1.mjs';

function sourceInput(overrides = {}) {
  return {
    sourceId: 'node-api-docs',
    sourceClass: 'OFFICIAL_DOCUMENTATION',
    canonicalLocation: 'https://nodejs.org/api/test.html',
    publisherOrOwner: 'Node.js',
    revisionOrVersion: 'v24.0.0',
    retrievedAtUtc: '2026-08-22T13:10:00.000Z',
    freshnessRequirement: 'CURRENT_RELEASE',
    licence: 'Documentation terms',
    rightsEvidence: ['evidence:node-docs-terms'],
    reuseRoute: 'ANALYSIS_ONLY_REIMPLEMENT_ORIGINAL',
    applicableLanguagesPlatformsAndComponents: ['JavaScript', 'Node.js', 'shared/agents'],
    evidencePlane: 'OFFICIAL_TECHNICAL_EVIDENCE',
    claimsSupported: ['claim:node-test-runner-current'],
    conflicts: [],
    availability: 'AVAILABLE',
    refreshOwner: '#1902',
    extractionOwner: '#1958',
    freshness: 'FRESH',
    status: 'ADMITTED',
    authority: { ...SOFTWARE_ENGINEERING_SOURCE_AUTHORITY_V1 },
    ...overrides,
  };
}

test('admits a current official technical source with zero authority', () => {
  const record = buildSoftwareEngineeringSourceRecordV1(sourceInput());
  assert.equal(record.schemaVersion, SOFTWARE_ENGINEERING_SOURCE_RECORD_SCHEMA_V1);
  assert.equal(record.primarySource, true);
  assert.equal(record.status, 'ADMITTED');
  assert.equal(record.authority.sourceMutationAllowed, false);
  assert.equal(record.authority.researchDispatchAllowed, false);
  assert.equal(Object.isFrozen(record), true);
});

test('admits a pinned licence-compatible upstream repository for bounded direct reuse', () => {
  const record = buildSoftwareEngineeringSourceRecordV1(sourceInput({
    sourceId: 'example-upstream',
    sourceClass: 'CANONICAL_UPSTREAM_REPOSITORY',
    canonicalLocation: 'https://github.com/example/project',
    publisherOrOwner: 'example',
    revisionOrVersion: '0123456789abcdef0123456789abcdef01234567',
    licence: 'MIT',
    rightsEvidence: ['evidence:example-project-license'],
    reuseRoute: 'DIRECT_REUSE_ALLOWED',
    evidencePlane: 'DIRECT_PUBLIC_SOURCE',
    claimsSupported: ['claim:bounded-parser-pattern'],
  }));
  assert.equal(record.reuseRoute, 'DIRECT_REUSE_ALLOWED');
  assert.equal(record.licence, 'MIT');
  assert.equal(record.primarySource, true);
});

test('blocks direct reuse when version or licence evidence is missing', () => {
  assert.throws(
    () => buildSoftwareEngineeringSourceRecordV1(sourceInput({
      sourceClass: 'CANONICAL_UPSTREAM_REPOSITORY',
      revisionOrVersion: '',
      licence: 'MIT',
      reuseRoute: 'DIRECT_REUSE_ALLOWED',
    })),
    /revision-or-version-required/,
  );
  assert.throws(
    () => buildSoftwareEngineeringSourceRecordV1(sourceInput({
      sourceClass: 'CANONICAL_UPSTREAM_REPOSITORY',
      licence: 'UNKNOWN',
      reuseRoute: 'DIRECT_REUSE_ALLOWED',
    })),
    /licence-required-for-reuse/,
  );
});

test('fresh official evidence outranks stale secondary material', () => {
  const official = buildSoftwareEngineeringSourceRecordV1(sourceInput());
  const staleSecondary = buildSoftwareEngineeringSourceRecordV1(sourceInput({
    sourceId: 'old-blog-post',
    sourceClass: 'SECONDARY_REFERENCE_ONLY',
    canonicalLocation: 'https://example.com/old-post',
    publisherOrOwner: 'example-author',
    revisionOrVersion: null,
    licence: 'UNKNOWN',
    rightsEvidence: [],
    reuseRoute: 'REFERENCE_ONLY',
    evidencePlane: 'SECONDARY_REFERENCE',
    freshness: 'STALE',
    status: 'REFERENCE_ONLY',
  }));
  const selection = selectPreferredSoftwareEngineeringSourceV1([staleSecondary, official], {
    claim: 'claim:node-test-runner-current',
  });
  assert.equal(selection.decision, 'SOURCE_SELECTED');
  assert.equal(selection.source.recordId, official.recordId);
});

test('conflicting primary evidence remains an explicit hold', () => {
  const conflicting = buildSoftwareEngineeringSourceRecordV1(sourceInput({
    sourceId: 'conflicting-official-note',
    sourceClass: 'OFFICIAL_RELEASE_NOTES',
    canonicalLocation: 'https://nodejs.org/en/blog/release/example',
    publisherOrOwner: 'Node.js',
    revisionOrVersion: 'v24.0.1',
    evidencePlane: 'OFFICIAL_RELEASE_OR_SECURITY_NOTICE',
    reuseRoute: 'ANALYSIS_ONLY_REIMPLEMENT_ORIGINAL',
    conflicts: ['claim:node-test-runner-current-conflict'],
    freshness: 'CONFLICTING',
    status: 'CONFLICTING',
  }));
  const selection = selectPreferredSoftwareEngineeringSourceV1([conflicting], {
    claim: 'claim:node-test-runner-current',
  });
  assert.equal(selection.decision, 'CONFLICTING_PRIMARY_SOURCES');
  assert.deepEqual(selection.conflictingSourceRecordIds, [conflicting.recordId]);
});

test('reference-only proprietary evidence can yield principles but not direct implementation context', () => {
  const reference = buildSoftwareEngineeringSourceRecordV1(sourceInput({
    sourceId: 'commercial-product-reference',
    sourceClass: 'SECONDARY_REFERENCE_ONLY',
    canonicalLocation: 'https://example.com/commercial-product',
    publisherOrOwner: 'commercial-vendor',
    revisionOrVersion: null,
    licence: 'PROPRIETARY',
    rightsEvidence: ['evidence:public-product-page'],
    reuseRoute: 'REFERENCE_ONLY',
    evidencePlane: 'SECONDARY_REFERENCE',
    claimsSupported: ['claim:interaction-principle'],
    status: 'REFERENCE_ONLY',
  }));
  const technique = buildSoftwareEngineeringTechniqueCandidateV1({
    sourceRecord: reference,
    techniqueId: 'interaction-principle',
    name: 'InteractionPrinciple',
    problemSolved: 'BoundedInteractionFeedback',
    method: 'ReimplementFromObservedPrinciples',
    evidenceRefs: ['evidence:public-product-page'],
    applicableDomains: ['software-engineering'],
    failureModes: ['distinctive-expression-copying'],
  });
  assert.equal(technique.schemaVersion, SOFTWARE_ENGINEERING_TECHNIQUE_CANDIDATE_SCHEMA_V1);
  assert.equal(technique.directCodeReuseAllowed, false);
  assert.equal(technique.implementationContextAllowed, false);
});

test('a technique candidate preserves exact source, evidence and reuse constraints', () => {
  const source = buildSoftwareEngineeringSourceRecordV1(sourceInput({
    sourceId: 'example-upstream',
    sourceClass: 'CANONICAL_UPSTREAM_REPOSITORY',
    canonicalLocation: 'https://github.com/example/project',
    publisherOrOwner: 'example',
    revisionOrVersion: '0123456789abcdef0123456789abcdef01234567',
    licence: 'Apache-2.0',
    rightsEvidence: ['evidence:example-project-license'],
    reuseRoute: 'ADAPTATION_ALLOWED',
    evidencePlane: 'DIRECT_PUBLIC_SOURCE',
    claimsSupported: ['claim:bounded-parser-pattern'],
  }));
  const technique = buildSoftwareEngineeringTechniqueCandidateV1({
    sourceRecord: source,
    techniqueId: 'bounded-parser-pattern',
    name: 'BoundedParserPattern',
    problemSolved: 'UntrustedInputParsing',
    method: 'ValidateBeforeTransformation',
    evidenceRefs: ['evidence:example-parser-source'],
    applicableDomains: ['software-engineering', 'shared-agents'],
    failureModes: ['silent-truncation'],
  });
  assert.equal(technique.sourceRecordId, source.recordId);
  assert.equal(technique.sourceRevisionOrVersion, source.revisionOrVersion);
  assert.equal(technique.reuseRoute, 'ADAPTATION_ALLOWED');
  assert.equal(technique.directCodeReuseAllowed, true);
});

test('authority widening is rejected before source admission', () => {
  const validation = validateSoftwareEngineeringSourceRecordInputV1(sourceInput({
    authority: { sourceMutationAllowed: true },
  }));
  assert.equal(validation.valid, false);
  assert.ok(validation.blockers.includes('authority-widening-rejected'));
});
