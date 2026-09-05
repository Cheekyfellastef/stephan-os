import { createHash } from 'node:crypto';

import {
  STEPHANOS_RESEARCH_PACKET_SCHEMA_VERSION,
  STEPHANOS_RESEARCH_PRESENTATION_KIND,
} from './stephanosResearchCouncilV1.mjs';

export const STEPHANOS_RESEARCH_RICH_RESPONSE_EXTENSION_SCHEMA_VERSION = 'stephanos.research-rich-response-extension.v1';

const MAX_TEXT = 4_000;
const SAFE_REF = /^[a-z0-9#][a-z0-9._:/#-]{0,255}$/i;
const SECRET_SHAPED_TEXT = /(?:BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY|xox[baprs]-|gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{20,}|(?:password|credential|api[_-]?key|private[_-]?key)\s*[:=])/i;

function text(value, maximum = MAX_TEXT) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return candidate && candidate.length <= maximum && !SECRET_SHAPED_TEXT.test(candidate) ? candidate : '';
}

function plainObject(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (descriptor.get || descriptor.set || !Object.hasOwn(descriptor, 'value')) return null;
    }
    return value;
  } catch {
    return null;
  }
}

function list(value, limit = 64) {
  if (!Array.isArray(value) || value.length > limit) return [];
  return value;
}

function uniqueStrings(value, limit = 64, maximum = 512) {
  const output = [];
  for (const item of list(value, limit)) {
    const candidate = text(item, maximum);
    if (candidate) output.push(candidate);
  }
  return Object.freeze([...new Set(output)]);
}

