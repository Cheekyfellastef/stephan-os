// Source-only reconciliation policy for seed #3096.
// This module does not interact with operating system resources.
export function reconcileLlamaGovernorV1(state) {
  const gaming = state?.gamingActive === true || state?.questActive === true;
  const known = state?.governorHealthy === true
    && typeof state?.gamingActive === 'boolean'
    && typeof state?.questActive === 'boolean';
  const needsCustody = !known || gaming || state?.custodyConfirmed !== true;
  return Object.freeze({
    denyNewInference: true,
    needsCustody,
    qualified: false,
    reason: !known ? 'GOVERNOR_UNCERTAIN'
      : gaming ? 'GAMING_PRIORITY'
      : needsCustody ? 'CUSTODY_NOT_PROVEN' : 'PRODUCTION_HOLD',
  });
}
