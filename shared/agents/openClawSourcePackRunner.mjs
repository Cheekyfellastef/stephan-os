const URL_PATTERN = /https?:\/\/[^\s)\]}>'"]+/gi;
const PLACEHOLDER_PATTERNS = [
  /<\s*(?:answer|response|your\s+response|your\s+question)\s*>/i,
  /<\s*\/\s*(?:answer|response|your\s+response|your\s+question)\s*>/i,
  /\{\{[^}]+\}\}/,
];
const ASKS_FOR_NEXT_PATTERNS = [
  /\bsay\s+next\b/i,
  /\bask\s+away\b/i,
  /\bprovide\s+next\b/i,
  /\b(type|send)\s+next\b/i,
  /\bwhen\s+you(?:'re| are)\s+ready\b[^.\n]*(?:next|continue)/i,
];
const MUTATION_CLAIM_PATTERNS = [
  /\b(i\s+)?(edited|modified|changed|wrote|created|deleted|removed|renamed)\b[^.\n]*(file|repo|source|code|component|module|test)/i,
  /\b(i\s+)?(ran|run|executed|started|launched)\b[^.\n]*(command|npm|node|git|shell|test|build|service|server)/i,
  /\b(git\s+(add|commit|push|merge|checkout|reset|clean)|committed|pushed|opened\s+a\s+pr|created\s+a\s+pull\s+request)\b/i,
  /\b(mutation|write access|repo mutation)\b[^.\n]*(enabled|allowed|granted|available)/i,
  /\b(auto[- ]?start(?:ed|ing)?|background\s+service|daemon)\b/i,
];
const WEB_RESEARCH_CLAIM_PATTERNS = [
  /\b(i\s+)?(browsed|searched|looked\s+up|visited|fetched|scraped)\b[^.\n]*(web|internet|url|site|page|source)/i,
  /\bweb\s+research\b[^.\n]*(complete|performed|found|shows|indicates)/i,
];
const REQUIRED_SECTIONS = [
  'SOURCE_PACK_STATUS',
  'SUMMARY',
  'USEFUL_FACTS',
  'UNKNOWNS',
  'RISKS',
  'NEXT_RESEARCH_QUESTIONS',
  'STEPHANOS_HANDOFF_PACKET',
];

export const OPENCLAW_SOURCE_PACK_ROUTE = 'stephanos-scout / llama3.2 CLI';
export const OPENCLAW_SOURCE_PACK_MODEL = 'ollama/llama3.2:3b';

export const OPENCLAW_SOURCE_PACK_TEMPLATE = `SOURCE PACK START

Topic:
[topic]

Source 1 title:
[title]

Source 1 URL:
[url or none]

Source 1 notes:
[paste source text here]

TASK:
Extract only what is supported by the source pack.
Do not add general knowledge unless clearly marked as unverified.
Return SOURCE_PACK_STATUS, SUMMARY, USEFUL_FACTS, UNKNOWNS, RISKS, NEXT_RESEARCH_QUESTIONS, and STEPHANOS_HANDOFF_PACKET.

SOURCE PACK END`;

export const OPENCLAW_SOURCE_PACK_CLI_PROMPT = `OpenClaw Source Pack Runner V1

Route and model:
- agent: stephanos-scout
- model: ollama/llama3.2:3b
- route: CLI only
- use a fresh session key when possible

Authority boundaries:
- Read-only analysis only.
- Do not run commands.
- Do not edit files.
- Do not browse unless explicit browser/web access is separately proven by the operator; for this task, assume no browsing.
- Do not commit, push, open PRs, start services, store secrets, or claim mutation authority.
- Analyze only the pasted SOURCE PACK text between SOURCE PACK START and SOURCE PACK END.
- Do not invent sources, URLs, facts, repo state, tests, commits, files changed, or external observations.
- Mark anything not supported by the source pack as unknown.
- Do not ask the operator to say "next" and do not include continuation boilerplate such as "ask away" or "provide next".
- Do not use placeholder/template blocks such as <answer>, <response>, <your response>, or <your question>.
- Do not output code fences unless explicitly asked.
- Output structured sections only.

Required output sections, in order:
SOURCE_PACK_STATUS
SUMMARY
USEFUL_FACTS
UNKNOWNS
RISKS
NEXT_RESEARCH_QUESTIONS
STEPHANOS_HANDOFF_PACKET

Source pack template to paste below:
${OPENCLAW_SOURCE_PACK_TEMPLATE}`;

function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function unique(values = []) {
  const seen = new Set();
  return values.map((value) => asText(value, '').replace(/[.,;:!?]+$/g, '')).filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractUrls(text = '') {
  return unique(String(text).match(URL_PATTERN) || []);
}

function hasSection(text = '', section = '') {
  return new RegExp(`(?:^|\\n)\\s*(?:#{1,4}\\s*)?${section}\\s*[:\\n-]`, 'i').test(text);
}

function extractSectionBody(text = '', section = '') {
  const index = String(text).search(new RegExp(`(?:^|\\n)\\s*(?:#{1,4}\\s*)?${section}\\s*[:\\n-]?`, 'i'));
  if (index < 0) return '';
  const slice = String(text).slice(index);
  const next = REQUIRED_SECTIONS.filter((candidate) => candidate !== section)
    .map((candidate) => slice.search(new RegExp(`\\n\\s*(?:#{1,4}\\s*)?${candidate}\\s*[:\\n-]`, 'i')))
    .filter((pos) => pos > 0)
    .sort((a, b) => a - b)[0];
  return asText(next ? slice.slice(0, next) : slice, '');
}

function countSectionItems(text = '', section = '') {
  const body = extractSectionBody(text, section);
  if (!body) return 0;
  const withoutHeading = body.replace(new RegExp(`^\\s*(?:#{1,4}\\s*)?${section}\\s*[:\\n-]?`, 'i'), '').trim();
  if (!withoutHeading || /^\s*(none|n\/a|unknown|no useful facts)\s*\.?\s*$/i.test(withoutHeading)) return 0;
  const bullets = withoutHeading.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^(?:[-*]|\d+[.)])\s+\S/.test(line));
  if (bullets.length) return bullets.length;
  return withoutHeading.split(/[.;]\s+/).map((item) => item.trim()).filter(Boolean).length || 1;
}

