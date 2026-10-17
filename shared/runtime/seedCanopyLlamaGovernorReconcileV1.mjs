// Source-only reconciliation policy for seed #3096.
// This module does not interact with operating system resources.
export function reconcileLlamaGovernorV1(state) {
  const gaming = state?.gamingActive === true || state?.questActive === true;
  const known = state?.governorHealthy === true
    && typeof state?.gamingActive === 'boolean'
    && typeof state?.questActive === 'boolean';
  // The state input is not an authenticated Windows custody measurement.
  // A caller-supplied custodyConfirmed boolean can never prove that a router,
  // its descendants or its model have actually left the Battle Bridge.
  // A future qualified adapter must supply independently checked, signed
  // process/VRAM evidence through a separate, reviewed interface.
  const needsCustody = true;
  return Object.freeze({
    denyNewInference: true,
    needsCustody,
    qualified: false,
    reason: !known ? 'GOVERNOR_UNCERTAIN'
      : gaming ? 'GAMING_PRIORITY'
      : needsCustody ? 'CUSTODY_NOT_PROVEN' : 'PRODUCTION_HOLD',
  });
}
