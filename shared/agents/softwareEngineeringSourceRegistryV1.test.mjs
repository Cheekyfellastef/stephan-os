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

function techniqueInput(sourceRecord, overrides = {}) {
  return {
    sourceRecord,
    techniqueId: 'bounded-parser-pattern',
    name: 'BoundedParserPattern',
    problemSolved: 'UntrustedInputParsing',
    method: 'ValidateBeforeTransformation',
    evidenceRefs: ['evidence:example-parser-source'],
    applicableDomains: ['software-engineering', 'shared-agents'],
    failureModes: ['silent-truncation'],
    ...overrides,
  };
}

test('admits a current official technical source with zero authority', () => {
  const record = buildSoftwareEngineeringSourceRecordV1(sourceInput());
  assert.equal(record.schemaVersion, SOFTWARE_ENGINEERING_SOURCE_RECORD_SCHEMA_V1);
  assert.equal(record.primarySource, true);
  assert.equal(record.status, 'ADMITTED');
  assert.equal(record.refreshOwner, '#1902');
  assert.equal(record.extractionOwner, '#1958');
  assert.equal(record.authority.sourceMutationAllowed, false);
  assert.equal(record.authority.researchDispatchAllowed, false);
  assert.equal(Object.isFrozen(record), true);
});

test('canonical issue owners are bounded and malformed issue refs remain rejected', () => {
  for (const value of ['#0', '#01', '#12345678901', '#abc', '#1902/extra']) {
    const refreshValidation = validateSoftwareEngineeringSourceRecordInputV1(sourceInput({ refreshOwner: value }));
    assert.equal(refreshValidation.valid, false, value);
    assert.ok(refreshValidation.blockers.includes('refresh-owner-invalid'), value);

    const extractionValidation = validateSoftwareEngineeringSourceRecordInputV1(sourceInput({ extractionOwner: value }));
    assert.equal(extractionValidation.valid, false, value);
    assert.ok(extractionValidation.blockers.includes('extraction-owner-invalid'), value);
  }
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
      revisionOrVersion: '0'.repeat(40),
      licence: 'UNKNOWN',
      reuseRoute: 'DIRECT_REUSE_ALLOWED',
    })),
    /licence-required-for-reuse/,
  );
});

test('reference-only classes and evidence planes cannot grant direct or adaptation implementation rights', () => {
  for (const reuseRoute of ['DIRECT_REUSE_ALLOWED', 'REUSE_WITH_ATTRIBUTION_OR_CONDITIONS', 'ADAPTATION_ALLOWED']) {
    const secondaryClass = validateSoftwareEngineeringSourceRecordInputV1(sourceInput({
      sourceId: `secondary-${reuseRoute.toLowerCase()}`,
      sourceClass: 'SECONDARY_REFERENCE_ONLY',
      canonicalLocation: 'https://example.com/reference',
      publisherOrOwner: 'example-author',
      revisionOrVersion: null,
      licence: 'MIT',
      rightsEvidence: ['evidence:reference-licence'],
      reuseRoute,
      evidencePlane: 'SECONDARY_REFERENCE',
    }));
    assert.equal(secondaryClass.valid, false, reuseRoute);
    assert.ok(secondaryClass.blockers.includes('reuse-route-incompatible-with-source-evidence'), reuseRoute);

    const secondaryPlane = validateSoftwareEngineeringSourceRecordInputV1(sourceInput({
      sourceId: `secondary-plane-${reuseRoute.toLowerCase()}`,
      licence: 'MIT',
      rightsEvidence: ['evidence:reference-licence'],
      reuseRoute,
      evidencePlane: 'SECONDARY_REFERENCE',
    }));
    assert.equal(secondaryPlane.valid, false, reuseRoute);
    assert.ok(secondaryPlane.blockers.includes('reuse-route-incompatible-with-source-evidence'), reuseRoute);
  }
});

test('fresh evidence rejects impossible future retrieval timestamps beyond bounded clock skew', () => {
  const asOfUtc = '2026-08-29T20:00:00.000Z';
  const acceptedBoundary = validateSoftwareEngineeringSourceRecordInputV1(sourceInput({
    retrievedAtUtc: '2026-08-29T20:05:00.000Z',
  }), { asOfUtc });
  assert.equal(acceptedBoundary.valid, true);

  const impossibleFuture = validateSoftwareEngineeringSourceRecordInputV1(sourceInput({
    retrievedAtUtc: '2026-08-29T20:05:00.001Z',
  }), { asOfUtc });
  assert.equal(impossibleFuture.valid, false);
  assert.ok(impossibleFuture.blockers.includes('retrieved-at-in-future'));

  const farFuture = validateSoftwareEngineeringSourceRecordInputV1(sourceInput({
    retrievedAtUtc: '2099-01-01T00:00:00.000Z',
  }), { asOfUtc });
  assert.equal(farFuture.valid, false);
  assert.ok(farFuture.blockers.includes('retrieved-at-in-future'));
});

