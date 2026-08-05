import { readFileSync } from 'node:fs';
import { issueOpenClawGitHubAuthorization } from '../shared/agents/openClawGitHubAuthorization.mjs';
import { buildOpenClawGitHubOperation } from '../shared/agents/openClawGitHubOperator.mjs';

function fail(message, details = {}) {
  process.stdout.write(`${JSON.stringify({ finalVerdict: 'BLOCKED', message, ...details }, null, 2)}\n`);
  process.exit(1);
}

const claimsPath = process.argv[2];
if (!claimsPath) fail('Usage: node scripts/stephanos-issue-openclaw-github-authorization.mjs <claims.json>');

const privateKeyPath = process.env.STEPHANOS_GITHUB_AUTH_PRIVATE_KEY_PATH;
if (!privateKeyPath) fail('STEPHANOS_GITHUB_AUTH_PRIVATE_KEY_PATH is required.');

let claims;
let privateKeyPem;
try {
  claims = JSON.parse(readFileSync(claimsPath, 'utf8'));
  privateKeyPem = readFileSync(privateKeyPath, 'utf8');
} catch (error) {
  fail('Authorization claims or private key could not be read.', { error: error.message });
}

const preview = buildOpenClawGitHubOperation(claims);
const previewBlockers = preview.blockers.filter((blocker) => {
  if (claims.operation !== 'merge-pr') return true;
  return ![
    'Pull request head SHA changed or could not be verified.',
    'Pull request must be mergeable.',
    'Every required check must report success.',
    'Exact operator squash-merge approval token is required.',
  ].includes(blocker);
});
if (previewBlockers.length) {
  fail('Stephanos refused to authorize an invalid GitHub operation.', {
    blockers: previewBlockers,
  });
}

const envelope = issueOpenClawGitHubAuthorization(claims, privateKeyPem);
if (envelope.finalVerdict !== 'STEPHANOS_AUTHORIZATION_ISSUED') {
  fail('Stephanos could not issue GitHub authorization.', { envelope });
}

process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
