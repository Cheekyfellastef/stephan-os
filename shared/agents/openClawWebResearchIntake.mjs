const URL_PATTERN = /https?:\/\/[^\s)\]}>"']+/gi;
const PLACEHOLDER_PATTERNS = [/<\s*answer\s*>/i, /<\s*\/\s*answer\s*>/i, /\{\{[^}]+\}\}/, /\bTODO_PLACEHOLDER\b/i];
const FORBIDDEN_PATTERNS = [
  /\b(i\s+)?(edited|modified|changed|wrote|created|deleted|removed|renamed)\b[^.\n]*(file|repo|source|code|component|module|test)/i,
  /\b(git\s+(add|commit|push|merge|checkout|reset|clean)|committed|pushed)\b/i,
  /\b(run|ran|execute|executed|running)\b[^.\n]*(command|npm|node|git|service|server)/i,
  /\b(auto[- ]?start(?:ed|ing)?|started\s+(a\s+)?(service|server|daemon|background))\b/i,
  /\b(mutate|mutation|write access|repo mutation)\b[^.\n]*(enabled|allowed|granted|available)/i,
];
const GENERIC_BOILERPLATE_PATTERNS = [
  /\bstephanos\s+os\s+is\s+(a\s+)?(launcher|mission|operating)/i,
  /\bopenclaw\s+(control\s+bridge|builder\s+harness|is\s+an\s+agent)/i,
  /\boperator\s+relief\b/i,
  /\bbuilder\s+mesh\b/i,
  /\bcommand\s+deck\b/i,
];
const VR_FRAME_PATTERNS = [/\bvr\b/i, /\bvirtual\s+reality\b/i, /\bflat[- ]?to[- ]?vr\b/i, /\bstarfield\b/i, /\bstereo(?:scopic)?\b/i, /\bdepth\b/i, /\b3d\s+reconstruction\b/i];
const TECHNIQUE_PATTERNS = [/\btaxonomy\b/i, /\btechnique/i, /\bgeometry\b/i, /\bshader\b/i, /\bdepth\b/i, /\bstereo\b/i, /\bmod\b/i, /\binjection\b/i, /\bunknowns?\b/i, /\bconfidence\b/i];

export const OPENCLAW_VR_RESEARCH_PROMPT = `OpenClaw bounded web research task: VR Research Lab flat-to-VR conversion scout.\n\nAuthority and safety:\n- You are a read-only web research scout. Do not edit files, run commands, commit, push, start services, or claim mutation authority.\n- If web access is unavailable, begin with WEB_ACCESS_UNAVAILABLE and stop rather than answering from memory.\n- Do not invent URLs. Every source claim must include a source URL.\n\nRequired output frame:\n1. Web access status: available or WEB_ACCESS_UNAVAILABLE.\n2. Source URLs: list every source URL used.\n3. Technique taxonomy: flat-to-VR conversion methods, including stereo/depth reconstruction, shader or engine injection, geometry reconstruction, modding hooks, and limitations.\n4. Starfield VR relevance: what appears applicable, blocked, or unknown for Starfield/Creation Engine-style flatscreen-to-VR work.\n5. Unknowns and verification gaps.\n6. Knowledge-graph seed: entities, techniques, tools/projects, claims, and source URLs.\n7. Confidence by section: low / medium / high with why.\n\nReturn source-cited research only. No build plan, no repo mutation, no commands.`;

function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function cleanUrl(url) {
  return String(url || '').replace(/[.,;:!?]+$/g, '');
}

function extractUrls(text) {
  return unique((text.match(URL_PATTERN) || []).map(cleanUrl));
}

function hasSourceList(text) {
  return /(?:^|\n)\s*(?:#{1,4}\s*)?(sources?|references?|source\s+urls?)\s*[:\n-]/i.test(text)
    || /(?:^|\n)\s*(?:[-*]|\d+[.)])\s*https?:\/\//im.test(text);
}

function inferTechnicalConfidence(text, { validUrlCount = 0, placeholderLeakageDetected = 'no', forbiddenLeakageDetected = 'no', taskFrameAdherence = 'unknown' } = {}) {
  const field = text.match(/confidence(?:\s+by\s+section)?\s*[:=-]\s*([^\n]+)/i);
  if (field) {
    const found = field[1].match(/\b(low|medium|high)\b/i);
    if (found) return found[1].toLowerCase();
  }
  if (placeholderLeakageDetected === 'yes' || forbiddenLeakageDetected === 'yes') return 'low';
  if (taskFrameAdherence === 'pass' && validUrlCount >= 3) return 'medium';
  if (validUrlCount > 0) return 'low';
  return 'unknown';
}

