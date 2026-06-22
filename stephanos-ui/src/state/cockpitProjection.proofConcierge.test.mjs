import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCockpitProjection } from './cockpitProjection.js';

test('operator-facing Proof Concierge uses canonical build-proof when stale reconciliation is empty but missing proof sources include build-proof', () => {
  const projection = buildCockpitProjection({
    runtimeStatusModel: {
      missionProofReconciliation: {
        acceptedItems: ['mission-console-bridge'],
        remainingMissingItems: [],
        nextBestAction: 'Collect build-proof',
      },
      missionEvidenceLedgerProjection: {
        acceptedProof: ['mission-console-bridge'],
        missingProof: ['build-proof', 'verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output'],
      },
    },
  });

  assert.equal(projection.operatorProofConcierge.nextProof, 'build-proof');
  assert.equal(projection.operatorProofConcierge.packetKind, 'build-proof');
  assert.equal(projection.operatorProofConcierge.nextActionLabel, 'Copy build-proof packet');
  assert.equal(projection.operatorProofConcierge.proofStateContradictionDetected, 'no');
  assert.equal(projection.operatorProofConcierge.packetText.split('\n')[0], 'Proof Packet V1');
  assert.equal(projection.operatorProofConcierge.packetText.includes('Packet Kind: build-proof'), true);
  assert.equal(projection.operatorProofConcierge.copyPacket.label, 'Copy build-proof packet');
  assert.equal(projection.operatorProofConcierge.copyPacket.packetKind, 'build-proof');
  assert.equal(projection.operatorProofConcierge.copyPacket.source, 'OperatorProofConcierge.copyPacket');
  assert.equal(projection.operatorProofConcierge.visiblePrimaryButtonLabel, 'Copy build-proof packet');
  assert.equal(projection.operatorProofConcierge.visiblePrimaryButtonSource, 'OperatorProofConcierge.copyPacket');
  assert.equal(projection.operatorProofConcierge.copyDiagnosticPacket.label, 'Copy diagnostic packet');
  assert.equal(projection.operatorProofConcierge.copyDiagnosticPacket.available, 'no');
});

test('Proof Concierge diagnostic primary action is not shown when contradiction is false', () => {
  const projection = buildCockpitProjection({
    runtimeStatusModel: {
      missionProofReconciliation: {
        acceptedItems: ['mission-console-bridge'],
        remainingMissingItems: ['build-proof'],
      },
    },
  });

  assert.equal(projection.operatorProofConcierge.proofStateContradictionDetected, 'no');
  assert.notEqual(projection.operatorProofConcierge.nextActionLabel, 'Copy proof-state diagnostic packet');
  assert.equal(projection.operatorProofConcierge.nextActionLabel, 'Copy build-proof packet');
  assert.equal(projection.operatorProofConcierge.copyPacket.label, 'Copy build-proof packet');
  assert.equal(projection.operatorProofConcierge.copyPacket.source, 'OperatorProofConcierge.copyPacket');
  assert.equal(projection.operatorProofConcierge.visiblePrimaryButtonLabel, 'Copy build-proof packet');
  assert.equal(projection.operatorProofConcierge.visiblePrimaryButtonSource, 'OperatorProofConcierge.copyPacket');
  assert.notEqual(projection.operatorProofConcierge.copyDiagnosticPacket.source, projection.operatorProofConcierge.visiblePrimaryButtonSource);
  assert.equal(projection.operatorProofConcierge.copyDiagnosticPacket.available, 'no');
});

