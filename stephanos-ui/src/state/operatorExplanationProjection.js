import { deriveOperatorReliefProjection } from './operatorReliefProjection.js';

function asList(v){return Array.isArray(v)?v.filter(Boolean):[];}
function asText(v,f='unknown'){const t=String(v??'').trim();return t||f;}

export function detectOperatorExplanationIntent(prompt='') {
  const text = String(prompt || '').toLowerCase();
  const compact = text.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const detailed = /\b(give me the detail|show evidence|detailed|full detail)\b/.test(compact);
  const patterns = [
    /what does (all )?this mean/, /what does that mean/, /what does the above mean/, /explain this/, /explain that/,
    /explain what just happened/, /translate the telemetry/, /translate that into monkey brain/, /monkey brain/, /operator view/,
    /summari[sz]e the snapshot/, /is this safe to merge/, /what is blocking us/, /what should i do next/,
    /explain the codex return/, /summari[sz]e mission state/
  ];
  return { matched: patterns.some((p) => p.test(compact)), mode: detailed ? 'detailed' : 'compact' };
}

export function buildOperatorExplanationProjection(models = {}, prompt = '') {
  const relief = deriveOperatorReliefProjection(models);
  const intent = detectOperatorExplanationIntent(prompt);
  const gaps = asList(relief.evidenceGaps).map((g) => g.label);
  const missingEvidence = [...new Set([...(relief.verificationReturnIntake?.missingEvidence || []), ...gaps])].slice(0, 6);
  const blocked = relief.verificationReturnIntake?.forbiddenArtifactRisk === true;
  const browserPending = relief.mergeSafety?.verdict === 'needs-browser-proof';
  const mergeCandidate = relief.mergeSafety?.verdict === 'safe-to-merge' && missingEvidence.length === 0;
  let verdict = 'unknown / evidence missing';
  let mergeSafety = 'unknown';
  if (blocked) { verdict = 'blocked / do not merge'; mergeSafety = 'blocked'; }
  else if (browserPending) { verdict = 'source-clean but proof-pending'; mergeSafety = 'review-required'; }
  else if (mergeCandidate) { verdict = 'merge candidate, operator approval required'; mergeSafety = 'review-required'; }
  else if (missingEvidence.length > 0) { verdict = 'review-required / missing proof'; mergeSafety = 'review-required'; }

  const nextOperatorAction = relief.missionApprovalQueue?.topRecommendation?.title || relief.nextBestAction?.label || 'Review evidence and decide.';
  const nextCodexAction = relief.missionBrainNextAction?.codexPromptCandidate || relief.agentWorkRoutingProjection?.promptPayload || '';
  const sourceEvidence = [
    'operator_relief.missionBrainNextAction', 'operator_relief.verificationReturnIntake', 'operator_relief.mergeSafety',
    'proof_of_done.verificationJudge', 'support_snapshot.aiConsoleScrollDiagnostics'
  ];
  const plain = blocked
    ? 'Blocked. Do not merge until forbidden/generated/runtime artifacts are removed and proof is rebuilt.'
    : (browserPending
      ? 'Source-side work can be clean, but browser proof is still required before merge.'
      : (mergeCandidate ? 'Evidence supports merge candidacy, but operator approval is still mandatory.' : 'Evidence is incomplete; keep this in review.'));
  const shortAnswer = `Verdict: ${verdict}. Next: ${nextOperatorAction}`;
  return {
    verdict,
    plainEnglishSummary: plain,
    whatMatters: [
      `Merge safety: ${asText(relief.mergeSafety?.verdict, 'unknown')}`,
      `Evidence gaps: ${asList(relief.evidenceGaps).length}`,
      `Browser proof missing: ${asList(relief.browserProof?.missingItems).length}`,
    ],
    riskSummary: relief.missionBrainNextAction?.riskLevel || 'medium',
    blockingIssues: missingEvidence,
    nextOperatorAction,
    nextCodexAction,
    mergeSafety,
    confidenceLevel: blocked ? 'proven' : (missingEvidence.length > 0 ? 'review-required' : 'likely'),
    missingEvidence,
    sourceEvidence,
    shortAnswer,
    detailedAnswer: `${plain}\nMissing evidence: ${missingEvidence.join(' | ') || 'none'}`,
    operatorAnalogy: browserPending ? 'The part is built, but it has not passed the window check yet.' : 'Preflight says mostly ready; pilot approval still required.',
    mode: intent.mode,
  };
}

export function formatOperatorExplanation(projection = {}, { mode = 'compact' } = {}) {
  const p = projection || {};
  const lines = [
    `Verdict: ${p.verdict || 'unknown'}`,
    'What matters:',
    ...(asList(p.whatMatters).slice(0, 3).map((item) => `- ${item}`)),
    `What this means: ${p.plainEnglishSummary || 'Evidence unavailable.'}`,
    `Risk: ${p.riskSummary || 'unknown'}`,
    `Next action: ${p.nextOperatorAction || 'Review evidence.'}`,
    `Codex action: ${asText(p.nextCodexAction, 'none')}`,
  ];
  if (mode === 'detailed') {
    lines.push(`Evidence: ${asList(p.sourceEvidence).join(', ') || 'none'}`);
    lines.push(`Missing proof: ${asList(p.missingEvidence).join(' | ') || 'none'}`);
  }
  lines.push(`Monkey-brain translation: ${p.operatorAnalogy || 'Unknown state; gather proof first.'}`);
  return lines.join('\n').slice(0, 2200);
}
