#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const sourcePath = 'shared/agents/sharedWorkspaceScopedDeliveryStatusV1.mjs';
const testPath = 'shared/agents/sharedWorkspaceScopedDeliveryStatusV1.test.mjs';

async function replaceExact(path, before, after) {
  const current = await readFile(path, 'utf8');
  const matches = current.split(before).length - 1;
  if (matches !== 1) throw new Error(`EXPECTED_EXACTLY_ONE_SEAM:${path}:${matches}`);
  const updated = current.replace(before, after);
  if (updated === current) throw new Error(`REPLACEMENT_NOOP:${path}`);
  await writeFile(path, updated, 'utf8');
}

await replaceExact(
  sourcePath,
`  if (repository !== FIXED_REPOSITORY) errors.push('repository-not-allowlisted');
  if (!prNumber) errors.push('invalid-pr-number');
  if (!FULL_SHA.test(mergeCommit)) errors.push('invalid-merge-commit');
  if (text(input.deploymentRequestId) && deploymentRequestId !== text(input.deploymentRequestId)) errors.push('invalid-deployment-request-id');
  if (text(input.featureId) && featureId !== text(input.featureId)) errors.push('invalid-feature-id');`,
`  if (repository !== FIXED_REPOSITORY) errors.push('repository-not-allowlisted');
  if (!prNumber) errors.push('invalid-pr-number');
  if (!FULL_SHA.test(mergeCommit)) errors.push('invalid-merge-commit');
  if (!deploymentRequestId || deploymentRequestId !== text(input.deploymentRequestId)) errors.push('invalid-deployment-request-id');
  if (!featureId || featureId !== text(input.featureId)) errors.push('invalid-feature-id');`,
);

await replaceExact(
  testPath,
`  assert.equal(validateDeliveryStatusSubject({ ...SUBJECT, command: 'dir' }).ok, false);
  assert.equal(validateDeliveryStatusSubject({ ...SUBJECT, deploymentRequestId: 'bad request id' }).ok, false);
});`,
`  assert.equal(validateDeliveryStatusSubject({ ...SUBJECT, command: 'dir' }).ok, false);
  assert.equal(validateDeliveryStatusSubject({ ...SUBJECT, deploymentRequestId: 'bad request id' }).ok, false);
  assert.equal(validateDeliveryStatusSubject({ ...SUBJECT, deploymentRequestId: undefined }).ok, false);
  assert.equal(validateDeliveryStatusSubject({ ...SUBJECT, featureId: undefined }).ok, false);
});`,
);

console.log('SCOPED_DELIVERY_REQUIRED_SELECTOR_REPAIR_APPLIED');
