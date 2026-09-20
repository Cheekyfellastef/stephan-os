import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { adjudicateOpenClawTaskClassPromotionCandidateV1 } from '../../shared/agents/openClawTaskClassPromotionCandidateV1.mjs';
import {
  createSharedWorkspaceStatusRecord,
  resolveSharedWorkspacePath,
  writeAtomicJson,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';

export const OPENCLAW_PROVIDER_PROMOTION_STATUS_FILE = 'openclaw-provider-promotion-current.json';
export const OPENCLAW_PROVIDER_PROMOTION_STATUS_ID = 'openclaw-provider-promotion-current';
export const OPENCLAW_PROVIDER_PROMOTION_PUBLICATION_SCHEMA = 'stephanos.openclaw-provider-promotion-publication.v1';
export const OPENCLAW_SOURCE_CONSTRUCTION_BLOCKER = 'OPENCLAW_OC3_SOURCE_CONSTRUCTION_NOT_QUALIFIED';

const OPENCLAW_PROVIDER_GOAL = '#1725';
const MAX_PROOF_AGE_MS = 10 * 60 * 1000;
const MAX_PROOFS_PER_DIRECTORY = 256;
const SAFE_PROOF_FILE = /^oc[12]-[A-Za-z0-9._-]{1,120}\.json$/;
const SAFE_RECEIPT_REF = /^receipts\/([A-Za-z0-9][A-Za-z0-9._-]{0,80})\.json$/;
const PROOF_DIRECTORIES = Object.freeze(['openclaw-oc1', 'openclaw-oc2']);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function timestampMs(value) {
  const normalized = text(value);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) return NaN;
  return Date.parse(normalized);
}

function sourceConstructionState() {
  return Object.freeze({
    eligible: false,
    blocker: OPENCLAW_SOURCE_CONSTRUCTION_BLOCKER,
    ownerGoal: OPENCLAW_PROVIDER_GOAL,
    requiredTaskClass: 'OC3_BOUNDED_REPAIR',
    reason: 'OC1/OC2 proof may qualify their own bounded task classes, but it does not prove source-mutation authority or OC3 bounded repair capability.',
    sourceMutationAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
  });
}

function receiptRefFromProviderProof(record = {}) {
  let body;
  try {
    body = JSON.parse(text(record.body));
  } catch {
    return '';
  }
  const artifacts = Array.isArray(body?.artifacts) ? body.artifacts : [];
  for (const artifact of artifacts) {
    const normalized = text(artifact).replace(/\\/g, '/');
    const match = SAFE_RECEIPT_REF.exec(normalized);
    if (match) return `receipts/${match[1]}.json`;
  }
  return '';
}

async function readJson(path, readFileImpl) {
  try {
    return JSON.parse(await readFileImpl(path, 'utf8'));
  } catch {
    return null;
  }
}

async function readProofDirectory({ root, repoRoot, directory, readFileImpl, readdirImpl }) {
  const resolved = resolveSharedWorkspacePath({ root, repoRoot, segments: ['proofs', directory] });
  if (!resolved.ok) return Object.freeze({ ok: false, reason: resolved.reason, records: Object.freeze([]) });
  let names;
  try {
    names = await readdirImpl(resolved.path);
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({ ok: true, reason: 'OPENCLAW_PROMOTION_PROOF_DIRECTORY_EMPTY', records: Object.freeze([]) });
    return Object.freeze({ ok: false, reason: 'OPENCLAW_PROMOTION_PROOF_DIRECTORY_READ_FAILED', records: Object.freeze([]) });
  }
  const safeNames = names.map(String).filter((name) => SAFE_PROOF_FILE.test(name));
  if (safeNames.length > MAX_PROOFS_PER_DIRECTORY) {
    return Object.freeze({ ok: false, reason: 'OPENCLAW_PROMOTION_PROOF_DIRECTORY_OVERSIZED', records: Object.freeze([]) });
  }
  const records = [];
  for (const name of safeNames) {
    const record = await readJson(join(resolved.path, name), readFileImpl);
    if (record) records.push(Object.freeze({ directory, name, record }));
  }
  return Object.freeze({ ok: true, reason: 'OPENCLAW_PROMOTION_PROOFS_READ', records: Object.freeze(records) });
}

