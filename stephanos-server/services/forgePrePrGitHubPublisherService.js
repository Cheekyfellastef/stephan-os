import {
  verifyOpenClawGitHubAuthorization,
  reserveOpenClawGitHubAuthorization,
  completeOpenClawGitHubAuthorizationReservation,
} from '../../shared/agents/openClawGitHubAuthorization.mjs';
import { verifyForgePrePrPublicationEvidence } from '../../shared/agents/forgePrePrPublicationV1.mjs';

export const FORGE_PRE_PR_GITHUB_PUBLISHER_SCHEMA = 'stephanos.forge-pre-pr-github-publisher.v1';
const SHA = /^[0-9a-f]{40}$/;
const fail = (reason, details = {}) => Object.freeze({
  schemaVersion: FORGE_PRE_PR_GITHUB_PUBLISHER_SCHEMA,
  ok: false, reason, mergeAuthority: false, forcePushAllowed: false, ...details,
});
const same = (a, b) => String(a ?? '') === String(b ?? '');

export function verifyForgePublicationGrant(envelope, publicKeyPem, proof, nowUtc) {
  const verified = verifyOpenClawGitHubAuthorization(envelope, publicKeyPem, { now: new Date(nowUtc) });
  if (verified.finalVerdict !== 'STEPHANOS_AUTHORIZATION_VERIFIED')
    return fail('SIGNED_PUBLICATION_GRANT_INVALID', { blockers: verified.blockers });
  const grant = verified.claims;
  const bindings = {
    operation: 'publish-forge-escrow',
    missionId: proof.missionId,
    repository: proof.repository,
    branch: proof.branch,
    issueNumber: proof.issueNumber,
    parentHead: proof.parentHead,
    resultTree: proof.resultTree,
  };
  const mismatches = Object.entries(bindings).filter(([key, value]) => !same(grant?.[key], value));
  if (mismatches.length || grant.mergeAuthority !== false || grant.forcePushAllowed !== false)
    return fail('SIGNED_PUBLICATION_GRANT_BINDING_MISMATCH', {
      blockers: [...mismatches.map(([key]) => key), ...(grant.mergeAuthority !== false ? ['mergeAuthority'] : []),
        ...(grant.forcePushAllowed !== false ? ['forcePushAllowed'] : [])],
    });
  return Object.freeze({ ok: true, grant, verification: verified });
}

