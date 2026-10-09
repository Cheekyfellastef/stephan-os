import './FlywheelSeedCanopy.css';

function truthClass(value = '') {
  const normalized = String(value || 'UNKNOWN').toUpperCase();
  if (['CURRENT', 'EVIDENCED', 'SOURCE_PROVEN', 'ACTIVE'].includes(normalized)) return 'current';
  if (['STALE', 'WAITING', 'AWAITING_LIVE_PROOF'].includes(normalized)) return 'stale';
  if (['CONFLICTING', 'BLOCKED', 'NEEDS_UPLIFT', 'DEGRADED'].includes(normalized)) return 'attention';
  return 'unknown';
}

function inferredRung(seed = {}) {
  if (Number.isInteger(seed.currentRungIndex)) return seed.currentRungIndex;
  const stage = String(seed.healthState || seed.stage || '').toUpperCase();
  if (/ITERATING|REPEAT|RATCHET/.test(stage)) return 5;
  if (/CAPABILITY_FORMING|VERIFY|REPLAN/.test(stage)) return 4;
  if (/LEARNING|REPAIR|MATERIAL_GAPS_PRESENT/.test(stage)) return 3;
  if (/OBSERVING|ACTIVE/.test(stage)) return 2;
  if (/GERMINATING|BOOTSTRAP/.test(stage)) return 1;
  return 0;
}

function proofCount(seed = {}) {
  return seed.proofCount ?? seed.proofRefs?.length ?? 'UNKNOWN';
}

function gapCount(seed = {}) {
  if (Array.isArray(seed.currentGaps)) return seed.currentGaps.length;
  return seed.knownMaterialGapCount ?? seed.capabilityGapCount ?? 'UNKNOWN';
}

function compactTitle(seed = {}) {
  if (seed.missionId === 'starfield-vr-outcome-ownership') return 'Starfield VR';
  if (seed.missionId === 'stephanos-whole-system-capability-closure') return 'Whole System';
  if (seed.missionId === 'stephanos-runs-the-project') return 'Project Foreman';
  if (seed.missionId === 'stephanos-flywheel-conversational-intelligence') return 'Conversation Intelligence';
  if (seed.missionId === 'sovereign-commander-safe-parity') return 'Sovereign Commander Parity';
  if (seed.missionId === 'stephanos-sovereign-meter-independence') return 'Meter Independence';
  return seed.title || seed.missionId || 'Outcome seed';
}

function rungsFor(seed = {}) {
  if (Array.isArray(seed.growthRungs) && seed.growthRungs.length) return seed.growthRungs;
  if (seed.missionId === 'starfield-vr-outcome-ownership') return ['PLANTED', 'OBSERVE', 'LEARN', 'FORM_CAPABILITY', 'ITERATE'];
  if (seed.missionId === 'stephanos-whole-system-capability-closure') return ['OBSERVE', 'DETECT', 'OWN', 'REPAIR', 'PROVE', 'REPLAN'];
  return ['PLANTED', 'OBSERVE', 'PROVE', 'IMPROVE', 'REPEAT'];
}