async function readExecutionReceiptForProof({ root, repoRoot, proofRecord, readFileImpl }) {
  const receiptRef = receiptRefFromProviderProof(proofRecord);
  if (!receiptRef) return Object.freeze({ ok: false, reason: 'OPENCLAW_PROMOTION_EXECUTION_RECEIPT_REF_MISSING', receipt: null, receiptRef: '' });
  const [, fileName] = receiptRef.split('/');
  const resolved = resolveSharedWorkspacePath({ root, repoRoot, segments: ['receipts', fileName] });
  if (!resolved.ok) return Object.freeze({ ok: false, reason: resolved.reason, receipt: null, receiptRef });
  const workspaceRecord = await readJson(resolved.path, readFileImpl);
  const receipt = workspaceRecord?.executionReceipt;
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return Object.freeze({ ok: false, reason: 'OPENCLAW_PROMOTION_EXECUTION_RECEIPT_INVALID', receipt: null, receiptRef });
  }
  return Object.freeze({ ok: true, reason: 'OPENCLAW_PROMOTION_EXECUTION_RECEIPT_READ', receipt, receiptRef });
}

async function currentPromotionCandidate({ root, repoRoot, nowUtc, readFileImpl, readdirImpl }) {
  const nowMs = timestampMs(nowUtc);
  if (!Number.isFinite(nowMs)) return Object.freeze({ ok: false, reason: 'OPENCLAW_PROMOTION_NOW_INVALID', candidate: null, proofRecord: null });

  const proofEntries = [];
  for (const directory of PROOF_DIRECTORIES) {
    const result = await readProofDirectory({ root, repoRoot, directory, readFileImpl, readdirImpl });
    if (!result.ok) return Object.freeze({ ok: false, reason: result.reason, candidate: null, proofRecord: null });
    proofEntries.push(...result.records);
  }
  proofEntries.sort((left, right) => timestampMs(right.record?.timestampUtc) - timestampMs(left.record?.timestampUtc));

  let lastReason = 'OPENCLAW_PROMOTION_NO_PROVIDER_PROOF';
  for (const entry of proofEntries) {
    const proofTimestampMs = timestampMs(entry.record?.timestampUtc);
    if (!Number.isFinite(proofTimestampMs) || proofTimestampMs > nowMs || nowMs - proofTimestampMs > MAX_PROOF_AGE_MS) {
      lastReason = 'OPENCLAW_PROMOTION_PROVIDER_PROOF_STALE';
      continue;
    }
    const execution = await readExecutionReceiptForProof({ root, repoRoot, proofRecord: entry.record, readFileImpl });
    if (!execution.ok) {
      lastReason = execution.reason;
      continue;
    }
    const candidate = adjudicateOpenClawTaskClassPromotionCandidateV1({
      executionReceipt: execution.receipt,
      providerProofRecord: entry.record,
      observedAtUtc: entry.record.timestampUtc,
    });
    if (candidate.ok === true) {
      return Object.freeze({
        ok: true,
        reason: 'OPENCLAW_PROMOTION_CURRENT',
        candidate,
        proofRecord: entry.record,
        receiptRef: execution.receiptRef,
      });
    }
    lastReason = text(candidate.reason, 'OPENCLAW_PROMOTION_ADJUDICATION_BLOCKED');
  }
  return Object.freeze({ ok: false, reason: lastReason, candidate: null, proofRecord: null });
}

