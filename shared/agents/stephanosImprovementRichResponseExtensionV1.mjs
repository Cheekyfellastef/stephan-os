import { createHash } from 'node:crypto';

import {
  STEPHANOS_GOVERNED_IMPROVEMENT_SCHEMA_VERSION,
  STEPHANOS_IMPROVEMENT_PRESENTATION_KIND,
} from './stephanosGovernedImprovementExperienceV1.mjs';

export const STEPHANOS_IMPROVEMENT_RICH_RESPONSE_EXTENSION_SCHEMA_VERSION = 'stephanos.improvement-rich-response-extension.v1';

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

function uniqueStrings(value, limit = 64, maximum = 1_000) {
  const output = [];
  for (const item of list(value, limit)) {
    const candidate = text(item, maximum);
    if (candidate) output.push(candidate);
  }
  return Object.freeze([...new Set(output)]);
}

function safeRefs(value, limit = 64) {
  return Object.freeze(uniqueStrings(value, limit, 512).filter((entry) => SAFE_REF.test(entry)));
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
    constructionExecutionOwnedHere: false,
    constructionExecutionOwner: 'existing-goal-flywheel-and-qualified-construction-machinery',
  });
}

function presentationAuthorityIsSafe(presentation) {
  const authority = plainObject(presentation?.authority);
  if (!authority) return false;
  return authority.productContractMayCreateScheduler === false
    && authority.productContractMayCreateBuildWorker === false
    && authority.productContractMayMutateSource === false
    && authority.productContractMayMerge === false
    && authority.productContractMayDeploy === false
    && authority.productContractMayMutateWindows === false
    && authority.productContractMayMutateOpenClaw === false
    && authority.productContractMaySpend === false
    && authority.productContractMayChangeExternalAccount === false
    && authority.productContractMayWidenAgentAuthority === false
    && authority.constructionExecutionOwner === 'existing-goal-flywheel-and-qualified-construction-machinery'
    && authority.operatorConsequentialAuthorityPreserved === true;
}

function invalid(errors) {
  return Object.freeze({
    schemaVersion: STEPHANOS_IMPROVEMENT_RICH_RESPONSE_EXTENSION_SCHEMA_VERSION,
    valid: false,
    extensionId: null,
    improvementLineage: null,
    structured: null,
    authority: authorityBoundary(),
    errors: Object.freeze([...new Set(errors)]),
  });
}

function alternativeOptions(proposal, evidenceRefs) {
  const alternatives = list(proposal?.alternatives, 12);
  const output = [];
  for (const entry of alternatives) {
    const item = plainObject(entry);
    if (!item) continue;
    const changeId = text(item.changeId, 256);
    const label = text(item.summary, 1_000);
    if (!SAFE_REF.test(changeId) || !label) continue;
    const tradeoffParts = [
      text(item.benefit, 1_000) ? `Benefit: ${text(item.benefit, 1_000)}` : '',
      text(item.risk, 1_000) ? `Risk: ${text(item.risk, 1_000)}` : '',
      `Reversible: ${item.reversible === true ? 'YES' : 'NO'}`,
    ].filter(Boolean);
    output.push(Object.freeze({
      optionId: changeId,
      label,
      tradeoff: tradeoffParts.join(' · '),
      evidenceRefs,
    }));
  }
  return Object.freeze(output);
}

function approvalStateFor(presentation, evidenceRefs) {
  const authorityNeeded = uniqueStrings(presentation?.authorityNeeded, 16, 128).map((entry) => entry.toUpperCase());
  const authorizationState = text(presentation?.authorizationState, 128).toUpperCase() || 'PROPOSAL_ONLY';
  const materialAuthority = authorityNeeded.filter((entry) => entry !== 'PROPOSAL_ONLY');
  let state = 'NOT_REQUIRED';
  if (materialAuthority.length > 0) {
    if (authorizationState === 'PROPOSAL_ONLY') state = 'REQUIRED';
    else if (materialAuthority.includes(authorizationState)) state = 'APPROVED';
    else state = 'PENDING';
  }
  return Object.freeze({ state, approvalRef: '', evidenceRefs });
}

function unresolvedItems(presentation) {
  const output = [];
  const evidence = plainObject(presentation?.evidence);
  const proposal = plainObject(presentation?.proposal);
  const proof = plainObject(presentation?.proof);
  const rootCauseState = text(evidence?.rootCauseState, 128).toUpperCase();
  if (rootCauseState && rootCauseState !== 'KNOWN' && rootCauseState !== 'CONFIRMED') {
    output.push(`Improvement root cause remains ${rootCauseState}.`);
  }
  if (!text(presentation?.existingOwner, 256)) {
    output.push('No existing canonical owner is yet established for this improvement gap.');
  }
  if (!text(proposal?.recommendedChange, 2_000) || text(proposal?.recommendedChange, 2_000) === 'No change selected yet.') {
    output.push('No evidence-backed improvement change has been selected yet.');
  }
  for (const required of uniqueStrings(proof?.required, 32, 512)) {
    output.push(`Required proof before completion: ${required}`);
  }
  return Object.freeze([...new Set(output)]);
}