function assessTaskFrameAdherence(text, { requestedTaskFrame = 'vr-research', webUnavailable = false } = {}) {
  if (!text) return 'unknown';
  const lower = text.toLowerCase();
  const genericHits = GENERIC_BOILERPLATE_PATTERNS.filter((pattern) => pattern.test(text)).length;
  if (requestedTaskFrame === 'vr-research') {
    const vrHits = VR_FRAME_PATTERNS.filter((pattern) => pattern.test(text)).length;
    const techniqueHits = TECHNIQUE_PATTERNS.filter((pattern) => pattern.test(text)).length;
    if (webUnavailable) return 'needs-review';
    if (genericHits >= 2 && (vrHits < 2 || techniqueHits < 2)) return 'fail';
    if (vrHits >= 2 && techniqueHits >= 2 && /\bsource|https?:\/\//i.test(text)) return 'pass';
    if (vrHits >= 1 || techniqueHits >= 1) return 'needs-review';
    if (/\bopenclaw|stephanos|builder mesh|operator relief\b/i.test(lower)) return 'fail';
  }
  return genericHits >= 2 ? 'fail' : 'needs-review';
}

export function createOpenClawWebResearchIntakeProjection(overrides = {}) {
  return {
    status: 'idle',
    webAccessStatus: 'unknown',
    sourceCount: 0,
    validUrlCount: 0,
    inventedUrlRisk: 'unknown',
    taskFrameAdherence: 'unknown',
    forbiddenLeakageDetected: 'no',
    placeholderLeakageDetected: 'no',
    technicalConfidence: 'unknown',
    mutationAuthority: 'locked',
    autoStart: 'forbidden',
    operatorApprovalRequired: 'yes',
    recommendedUse: 'research-only',
    resultTrustedForCanon: 'no',
    nextOperatorAction: 'Copy the bounded prompt, run OpenClaw externally/manually, then paste source-cited results for deterministic intake.',
    warnings: [],
    blockers: [],
    sourceUrls: [],
    cleanedHandoffPacket: '',
    defaultPrompt: OPENCLAW_VR_RESEARCH_PROMPT,
    ...overrides,
    mutationAuthority: 'locked',
    autoStart: 'forbidden',
    operatorApprovalRequired: 'yes',
    recommendedUse: 'research-only',
    resultTrustedForCanon: 'no',
  };
}

export function judgeOpenClawWebResearchResult(rawText = '', options = {}) {
  const text = asText(rawText, '');
  const urls = extractUrls(text);
  const webUnavailable = /\bWEB_ACCESS_UNAVAILABLE\b/.test(text);
  const sourceListPresent = hasSourceList(text);
  const placeholderLeakageDetected = PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text)) ? 'yes' : 'no';
  const forbiddenLeakageDetected = FORBIDDEN_PATTERNS.some((pattern) => pattern.test(text)) ? 'yes' : 'no';
  const taskFrameAdherence = assessTaskFrameAdherence(text, { requestedTaskFrame: options.requestedTaskFrame || 'vr-research', webUnavailable });
  const missingCitations = !webUnavailable && (!sourceListPresent || urls.length === 0);
  const blockers = [];
  const warnings = [];
  if (!text) warnings.push('No OpenClaw research result has been pasted.');
  if (webUnavailable) warnings.push('OpenClaw reported WEB_ACCESS_UNAVAILABLE; do not trust the result as web research.');
  if (missingCitations) blockers.push('Source URLs/citations are missing.');
  if (placeholderLeakageDetected === 'yes') blockers.push('Placeholder/template leakage detected.');
  if (forbiddenLeakageDetected === 'yes') blockers.push('Forbidden mutation/command/autostart claim detected.');
  if (taskFrameAdherence === 'fail') blockers.push('Result drifted away from the requested research task frame.');
  if (taskFrameAdherence === 'needs-review') warnings.push('Task-frame adherence needs manual review.');
  const webAccessStatus = webUnavailable ? 'unavailable' : (urls.length > 0 ? 'claimed-unverified' : 'unknown');
  const inventedUrlRisk = urls.length === 0 ? (webUnavailable ? 'low' : 'high') : (sourceListPresent ? 'medium' : 'high');
  let status = 'awaiting-result';
  if (text) status = 'result-pasted';
  if (text && blockers.length > 0) status = 'failed';
  else if (text && (warnings.length > 0 || webUnavailable || webAccessStatus === 'claimed-unverified')) status = 'needs-review';
  if (text && blockers.length === 0 && warnings.length === 0 && taskFrameAdherence === 'pass' && urls.length > 0) status = 'passed';
  const technicalConfidence = inferTechnicalConfidence(text, { validUrlCount: urls.length, placeholderLeakageDetected, forbiddenLeakageDetected, taskFrameAdherence });
  const nextOperatorAction = status === 'passed'
    ? 'Manually review the cited sources before promoting any claim to canon or creating a build task.'
    : status === 'failed'
      ? 'Reject this OpenClaw result for canon/build routing and request a corrected source-cited read-only research result.'
      : webUnavailable
        ? 'Treat web access as unavailable/unverified; use Codex/manual research fallback before canon promotion.'
        : 'Review warnings and require operator approval before any canon or build-task promotion.';
  const cleanedHandoffPacket = JSON.stringify({
    packetType: 'OpenClaw Web Research Intake Handoff',
    status,
    webAccessStatus,
    sourceUrls: urls,
    sourceCount: urls.length,
    validUrlCount: urls.length,
    taskFrameAdherence,
    placeholderLeakageDetected,
    forbiddenLeakageDetected,
    resultTrustedForCanon: 'no',
    mutationAuthority: 'locked',
    recommendedUse: 'research-only',
    nextOperatorAction,
  }, null, 2);
  return createOpenClawWebResearchIntakeProjection({
    status,
    webAccessStatus,
    sourceCount: urls.length,
    validUrlCount: urls.length,
    inventedUrlRisk,
    taskFrameAdherence,
    forbiddenLeakageDetected,
    placeholderLeakageDetected,
    technicalConfidence,
    nextOperatorAction,
    warnings,
    blockers,
    sourceUrls: urls,
    sourceListPresent: sourceListPresent ? 'yes' : 'no',
    missingCitations: missingCitations ? 'yes' : 'no',
    cleanedHandoffPacket,
    rawResultPresent: text ? 'yes' : 'no',
  });
}

export function buildOpenClawWebResearchIntakeProjection(input = {}) {
  const raw = input.rawResult || input.openClawWebResearchResult || input.openClawResearchText || '';
  if (!asText(raw, '')) return createOpenClawWebResearchIntakeProjection(input.overrides || {});
  return judgeOpenClawWebResearchResult(raw, input);
}