function sourcePackHasSupportingSource(sourcePackText = '') {
  const sourceText = asText(sourcePackText, '');
  return Boolean(sourceText && (/SOURCE PACK START/i.test(sourceText) || /source\s+\d+\s+notes\s*:/i.test(sourceText) || /source\s+\d+\s+url\s*:/i.test(sourceText)));
}

export function judgeOpenClawSourcePackResult(rawText = '', options = {}) {
  const text = asText(rawText, '');
  const sourcePackText = asText(options.sourcePackText || options.openClawSourcePackText || '', '');
  const sourcePackUrls = extractUrls(sourcePackText);
  const resultUrls = extractUrls(text);
  const inventedUrls = resultUrls.filter((url) => !sourcePackUrls.includes(url));
  const sectionsPresent = REQUIRED_SECTIONS.filter((section) => hasSection(text, section));
  const usefulFactCount = countSectionItems(text, 'USEFUL_FACTS');
  const unknownCount = countSectionItems(text, 'UNKNOWNS');
  const riskCount = countSectionItems(text, 'RISKS');
  const nextQuestionCount = countSectionItems(text, 'NEXT_RESEARCH_QUESTIONS');
  const handoffPacketPresent = hasSection(text, 'STEPHANOS_HANDOFF_PACKET') && extractSectionBody(text, 'STEPHANOS_HANDOFF_PACKET').length > 'STEPHANOS_HANDOFF_PACKET'.length;
  const templateLeakageDetected = PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text)) ? 'yes' : 'no';
  const asksForNextDetected = ASKS_FOR_NEXT_PATTERNS.some((pattern) => pattern.test(text)) ? 'yes' : 'no';
  const mutationClaimDetected = MUTATION_CLAIM_PATTERNS.some((pattern) => pattern.test(text)) ? 'yes' : 'no';
  const webResearchClaimDetected = WEB_RESEARCH_CLAIM_PATTERNS.some((pattern) => pattern.test(text)) ? 'yes' : 'no';
  const hallucinatedSourcesDetected = inventedUrls.length > 0 ? 'yes' : 'no';
  const sourceBounded = !text ? 'unknown' : (hallucinatedSourcesDetected === 'yes' || mutationClaimDetected === 'yes' || (webResearchClaimDetected === 'yes' && !sourcePackHasSupportingSource(sourcePackText)) ? 'no' : (sectionsPresent.length >= 6 ? 'yes' : 'unknown'));
  const blockers = [];
  const warnings = [];
  if (!text) warnings.push('No OpenClaw source-pack result has been pasted.');
  if (sectionsPresent.length < REQUIRED_SECTIONS.length) blockers.push(`Missing required source-pack sections: ${REQUIRED_SECTIONS.filter((section) => !sectionsPresent.includes(section)).join(', ')}.`);
  if (templateLeakageDetected === 'yes') blockers.push('Placeholder/template leakage detected.');
  if (asksForNextDetected === 'yes') blockers.push('Continuation boilerplate detected.');
  if (hallucinatedSourcesDetected === 'yes') blockers.push(`Invented URL(s) not present in the source pack: ${inventedUrls.join(', ')}.`);
  if (mutationClaimDetected === 'yes') blockers.push('Mutation, command, commit, push, or PR creation claim detected.');
  if (webResearchClaimDetected === 'yes' && !sourcePackHasSupportingSource(sourcePackText)) blockers.push('Web research claim detected without supporting source-pack text/URL.');
  if (usefulFactCount < 1) blockers.push('No useful facts were extracted.');
  if (unknownCount < 1) blockers.push('No unknowns were marked.');
  if (!handoffPacketPresent) blockers.push('Stephanos handoff packet is missing.');
  if (sourceBounded === 'unknown' && text) warnings.push('Source-boundedness needs operator review.');
  let sourcePackStatus = 'idle';
  if (text) sourcePackStatus = 'pasted';
  if (text && blockers.length > 0) sourcePackStatus = 'failed';
  else if (text && warnings.length > 0) sourcePackStatus = 'needs-review';
  else if (text && usefulFactCount > 0 && unknownCount > 0 && handoffPacketPresent && sourceBounded === 'yes') sourcePackStatus = 'passed';
  const codexFallbackNeeded = sourcePackStatus === 'failed' ? 'yes' : (sourcePackStatus === 'passed' ? 'no' : (text ? 'unknown' : 'unknown'));
  const nextOperatorAction = sourcePackStatus === 'passed'
    ? 'Review the cleaned handoff; OpenClaw remains untrusted for canon/research until operator approval and cannot mutate.'
    : sourcePackStatus === 'failed'
      ? 'reject/reset/correct source-pack result'
      : text
        ? 'Review source-boundedness manually or rerun with the stricter Source Pack CLI Prompt.'
        : 'Copy the Source Pack CLI Prompt, run stephanos-scout / llama3.2 CLI in a fresh session, then paste the structured result.';
  const cleanedHandoffPacket = JSON.stringify({
    packetType: 'OpenClaw Source Pack Runner Handoff',
    sourcePackStatus,
    sourceBounded,
    usefulFactCount,
    unknownCount,
    riskCount,
    nextQuestionCount,
    handoffPacketPresent: handoffPacketPresent ? 'yes' : 'no',
    hallucinatedSourcesDetected,
    templateLeakageDetected,
    asksForNextDetected,
    trustedForCanon: 'no',
    trustedForResearch: 'no',
    mutationAuthority: 'locked',
    route: OPENCLAW_SOURCE_PACK_ROUTE,
    model: OPENCLAW_SOURCE_PACK_MODEL,
    nextOperatorAction,
  }, null, 2);
  return {
    sourcePackResultPresent: text ? 'yes' : 'no',
    sourcePackStatus,
    route: OPENCLAW_SOURCE_PACK_ROUTE,
    model: OPENCLAW_SOURCE_PACK_MODEL,
    sourceBounded,
    hallucinatedSourcesDetected,
    inventedUrls,
    templateLeakageDetected,
    asksForNextDetected,
    mutationClaimDetected,
    webResearchClaimDetected,
    usefulFactCount,
    unknownCount,
    riskCount,
    nextQuestionCount,
    handoffPacketPresent: handoffPacketPresent ? 'yes' : 'no',
    trustedForCanon: 'no',
    trustedForResearch: 'no',
    codexFallbackNeeded,
    nextOperatorAction,
    mutationAuthority: 'locked',
    autoStart: 'forbidden',
    operatorApprovalRequired: 'yes',
    blockers,
    warnings,
    requiredSectionsPresent: sectionsPresent,
    cleanedSourcePackHandoff: cleanedHandoffPacket,
    defaultPrompt: OPENCLAW_SOURCE_PACK_CLI_PROMPT,
    sourcePackTemplate: OPENCLAW_SOURCE_PACK_TEMPLATE,
  };
}