export default function FlywheelSeedCanopy({ seeds = [] }) {
  const visibleSeeds = Array.isArray(seeds) ? seeds.filter(Boolean) : [];

  return (
    <section className="seed-canopy" data-testid="flywheel-seed-canopy">
      <header className="seed-canopy__header">
        <div>
          <span className="uplift-kicker">LIVING OUTCOME GARDEN</span>
          <h4>Seed Canopy</h4>
          <p>Roots are blockers and evidence. The bright rung is where the seed has actually reached. Growth pressure points at the next rung.</p>
        </div>
        <div className="seed-canopy__counter">
          <strong>{visibleSeeds.length}</strong>
          <span>persistent seeds</span>
        </div>
      </header>

      <div className="seed-canopy__grid">
        {visibleSeeds.map((seed) => {
          const rungs = rungsFor(seed);
          const currentIndex = Math.min(Math.max(inferredRung(seed), 0), Math.max(0, rungs.length - 1));
          const live = seed.planted === true;
          const pressure = seed.pressureState || 'UNKNOWN';
          const status = live
            ? (seed.healthState || seed.stage || 'LIVE')
            : seed.declared
              ? 'CONTRACT READY · LIVE UNPROVEN'
              : 'UNKNOWN';
          return (
            <article className={"seed-canopy__card " + truthClass(seed.sourceTruth)} key={seed.missionId || seed.title}>
              <div className="seed-canopy__sky">
                <div className="seed-canopy__identity">
                  <span className="seed-canopy__glyph" aria-hidden="true">✦</span>
                  <div>
                    <small>{seed.issueRef || seed.issue || 'persistent outcome'}</small>
                    <h5>{compactTitle(seed)}</h5>
                  </div>
                </div>
                <span className={"seed-canopy__status " + truthClass(seed.sourceTruth)}>{status}</span>
              </div>

              <div className="seed-canopy__organism" aria-hidden="true">
                <div className="seed-canopy__crown">
                  <i /><i /><i /><i /><i />
                </div>
                <div className="seed-canopy__stem" />
                <div className="seed-canopy__seed">🌱</div>
                <div className="seed-canopy__roots"><i /><i /><i /></div>
              </div>

              <div className="seed-canopy__north-star">
                <span>NORTH STAR</span>
                <p>{seed.northStar || 'North star unavailable.'}</p>
              </div>

              {Array.isArray(seed.linkedImprovementWork) && seed.linkedImprovementWork.length > 0 ? (
                <div className="seed-canopy__linked-work" aria-label="Canonical linked improvement work">
                  <span>CONNECTED IMPROVEMENTS · NOT COMPLETION PROOF</span>
                  <ul>
                    {seed.linkedImprovementWork.map((work) => (
                      <li key={work.ref}>
                        <a
                          href={`https://github.com/Cheekyfellastef/stephan-os/${work.kind}/${work.ref.replace('#', '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={work.outcome}
                        >
                          <b>{work.ref}</b> {work.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="seed-canopy__rungs" aria-label={compactTitle(seed) + " growth rungs"}>
                {rungs.map((rung, index) => (
                  <span
                    className={index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'future'}
                    key={rung}
                    title={rung}
                  >
                    <b>{index + 1}</b>
                    <small>{String(rung).replaceAll('_', ' ')}</small>
                  </span>
                ))}
              </div>

              {seed.autonomyVerdict ? (
                <div className={"seed-canopy__verdict " + String(seed.autonomyVerdict || '').toLowerCase().replaceAll('_', '-')}>
                  <span>BUILDING ON ITS OWN?</span>
                  <strong>{String(seed.autonomyVerdict).replaceAll('_', ' ')}</strong>
                  <small>{seed.autonomyVerdictBasis || 'No verdict evidence published.'}</small>
                </div>
              ) : null}

              <div className="seed-canopy__telemetry">
                <div><span>Current rung</span><strong>{live ? (seed.currentRung || rungs[currentIndex] || 'UNKNOWN') : 'AWAITING LIVE PROOF'}</strong></div>
                <div><span>Growth pressure</span><strong className={truthClass(pressure)}>{pressure}</strong></div>
                <div><span>Open roots</span><strong>{live ? gapCount(seed) : 'UNKNOWN'}</strong></div>
                <div><span>Proof</span><strong>{live ? proofCount(seed) : 'UNKNOWN'}</strong></div>
                {seed.autonomyExcludedProofCount !== undefined ? (
                  <div><span>Autonomy-excluded</span><strong>{live ? seed.autonomyExcludedProofCount : 'UNKNOWN'}</strong></div>
                ) : null}
                {seed.autonomyEligibleProofCount !== undefined ? (
                  <div><span>Autonomy credit</span><strong>{live ? seed.autonomyEligibleProofCount : 'UNKNOWN'}</strong></div>
                ) : null}
              </div>

              <div className="seed-canopy__next">
                <span>NEXT RUNG</span>
                <strong>{seed.nextBestAction || 'Wait for canonical evidence before choosing the next rung.'}</strong>
              </div>

              <div className="seed-canopy__truth">
                <span>Contract <b>{seed.contractTruth || (seed.declared ? 'SOURCE_PROVEN' : 'UNKNOWN')}</b></span>
                <span>Live <b>{seed.sourceTruth || 'UNKNOWN'}</b></span>
                <span>Operator <b>{seed.operatorRole || 'protected approval'}</b></span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