function promotionStatusRecord({ current, nowUtc }) {
  const candidate = current?.candidate;
  const qualification = candidate?.qualificationReceipt || null;
  const sourceConstruction = sourceConstructionState();
  const promoted = current?.ok === true && candidate?.ok === true;
  const timestampUtc = promoted ? qualification.observedAtUtc : nowUtc;
  const proofRefs = promoted ? qualification.proofRefs : [];
  return Object.freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: OPENCLAW_PROVIDER_PROMOTION_STATUS_ID,
      participantId: 'stephanos',
      timestampUtc,
      relatedIssue: '1725',
      status: promoted ? 'TASK_CLASS_PROMOTION_CURRENT' : 'WAITING_FOR_QUALIFYING_EVIDENCE',
      summary: promoted
        ? `OpenClaw ${qualification.taskClass} has fresh real-work promotion evidence; OC3 source construction remains separately unqualified.`
        : `OpenClaw task-class promotion is held: ${text(current?.reason, 'no qualifying proof')}; OC3 source construction remains separately unqualified.`,
      proofRefs,
    }),
    publicationSchemaVersion: OPENCLAW_PROVIDER_PROMOTION_PUBLICATION_SCHEMA,
    promotionDisposition: promoted ? candidate.disposition : 'BLOCKED',
    promotionReason: text(current?.reason, 'OPENCLAW_PROMOTION_NO_PROVIDER_PROOF'),
    qualificationReceipt: promoted ? qualification : null,
    realWorkExecutionReceipt: promoted ? candidate.realWorkWorkspaceReceipt?.executionReceipt ?? null : null,
    realWorkWorkspaceReceipt: promoted ? candidate.realWorkWorkspaceReceipt : null,
    qualificationAuthorityReceipt: promoted ? candidate.qualificationAuthorityReceipt : null,
    sourceConstruction,
    authority: Object.freeze({
      providerPoolAdmissionAllowed: false,
      providerQualificationAuthority: false,
      sourceMutationAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      runtimeMutationAllowed: false,
    }),
  });
}

export async function refreshOpenClawProviderPromotionTruth({
  root,
  repoRoot,
  nowUtc = new Date().toISOString(),
  readFileImpl = readFile,
  readdirImpl = readdir,
  writeAtomicJsonImpl = writeAtomicJson,
} = {}) {
  const current = await currentPromotionCandidate({ root, repoRoot, nowUtc, readFileImpl, readdirImpl });
  const statusRecord = promotionStatusRecord({ current, nowUtc });
  const statusWrite = await writeAtomicJsonImpl(
    root,
    ['status', OPENCLAW_PROVIDER_PROMOTION_STATUS_FILE],
    statusRecord,
    { repoRoot, nowMs: timestampMs(statusRecord.timestampUtc) },
  );
  if (!statusWrite?.ok) {
    return Object.freeze({
      ok: false,
      reason: text(statusWrite?.reason, 'OPENCLAW_PROMOTION_STATUS_WRITE_FAILED'),
      promotion: current.candidate,
      statusRecord,
      statusWrite,
      authorityWrite: null,
      sourceConstruction: statusRecord.sourceConstruction,
    });
  }

  let authorityWrite = null;
  const authorityReceipt = current.candidate?.qualificationAuthorityReceipt;
  if (current.ok === true && authorityReceipt) {
    authorityWrite = await writeAtomicJsonImpl(
      root,
      ['receipts', `${authorityReceipt.receiptId}.json`],
      authorityReceipt,
      { repoRoot, nowMs: timestampMs(authorityReceipt.timestampUtc) },
    );
    if (!authorityWrite?.ok) {
      return Object.freeze({
        ok: false,
        reason: text(authorityWrite?.reason, 'OPENCLAW_PROMOTION_AUTHORITY_WRITE_FAILED'),
        promotion: current.candidate,
        statusRecord,
        statusWrite,
        authorityWrite,
        sourceConstruction: statusRecord.sourceConstruction,
      });
    }
  }

  return Object.freeze({
    ok: true,
    reason: current.ok ? 'OPENCLAW_PROMOTION_TRUTH_PUBLISHED' : current.reason,
    promotion: current.candidate,
    statusRecord,
    statusWrite,
    authorityWrite,
    sourceConstruction: statusRecord.sourceConstruction,
  });
}