function safeRefs(value, limit = 64) {
  return Object.freeze(uniqueStrings(value, limit).filter((entry) => SAFE_REF.test(entry)));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function authorityBoundary() {
  return Object.freeze({
    sourceMutationAllowed: false,
    commandExecutionAllowed: false,
    approvalAuthorityAdded: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    providerSelectionAuthorityAdded: false,
    automaticKnowledgePromotionAllowed: false,
    researchAgentsOwnCanonicalTruth: false,
    stephanosOwnsFinalSynthesis: true,
  });
}

function packetAuthorityIsSafe(packet) {
  const authority = plainObject(packet?.authority);
  if (!authority) return false;
  return authority.researchGrantsSourceMutation === false
    && authority.researchGrantsMerge === false
    && authority.researchGrantsDeployment === false
    && authority.researchGrantsRuntimeMutation === false
    && authority.researchGrantsArbitraryShell === false
    && authority.researchGrantsCredentialOrAccountChange === false
    && authority.researchGrantsSpending === false
    && authority.researchMayAutoPromoteKnowledge === false
    && authority.researchAgentsOwnCanonicalTruth === false
    && authority.stephanosOwnsFinalSynthesis === true
    && authority.operatorAuthorityPreserved === true;
}

function invalid(errors) {
  return Object.freeze({
    schemaVersion: STEPHANOS_RESEARCH_RICH_RESPONSE_EXTENSION_SCHEMA_VERSION,
    valid: false,
    extensionId: null,
    researchLineage: null,
    structured: null,
    authority: authorityBoundary(),
    errors: Object.freeze([...new Set(errors)]),
  });
}

function contributionRecords(packet, evidenceRefs) {
  const researcherIds = uniqueStrings(packet.researchersUsed, 32, 256);
  const providerIds = uniqueStrings(packet.providerIds, 32, 256);
  return Object.freeze(researcherIds.map((researcherId, index) => Object.freeze({
    contributorId: SAFE_REF.test(researcherId) ? researcherId : `researcher:${digest(researcherId).slice(0, 16)}`,
    contributionType: 'RESEARCH_SCOUT',
    summary: `Provider-neutral research scout contribution${providerIds[index] ? ` via ${providerIds[index]}` : ''}. Stephanos remains final synthesizer.`,
    evidenceRefs,
  })));
}

function conflictUnknowns(packet) {
  const output = [];
  for (const conflict of list(packet.conflicts, 32)) {
    const record = plainObject(conflict);
    if (!record) continue;
    const topic = text(record.topic, 256);
    const values = uniqueStrings(record.values, 12, 1000);
    if (!topic || values.length < 2) continue;
    output.push(`Unresolved research disagreement on ${topic}: ${values.join(' | ')}`);
  }
  return output;
}

export function buildStephanosResearchRichResponseExtensionV1(input = {}) {
  try {
    const request = plainObject(input);
    const packet = plainObject(request?.researchPacket);
    if (!request || !packet) return invalid(['research-packet-required']);
    if (packet.schemaVersion !== STEPHANOS_RESEARCH_PACKET_SCHEMA_VERSION) {
      return invalid(['research-packet-schema-mismatch']);
    }
    if (!packetAuthorityIsSafe(packet)) return invalid(['research-packet-authority-must-remain-governed']);

    const researchMissionId = text(packet.researchMissionId, 256);
    const researchRoute = text(packet.researchRoute, 128);
    const packetFingerprint = text(packet.packetFingerprint, 256);
    const presentation = plainObject(packet.presentation);
    if (!SAFE_REF.test(researchMissionId) || !researchRoute || !packetFingerprint) {
      return invalid(['research-lineage-invalid']);
    }
    if (!presentation || presentation.kind !== STEPHANOS_RESEARCH_PRESENTATION_KIND) {
      return invalid(['research-presentation-kind-mismatch']);
    }
    if (text(presentation.researchMissionId, 256) !== researchMissionId) {
      return invalid(['research-presentation-lineage-mismatch']);
    }

    const evidenceRefs = safeRefs(packet.sources, 64);
    const conflicts = list(packet.conflicts, 32);
    const unknowns = Object.freeze([
      ...uniqueStrings(packet.unknowns, 32, 2000),
      ...conflictUnknowns(packet),
    ]);
    const candidateKnowledgeUpdates = list(packet.candidateKnowledgeUpdates, 64);
    if (candidateKnowledgeUpdates.some((entry) => plainObject(entry)?.autoPromotionAllowed !== false)) {
      return invalid(['candidate-knowledge-auto-promotion-forbidden']);
    }

    const recommendedNextAction = text(packet.recommendedNextAction, 1000);
    const missionState = conflicts.length > 0 ? 'CONFLICTED' : 'RESEARCH_COMPLETE';
    const structured = Object.freeze({
      goalsMissions: Object.freeze([Object.freeze({
        ref: researchMissionId,
        label: text(packet.question, 1000) || 'Stephanos research mission',
        state: missionState,
        evidenceRefs,
      })]),
      agentProviderContributions: contributionRecords(packet, evidenceRefs),
      unknowns,
      options: Object.freeze([]),
      recommendedAction: Object.freeze({
        actionId: `research:${researchMissionId}:next`,
        label: recommendedNextAction || 'Review the reconciled research evidence.',
        rationale: text(packet.implicationsForStephanos, 2000) || 'Research does not grant implementation authority.',
        requiresApproval: 'UNKNOWN',
        evidenceRefs,
      }),
      approvalState: Object.freeze({
        state: 'NOT_REQUESTED',
        approvalRef: '',
        evidenceRefs: Object.freeze([]),
      }),
      visualisationCandidates: Object.freeze([STEPHANOS_RESEARCH_PRESENTATION_KIND]),
    });

    const researchLineage = Object.freeze({
      researchMissionId,
      researchRoute,
      packetFingerprint,
      presentationKind: STEPHANOS_RESEARCH_PRESENTATION_KIND,
      conflictCount: conflicts.length,
      candidateKnowledgeUpdateCount: candidateKnowledgeUpdates.length,
      automaticKnowledgePromotionAllowed: false,
      researchAgentsOwnCanonicalTruth: false,
      finalSynthesizer: 'stephanos',
    });
    const core = Object.freeze({
      schemaVersion: STEPHANOS_RESEARCH_RICH_RESPONSE_EXTENSION_SCHEMA_VERSION,
      researchLineage,
      structured,
      authority: authorityBoundary(),
    });

    return Object.freeze({
      ...core,
      valid: true,
      extensionId: `research-rich-extension-${digest(core).slice(0, 24)}`,
      errors: Object.freeze([]),
    });
  } catch {
    return invalid(['research-rich-response-extension-failed-closed']);
  }
}
