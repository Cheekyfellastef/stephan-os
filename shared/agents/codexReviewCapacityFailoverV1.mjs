import fs from 'node:fs';

export const CODEX_REVIEW_CAPACITY_FAILOVER_SCHEMA = 'stephanos.codex-review-capacity-failover.v1';
export const CODEX_REVIEW_CAPACITY_STATE = Object.freeze({
  UNAVAILABLE: 'PROVIDER_CAPACITY_UNAVAILABLE',
  NO_SIGNAL: 'NO_PROVIDER_CAPACITY_SIGNAL',
});
export const CODEX_REVIEW_FAILOVER_ROUTE = 'GITHUB_ACTIONS_INDEPENDENT_REVIEW';

const TRUSTED_CODEX_REVIEWER = Object.freeze({
  login: 'chatgpt-codex-connector[bot]',
  type: 'Bot',
  id: 199175422,
});
const MAX_COMMENT_BYTES = 8 * 1024;
const QUOTA_PATTERNS = Object.freeze([
  /reached your Codex usage limits for code reviews/i,
  /Codex[^\n]{0,80}(?:usage|rate)[^\n]{0,40}limit[^\n]{0,80}code reviews?/i,
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function exactTrustedActor(actor = {}) {
  return text(actor.login).toLowerCase() === TRUSTED_CODEX_REVIEWER.login
    && text(actor.type).toLowerCase() === TRUSTED_CODEX_REVIEWER.type.toLowerCase()
    && Number(actor.id) === TRUSTED_CODEX_REVIEWER.id;
}

function boundedQuotaBody(value) {
  const body = text(value);
  if (!body || Buffer.byteLength(body, 'utf8') > MAX_COMMENT_BYTES) return false;
  return QUOTA_PATTERNS.some((pattern) => pattern.test(body));
}

export function classifyCodexReviewCapacityFailoverV1(event = {}) {
  const isCreatedPrComment = text(event?.action).toLowerCase() === 'created'
    && event?.issue?.pull_request
    && typeof event.issue.pull_request === 'object'
    && !Array.isArray(event.issue.pull_request);
  const trustedActor = exactTrustedActor(event?.comment?.user);
  const quotaSignal = boundedQuotaBody(event?.comment?.body);
  const detected = Boolean(isCreatedPrComment && trustedActor && quotaSignal);

  return Object.freeze({
    schemaVersion: CODEX_REVIEW_CAPACITY_FAILOVER_SCHEMA,
    kind: 'stephanos.review-provider-capacity-event.v1',
    detected,
    provider: 'CODEX',
    capabilityClass: 'EXACT_HEAD_REVIEW',
    capacityState: detected
      ? CODEX_REVIEW_CAPACITY_STATE.UNAVAILABLE
      : CODEX_REVIEW_CAPACITY_STATE.NO_SIGNAL,
    routingDisposition: detected
      ? 'CONTINUE_PROVIDER_NEUTRAL_REVIEW'
      : 'NO_ROUTING_CHANGE',
    selectedRoute: detected ? CODEX_REVIEW_FAILOVER_ROUTE : null,
    commentId: detected && Number.isSafeInteger(Number(event?.comment?.id))
      ? Number(event.comment.id)
      : null,
    prNumber: detected && Number.isSafeInteger(Number(event?.issue?.number))
      ? Number(event.issue.number)
      : null,
    reviewEvidence: false,
    reviewAcceptanceAllowed: false,
    sameMissionRequired: true,
    samePrRequired: true,
    sameHeadRequired: true,
    duplicateDispatchAllowed: false,
    sourceMutationAuthority: false,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    finalVerdict: detected
      ? 'CODEX_REVIEW_CAPACITY_UNAVAILABLE_ROUTE_AROUND'
      : 'NO_CODEX_REVIEW_CAPACITY_FAILOVER_SIGNAL',
  });
}

function appendOutput(name, value) {
  const outputPath = text(process.env.GITHUB_OUTPUT);
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `${name}=${String(value ?? '').replace(/\r?\n/g, ' ')}\n`, 'utf8');
}

function appendSummary(result) {
  const summaryPath = text(process.env.GITHUB_STEP_SUMMARY);
  if (!summaryPath) return;
  const lines = result.detected
    ? [
      '## Provider capacity failover',
      '',
      'Progress: `PROVIDER_CAPACITY_UNAVAILABLE`',
      '',
      `Codex code-review capacity is unavailable for PR #${result.prNumber}.`,
      `Route: \`${result.selectedRoute}\`.`,
      '',
      'The quota notice is capacity telemetry only and can never satisfy review. The existing provider-neutral exact-head review machinery continues on the same PR/head and retains all independent/specialist and operator-approval gates.',
    ]
    : [
      '## Provider capacity failover',
      '',
      'Progress: `NO_PROVIDER_CAPACITY_SIGNAL`',
      '',
      'No authenticated Codex code-review capacity outage signal was present. Existing provider-neutral review routing is unchanged.',
    ];
  fs.appendFileSync(summaryPath, `${lines.join('\n')}\n`, 'utf8');
}

export function runCodexReviewCapacityFailoverCliV1({ eventPath = process.env.GITHUB_EVENT_PATH } = {}) {
  const path = text(eventPath);
  if (!path) throw new Error('GITHUB_EVENT_PATH is required');
  const raw = fs.readFileSync(path, 'utf8');
  if (Buffer.byteLength(raw, 'utf8') > 1024 * 1024) throw new Error('GitHub event exceeds bounded capacity-signal input');
  const event = JSON.parse(raw);
  const result = classifyCodexReviewCapacityFailoverV1(event);
  console.log(`CODEX_REVIEW_CAPACITY_FAILOVER=${result.finalVerdict}`);
  appendOutput('detected', result.detected ? 'true' : 'false');
  appendOutput('capacity_state', result.capacityState);
  appendOutput('selected_route', result.selectedRoute ?? '');
  appendOutput('comment_id', result.commentId ?? '');
  appendSummary(result);
  return result;
}

if (process.argv[1] && new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname) {
  try {
    runCodexReviewCapacityFailoverCliV1();
  } catch (error) {
    console.error(`CODEX_REVIEW_CAPACITY_FAILOVER_BLOCKED=${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