test('CockpitPanel visible Concierge primary button is wired to canonical Concierge projection copy action', () => {
  const source = readFileSync(new URL('../components/CockpitPanel.jsx', import.meta.url), 'utf8');
  assert.match(source, /data-testid="operator-proof-concierge-primary-copy"/);
  assert.match(source, /onClick=\{handleCopyConciergePacket\}/);
  assert.match(source, /data-concierge-button-role="primary-proof-copy"/);
  assert.match(source, /buttonRole: 'primary-proof-copy'/);
  assert.match(source, /buttonTestId: 'operator-proof-concierge-primary-copy'/);
  assert.match(source, /const source = packet\?\.source \|\| 'OperatorProofConcierge\.copyPacket'/);
  assert.match(source, /const primaryProofCopyPacket = operatorProofConcierge\.copyPacket/);
  assert.match(source, /data-concierge-visible-primary-button-label=\{primaryProofCopyPacket\?\.label/);
  assert.match(source, /data-concierge-visible-primary-button-label=/);
  assert.match(source, /data-concierge-visible-primary-button-source=/);
  assert.match(source, /data-proof-concierge-render-source="cockpit-canonical-copy-packet"/);
  assert.match(source, /data-proof-concierge-primary-source="OperatorProofConcierge.copyPacket"/);
  assert.match(source, /Proof packet unavailable/);
  assert.doesNotMatch(source, /data-concierge-button-role="diagnostic-copy"/);
  assert.doesNotMatch(source, /operator-proof-concierge-diagnostic-drilldown/);
  assert.doesNotMatch(source, /Diagnostics\/details — diagnostic packet/);
  assert.doesNotMatch(source, /Copy proof-state diagnostic packet<\/button>/);
});


test('built Proof Concierge primary button path cannot reference diagnostic packet fields', () => {
  const distIndexPath = resolve(process.cwd(), 'apps/stephanos/dist/index.html');
  assert.equal(existsSync(distIndexPath), true, 'expected built Stephanos dist index to exist');
  const indexHtml = readFileSync(distIndexPath, 'utf8');
  const scriptMatches = [...indexHtml.matchAll(/<script\b[^>]+src=["']([^"']+\.js)["'][^>]*><\/script>/g)];
  assert.notEqual(scriptMatches.length, 0, 'expected built Stephanos dist JS asset references');

  const jsContents = scriptMatches.map((match) => {
    const src = match[1].replace(/^\.\//, '');
    return readFileSync(resolve(process.cwd(), 'apps/stephanos/dist', src), 'utf8');
  });
  const bundle = jsContents.find((content) => content.includes('operator-proof-concierge-primary-copy')) || '';
  assert.match(bundle, /operator-proof-concierge-primary-copy/);

  const renderAnchor = bundle.indexOf('data-proof-concierge-primary-source');
  assert.notEqual(renderAnchor, -1, 'expected built primary Concierge render source anchor');
  const buttonIndex = bundle.indexOf('operator-proof-concierge-primary-copy', renderAnchor);
  assert.notEqual(buttonIndex, -1, 'expected built visible primary Concierge button after render source anchor');
  const primaryButtonPath = bundle.slice(Math.max(0, renderAnchor - 1000), buttonIndex + 3000);
  assert.doesNotMatch(primaryButtonPath, /OperatorProofConcierge\.copyDiagnosticPacket|Copy proof-state diagnostic packet|proof-state-reconciliation|copyDiagnosticPacket/);
  assert.match(primaryButtonPath, /OperatorProofConcierge\.copyPacket|copyPacket/);
});

test('Proof Concierge canonical projection can replace stale diagnostic state on rerender', () => {
  const staleDiagnosticProjection = buildCockpitProjection({
    runtimeStatusModel: {
      missionProofReconciliation: { acceptedItems: ['mission-console-bridge'], remainingMissingItems: [] },
    },
  });
  assert.equal(staleDiagnosticProjection.operatorProofConcierge.nextProof, 'proof-state-reconciliation');
  assert.equal(staleDiagnosticProjection.operatorProofConcierge.copyPacket.source, 'OperatorProofConcierge.copyDiagnosticPacket');

  const canonicalBuildProjection = buildCockpitProjection({
    runtimeStatusModel: {
      missionProofReconciliation: { acceptedItems: ['mission-console-bridge'], remainingMissingItems: [] },
      missionEvidenceLedgerProjection: {
        acceptedProof: ['mission-console-bridge'],
        missingProof: ['build-proof', 'verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output'],
      },
    },
  });

  const renderedNextProof = canonicalBuildProjection.operatorProofConcierge.nextProof;
  const renderedCopyLabel = canonicalBuildProjection.operatorProofConcierge.copyPacket.label;
  const renderedCopySource = canonicalBuildProjection.operatorProofConcierge.copyPacket.source;
  assert.equal(renderedNextProof, 'build-proof');
  assert.equal(renderedCopyLabel, 'Copy build-proof packet');
  assert.equal(renderedCopySource, 'OperatorProofConcierge.copyPacket');
});

test('CockpitPanel emits Proof Concierge lifecycle trace fields without local packet state overwrite', () => {
  const source = readFileSync(new URL('../components/CockpitPanel.jsx', import.meta.url), 'utf8');
  assert.match(source, /data-proof-concierge-initial-render-next-proof=\{proofConciergeInitialNextProof\}/);
  assert.match(source, /data-proof-concierge-initial-render-copy-label=\{proofConciergeInitialCopyLabel\}/);
  assert.match(source, /data-proof-concierge-post-hydration-current-dom-next-proof=\{proofConciergeLifecycleTrace\.currentDomNextProof\}/);
  assert.match(source, /data-proof-concierge-post-hydration-current-dom-copy-label=\{proofConciergeLifecycleTrace\.currentDomCopyLabel\}/);
  assert.match(source, /data-proof-concierge-last-writer-source=\{proofConciergeLastWriterSource\}/);
  assert.doesNotMatch(source, /useState\([^\)]*(copyPacket|primaryProofCopyPacket|copyDiagnosticPacket|proof-state-reconciliation)/);
});

test('CockpitPanel rebuilds cockpit projection every render so in-place runtime proof updates cannot preserve stale diagnostic Concierge DOM', () => {
  const source = readFileSync(new URL('../components/CockpitPanel.jsx', import.meta.url), 'utf8');
  assert.match(source, /const cockpitProjection = cockpitProjectionOverride \|\| buildCockpitProjection\(\{ runtimeStatusModel: runtimeStatus \}\);/);
  assert.doesNotMatch(source, /const cockpitProjection = useMemo\(\(\) => cockpitProjectionOverride \|\| buildCockpitProjection/);
});
