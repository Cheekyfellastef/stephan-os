import { execFileSync } from 'node:child_process';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function evaluateBrowserProofPreflight({ capture = git } = {}) {
  try {
    const branch = capture(['branch', '--show-current']);
    const upstream = capture(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    if (!branch || !upstream || upstream === '@{u}') {
      return { ok: false, blocker: 'no-upstream-tracking-branch', branch, upstream: upstream || '' };
    }
    return { ok: true, branch, upstream };
  } catch {
    return { ok: false, blocker: 'no-upstream-tracking-branch', branch: '', upstream: '' };
  }
}

function main() {
  const result = evaluateBrowserProofPreflight();
  if (result.ok) {
    console.log(`[stephanos:browser-proof] upstream tracking branch available: ${result.upstream}`);
    return;
  }
  console.error('STEPHANOS_BROWSER_PROOF_BLOCKER=no-upstream-tracking-branch');
  console.error('[stephanos:browser-proof] Playwright webServer ignition is blocked because the current branch has no upstream tracking branch. Do not treat this as UI proof. Run local manual Battle Bridge proof instead.');
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