export function isOpenClawSourcePackRouteEligible({ routeId = '', routeLabel = '', exactResponseStatus = '', sourcePackStatus = '', routeTaskFrameStatus = '' } = {}) {
  const routeText = `${routeId} ${routeLabel}`.toLowerCase();
  const isLlamaCli = /cli-llama3\.2|stephanos-scout|llama3\.2/.test(routeText);
  const blockedRoute = /dashboard|qwen/.test(routeText);
  if (blockedRoute) return { eligible: 'no', reason: 'Dashboard and qwen routes remain blocked unless their own route sanity and task-frame proof pass.' };
  if (!isLlamaCli) return { eligible: 'no', reason: 'Only stephanos-scout / llama3.2 CLI is eligible for bounded source-pack processing.' };
  if (exactResponseStatus !== 'passed') return { eligible: 'no', reason: 'Exact-response sanity proof is required before source-pack recommendation.' };
  if (sourcePackStatus !== 'passed' && routeTaskFrameStatus !== 'passed') return { eligible: 'no', reason: 'A passing source-pack/task-frame intake is required before recommendation.' };
  return { eligible: 'yes', reason: 'Eligible only for bounded read-only source-pack processing; no research authority, canon trust, or mutation authority is granted.' };
}

export function buildOpenClawSourcePackRunnerProjection(input = {}) {
  return judgeOpenClawSourcePackResult(input.rawResult || input.openClawSourcePackResult || input.openClawSourcePackOutput || '', input);
}