// The API adapter is deliberately narrow: only create blob/tree/commit/ref/PR,
// and read exact remote refs/commits. No updateRef, merge, force, delete or shell.
export async function publishForgePrePrToGitHub({
  escrow, outbox, bundleBytes, authorization, publicKeyPem, receiptRoot,
  githubApi, nowUtc = new Date().toISOString(),
} = {}) {
  if (!githubApi || [
    'getMain', 'getBranch', 'listOpenPulls', 'createBlob', 'createTree',
    'createCommit', 'createBranch', 'getCommit', 'createPullRequest',
  ].some((key) => typeof githubApi[key] !== 'function')) return fail('BOUNDED_GITHUB_API_REQUIRED');
  const [main, existingBranch, existingPrs] = await Promise.all([
    githubApi.getMain(escrow?.repository),
    githubApi.getBranch(escrow?.repository, escrow?.canonicalBranch),
    githubApi.listOpenPulls(escrow?.repository, escrow?.canonicalBranch),
  ]);
  const proof = verifyForgePrePrPublicationEvidence({
    escrow, outbox, bundleBytes, nowUtc,
    canonicalRemote: {
      repository: escrow?.repository,
      branch: escrow?.canonicalBranch,
      branchExists: Boolean(existingBranch),
      mainHead: main?.sha,
      mainTree: main?.treeSha,
    },
  });
  if (!proof.ok) return fail('EXACT_ESCROW_OR_PARENT_INVALID', { blockers: proof.blockers });
  if (!Array.isArray(existingPrs) || existingPrs.length !== 0)
    return fail('PREEXISTING_PULL_REQUEST_CONFLICT');
  const grant = verifyForgePublicationGrant(authorization, publicKeyPem, proof, nowUtc);
  if (!grant.ok) return grant;
  const reserved = reserveOpenClawGitHubAuthorization(receiptRoot, grant.verification, new Date(nowUtc));
  if (reserved.finalVerdict !== 'AUTHORIZATION_RESERVED')
    return fail('PUBLICATION_GRANT_ALREADY_USED_OR_UNAVAILABLE', { blockers: reserved.blockers });
  try {
    const treeEntries = [];
    for (const entry of proof.entries) {
      if (entry.sha === null) {
        treeEntries.push({ path: entry.path, mode: '100644', type: 'blob', sha: null });
      } else {
        const created = await githubApi.createBlob(proof.repository, {
          content: entry.contentBase64, encoding: 'base64',
        });
        if (created?.sha !== entry.expectedBlobSha) throw new Error('GITHUB_CREATED_BLOB_HASH_MISMATCH');
        treeEntries.push({ path: entry.path, mode: entry.mode, type: 'blob', sha: created.sha });
      }
    }
    const tree = await githubApi.createTree(proof.repository, {
      base_tree: proof.parentTree, tree: treeEntries,
    });
    if (tree?.sha !== proof.resultTree) throw new Error('GITHUB_CREATED_TREE_HASH_MISMATCH');
    const commit = await githubApi.createCommit(proof.repository, {
      message: escrow.commitMessage, tree: proof.resultTree, parents: [proof.parentHead],
    });
    if (!SHA.test(String(commit?.sha || ''))) throw new Error('GITHUB_COMMIT_SHA_INVALID');
    const created = await githubApi.createBranch(proof.repository, {
      ref: 'refs/heads/' + proof.branch, sha: commit.sha,
    });
    if (created?.object?.sha !== commit.sha) throw new Error('GITHUB_CREATED_REF_NOT_EXACT');
    const observed = await githubApi.getCommit(proof.repository, commit.sha);
    if (observed?.sha !== commit.sha || observed?.tree?.sha !== proof.resultTree
        || observed?.parents?.length !== 1 || observed.parents[0]?.sha !== proof.parentHead)
      throw new Error('GITHUB_COMMIT_PROOF_MISMATCH');
    const pull = await githubApi.createPullRequest(proof.repository, {
      head: proof.branch, base: 'main', draft: true,
      title: 'Forge: ' + proof.missionId,
      body: 'Source artifact: ' + escrow.completeArtifactSha256
        + '\nParent: ' + proof.parentHead + '\nTree: ' + proof.resultTree
        + '\nRelates to #' + proof.issueNumber
        + '\nGenerated source requires independent acceptance review. Merge not authorised.',
    });
    if (!Number.isSafeInteger(pull?.number) || pull.number < 1
        || pull.head?.sha !== commit.sha) throw new Error('PULL_REQUEST_HEAD_PROOF_MISMATCH');
    completeOpenClawGitHubAuthorizationReservation(reserved, 'CONSUMED', new Date());
    return Object.freeze({
      schemaVersion: FORGE_PRE_PR_GITHUB_PUBLISHER_SCHEMA,
      ok: true, repository: proof.repository, branch: proof.branch,
      commitSha: commit.sha, exactResultTree: proof.resultTree,
      prNumber: pull.number, draft: true, sourceArtifactSha256: escrow.completeArtifactSha256,
      mergeAuthority: false, forcePushAllowed: false,
      finalVerdict: 'FORGE_PRE_PR_DRAFT_PUBLISHED_WITH_EXACT_TREE_PROOF',
    });
  } catch (caught) {
    completeOpenClawGitHubAuthorizationReservation(reserved, 'BLOCKED', new Date());
    return fail('GITHUB_PUBLICATION_BLOCKED', {
      blocker: String(caught?.message || caught),
      evidencePreserved: true,
      grantConsumed: true,
    });
  }
}