export function buildStephanosImprovementRichResponseExtensionV1(input = {}) {
  try {
    const request = plainObject(input);
    const presentation = plainObject(request?.improvementPresentation);
    if (!request || !presentation) return invalid(['improvement-presentation-required']);
    if (presentation.schemaVersion !== STEPHANOS_GOVERNED_IMPROVEMENT_SCHEMA_VERSION) {
      return invalid(['improvement-presentation-schema-mismatch']);
    }
    if (presentation.kind !== STEPHANOS_IMPROVEMENT_PRESENTATION_KIND) {
      return invalid(['improvement-presentation-kind-mismatch']);
    }
    if (!presentationAuthorityIsSafe(presentation)) {
      return invalid(['improvement-presentation-authority-must-remain-governed']);
    }

    const improvementId = text(presentation.improvementId, 256);
    if (!SAFE_REF.test(improvementId)) return invalid(['improvement-lineage-invalid']);
    const gap = plainObject(presentation.gap);
    const evidence = plainObject(presentation.evidence);
    const proposal = plainObject(presentation.proposal);
    const riskRollback = plainObject(presentation.riskRollback);
    const progress = plainObject(presentation.progress);
    const proof = plainObject(presentation.proof);
    if (!gap || !evidence || !proposal || !riskRollback || !progress || !proof) {
      return invalid(['improvement-presentation-sections-required']);
    }

    const evidenceRefs = Object.freeze([...new Set([
      ...safeRefs(evidence.refs, 64),
      ...safeRefs(evidence.researchRefs, 64),
      ...safeRefs(proof.completedRefs, 64),
    ])]);
    const currentOwner = text(presentation.existingOwner, 256);
    if (currentOwner && !SAFE_REF.test(currentOwner)) return invalid(['existing-owner-ref-invalid']);

    const riskSummary = [
      text(riskRollback.riskClass, 128) ? `Risk: ${text(riskRollback.riskClass, 128)}` : '',
      text(riskRollback.blastRadius, 512) ? `Blast radius: ${text(riskRollback.blastRadius, 512)}` : '',
      text(riskRollback.reversibility, 128) ? `Reversibility: ${text(riskRollback.reversibility, 128)}` : '',
      text(riskRollback.rollbackPlan, 1_500) ? `Rollback: ${text(riskRollback.rollbackPlan, 1_500)}` : '',
    ].filter(Boolean).join(' · ');
    const progressSummary = [
      text(progress.status, 128) ? `Status: ${text(progress.status, 128)}` : '',
      text(progress.nextAction, 256) ? `Next: ${text(progress.nextAction, 256)}` : '',
      text(progress.reason, 512) ? `Reason: ${text(progress.reason, 512)}` : '',
    ].filter(Boolean).join(' · ');
    const rationale = [text(proposal.whyThisChange, 1_500), riskSummary, progressSummary].filter(Boolean).join(' | ');

    const structured = Object.freeze({
      goalsMissions: Object.freeze([Object.freeze({
        ref: currentOwner || improvementId,
        label: text(gap.summary, 1_000) || 'Stephanos governed improvement',
        state: text(progress.status, 128) || 'PROPOSAL',
        evidenceRefs,
      })]),
      agentProviderContributions: Object.freeze([]),
      unknowns: unresolvedItems(presentation),
      options: alternativeOptions(proposal, evidenceRefs),
      recommendedAction: Object.freeze({
        actionId: `improve:${improvementId}:next`,
        label: text(proposal.recommendedChange, 1_000) || 'Review the bounded improvement proposal.',
        rationale: rationale || text(gap.whyItMatters, 1_500) || 'Improvement remains proposal-only until its evidence and authority gates are satisfied.',
        requiresApproval: approvalStateFor(presentation, evidenceRefs).state === 'NOT_REQUIRED' ? 'NO' : 'YES',
        evidenceRefs,
      }),
      approvalState: approvalStateFor(presentation, evidenceRefs),
      visualisationCandidates: Object.freeze([STEPHANOS_IMPROVEMENT_PRESENTATION_KIND]),
    });

    const improvementLineage = Object.freeze({
      improvementId,
      gapSource: text(gap.source, 128) || 'UNKNOWN',
      existingOwner: currentOwner || null,
      researchRoute: text(evidence.researchRoute, 128) || 'NO_RESEARCH_NEEDED_KNOWN_REPAIR',
      progressStatus: text(progress.status, 128) || 'PROPOSAL',
      nextAction: text(progress.nextAction, 256),
      authorityNeeded: uniqueStrings(presentation.authorityNeeded, 16, 128),
      authorizationState: text(presentation.authorizationState, 128) || 'PROPOSAL_ONLY',
      completedProofCount: safeRefs(proof.completedRefs, 64).length,
      requiredProofCount: uniqueStrings(proof.required, 32, 512).length,
      constructionExecutionOwnedHere: false,
      constructionExecutionOwner: 'existing-goal-flywheel-and-qualified-construction-machinery',
    });
    const core = Object.freeze({
      schemaVersion: STEPHANOS_IMPROVEMENT_RICH_RESPONSE_EXTENSION_SCHEMA_VERSION,
      improvementLineage,
      structured,
      authority: authorityBoundary(),
    });
    return Object.freeze({
      ...core,
      valid: true,
      extensionId: `improvement-rich-extension-${digest(core).slice(0, 24)}`,
      errors: Object.freeze([]),
    });
  } catch {
    return invalid(['improvement-rich-response-extension-failed-closed']);
  }
}