test('versioned source classes reject mutable aliases and branch refs', () => {
  for (const revisionOrVersion of ['main', 'HEAD', 'latest', 'refs/heads/release']) {
    assert.throws(
      () => buildSoftwareEngineeringSourceRecordV1(sourceInput({
        sourceClass: 'CANONICAL_UPSTREAM_REPOSITORY',
        canonicalLocation: 'https://github.com/example/project',
        publisherOrOwner: 'example',
        revisionOrVersion,
        licence: 'MIT',
        rightsEvidence: ['evidence:example-project-license'],
        reuseRoute: 'DIRECT_REUSE_ALLOWED',
        evidencePlane: 'DIRECT_PUBLIC_SOURCE',
      })),
      /immutable-revision-or-version-required/,
      revisionOrVersion,
    );
  }
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

test('stale rejected primary evidence cannot veto a fresh admitted source', () => {
  const fresh = buildSoftwareEngineeringSourceRecordV1(sourceInput());
  const staleRejected = buildSoftwareEngineeringSourceRecordV1(sourceInput({
    sourceId: 'obsolete-release-note',
    sourceClass: 'OFFICIAL_RELEASE_NOTES',
    canonicalLocation: 'https://nodejs.org/en/blog/release/obsolete',
    publisherOrOwner: 'Node.js',
    revisionOrVersion: 'v20.0.0',
    evidencePlane: 'OFFICIAL_RELEASE_OR_SECURITY_NOTICE',
    reuseRoute: 'REJECT_STALE_OR_INCOMPATIBLE',
    conflicts: ['claim:obsolete-conflict'],
    freshness: 'STALE',
    status: 'REJECTED',
  }));
  const selection = selectPreferredSoftwareEngineeringSourceV1([staleRejected, fresh], {
    claim: 'claim:node-test-runner-current',
  });
  assert.equal(selection.decision, 'SOURCE_SELECTED');
  assert.equal(selection.source.recordId, fresh.recordId);
  assert.deepEqual(selection.conflictingSourceRecordIds, []);
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

test('an adaptation-only source never grants direct code reuse', () => {
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
  const technique = buildSoftwareEngineeringTechniqueCandidateV1(techniqueInput(source));
  assert.equal(technique.sourceRecordId, source.recordId);
  assert.equal(technique.sourceRevisionOrVersion, source.revisionOrVersion);
  assert.equal(technique.reuseRoute, 'ADAPTATION_ALLOWED');
  assert.equal(technique.directCodeReuseAllowed, false);
  assert.equal(technique.implementationContextAllowed, true);
});

test('technique candidates revalidate the complete source record and content identity', () => {
  const source = buildSoftwareEngineeringSourceRecordV1(sourceInput({
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
  const forgedLicence = { ...structuredClone(source), licence: 'UNKNOWN' };
  const forgedRecordId = { ...structuredClone(source), recordId: 'software-engineering-source-000000000000000000000000' };
  const widenedAuthority = {
    ...structuredClone(source),
    authority: { ...source.authority, sourceMutationAllowed: true },
  };
  for (const forged of [forgedLicence, forgedRecordId, widenedAuthority]) {
    assert.throws(
      () => buildSoftwareEngineeringTechniqueCandidateV1(techniqueInput(forged)),
      /exact revalidated software engineering source record/,
    );
  }
});

test('source selection ignores forged records and uses only exact revalidated evidence', () => {
  const official = buildSoftwareEngineeringSourceRecordV1(sourceInput());
  const forged = { ...structuredClone(official), recordId: 'software-engineering-source-forged' };
  const selection = selectPreferredSoftwareEngineeringSourceV1([forged, official], {
    claim: 'claim:node-test-runner-current',
  });
  assert.equal(selection.decision, 'SOURCE_SELECTED');
  assert.equal(selection.source.recordId, official.recordId);
});

test('authority widening is rejected before source admission', () => {
  const validation = validateSoftwareEngineeringSourceRecordInputV1(sourceInput({
    authority: { sourceMutationAllowed: true },
  }));
  assert.equal(validation.valid, false);
  assert.ok(validation.blockers.includes('authority-widening-rejected'));
});
