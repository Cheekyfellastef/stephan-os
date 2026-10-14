// A fixed, independently inspected pilot source for the existing Skill Forge.
// A source pin is an identity assertion, not install, execution or trust authority.
// Never permit caller-provided repository, commit, path, target, license or blob overrides.
import { createHash } from 'node:crypto';
import { assessExternalSkillIntakeV1 } from './externalSkillIntakeV1.mjs';

export const CURATED_SKILL_CATALOG_SCHEMA = 'stephanos.curated-external-skill-source.v1';
export const CURATED_PILOT = Object.freeze({
  id: 'openai-skill-creator',
  name: 'OpenAI Skill Creator, Stephanos Local pilot',
  registry: 'openai',
  repositoryUrl: 'https://github.com/openai/skills',
  revision: '49f948faa9258a0c61caceaf225e179651397431',
  skillPath: 'skills/.system/skill-creator/SKILL.md',
  expectedGitBlobSha1: '72bc0b97e7a6476254a9d5c424c9971748402ec3',
  licensePath: 'skills/.system/skill-creator/LICENSE.txt',
  licenseGitBlobSha1: 'd645695673349e3947e8e5ae42332d0ac3164cd7',
  licenseSpdxClaim: 'Apache-2.0',
  publisher: 'OpenAI',
  targetActor: 'openclaw-local',
  importDisposition: 'REVIEW_ONLY_NOT_INSTALLED',
  sourceUrl: 'https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.system/skill-creator/SKILL.md',
  licenseUrl: 'https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.system/skill-creator/LICENSE.txt',
});

// Git content address of the exact supplied bytes, without decoding Markdown
// or modifying line endings. The upstream digest is pinned at candidate intake.
export function gitBlobSha1OfBytes(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? '');
  return createHash('sha1')
    .update(Buffer.from('blob ' + b.length + '\0'))
    .update(b)
    .digest('hex');
}

export function reviewCuratedSourcePilotV1(id, sourceBytes) {
  if (id !== CURATED_PILOT.id) return Object.freeze({
    schemaVersion: CURATED_SKILL_CATALOG_SCHEMA, verdict: 'BLOCKED',
    blocker: 'CURATED_SOURCE_NOT_ALLOWLISTED', canInstall: false, activated: false,
  });
  if (!Buffer.isBuffer(sourceBytes) || sourceBytes.length < 1 || sourceBytes.length > 65536) {
    return Object.freeze({
      schemaVersion: CURATED_SKILL_CATALOG_SCHEMA, verdict: 'BLOCKED',
      blocker: 'CURATED_BYTES_NOT_ADMITTED', canInstall: false, activated: false,
    });
  }
  const actualGitBlobSha1 = gitBlobSha1OfBytes(sourceBytes);
  if (actualGitBlobSha1 !== CURATED_PILOT.expectedGitBlobSha1) return Object.freeze({
    schemaVersion: CURATED_SKILL_CATALOG_SCHEMA, verdict: 'BLOCKED',
    blocker: 'UPSTREAM_PINNED_SKILL_BYTES_MISMATCH',
    observedGitBlobSha1: actualGitBlobSha1,
    expectedGitBlobSha1: CURATED_PILOT.expectedGitBlobSha1,
    canInstall: false, activated: false,
  });
  // Input comes from an already-approved offline staging route.
  // No GitHub fetch, shell, filesystem writes, installation or target promotion.
  const candidate = assessExternalSkillIntakeV1({
    name: CURATED_PILOT.name,
    targetActor: CURATED_PILOT.targetActor,
    skillMd: sourceBytes.toString('utf8'),
    source: {
      registry: CURATED_PILOT.registry,
      repositoryUrl: CURATED_PILOT.repositoryUrl,
      revision: CURATED_PILOT.revision,
      skillPath: CURATED_PILOT.skillPath,
      publisher: CURATED_PILOT.publisher,
      licenseSpdx: CURATED_PILOT.licenseSpdxClaim,
    },
  });
  return Object.freeze({
    schemaVersion: CURATED_SKILL_CATALOG_SCHEMA,
    verdict: candidate.status === 'DRAFT' ? 'SOURCE_BYTES_PIN_MATCHED_REVIEW_REQUIRED' : 'BLOCKED',
    blocker: candidate.status === 'DRAFT' ? '' : 'CURATED_SKILL_STRUCTURE_BLOCKED',
    sourcePinMatched: true,
    pinnedGitBlobSha1: CURATED_PILOT.expectedGitBlobSha1,
    sourceUrl: CURATED_PILOT.sourceUrl,
    licenseUrl: CURATED_PILOT.licenseUrl,
    licenseGitBlobSha1: CURATED_PILOT.licenseGitBlobSha1,
    candidate,
    canInstall: false,
    canExecute: false,
    canGrantPermissions: false,
    activated: false,
  });
}
