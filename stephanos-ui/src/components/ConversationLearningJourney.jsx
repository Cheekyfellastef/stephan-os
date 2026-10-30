import { deriveConversationLearningJourneyV1 } from '../../../shared/runtime/conversationLearningJourneyV1.mjs';
import './ConversationLearningJourney.css';

const STAGES = Object.freeze([
  { id: 'history', label: 'Conversation', detail: 'Canonical durable turns' },
  { id: 'hints', label: 'Discover', detail: 'Detected conversation hints' },
  { id: 'investigate', label: 'Investigate', detail: 'Eligible for governed review' },
  { id: 'pickup', label: 'Build pickup', detail: 'Execution receipt required' },
  { id: 'prove', label: 'Prove', detail: 'Live completion proof required' },
]);

function displayNumber(value) {
  return value === null ? 'UNKNOWN' : String(value);
}

export default function ConversationLearningJourney({ uplift = null, feedState = 'unavailable', placement = 'flywheel' }) {
  const view = deriveConversationLearningJourneyV1({ uplift, feedState });
  const values = {
    history: view.indexedTurns,
    hints: view.gapHints,
    investigate: view.investigationEligible,
    pickup: view.builderPickups,
    prove: view.provenImprovements,
  };
  const observed = view.state === 'REPORTED';
  return (
    <section className={'conversation-learning-journey conversation-learning-journey--' + placement}
      data-testid={placement + '-conversation-learning-journey'}
      aria-label="Conversation intelligence to proven builds">
      <header className="conversation-learning-journey__header">
        <div>
          <span className="conversation-learning-journey__eyebrow">KNOWLEDGE → CAPABILITY → PROOF</span>
          <h4>Conversation Intelligence · Improvement Journey</h4>
          <p>Turn accumulated discussions into investigation leads, then require genuine builder and runtime evidence before claiming an upgrade.</p>
        </div>
        <span className={'conversation-learning-journey__truth ' + (observed ? 'is-reported' : 'is-unknown')}
          data-testid={placement + '-conversation-intelligence-truth'}>
          {view.state}
        </span>
      </header>
      <div className="conversation-learning-journey__steps" aria-label="Evidence journey stages">
        {STAGES.map((step, index) => (
          <div className="conversation-learning-journey__step" key={step.id}
            data-testid={placement + '-conversation-stage-' + step.id}>
            <small className="conversation-learning-journey__step-top">{String(index + 1).padStart(2, '0')} · {step.label}</small>
            <strong className={values[step.id] === null ? 'is-unknown' : 'is-reported'}>
              {displayNumber(values[step.id])}
            </strong>
            <span>{step.detail}</span>
          </div>
        ))}
      </div>
      <div className="conversation-learning-journey__status" role="status">
        <strong>{view.reason}</strong>
        <span>Builder pickup, admitted goals and completed improvements remain UNKNOWN until a conversation-linked receipt exists. Do not read missing proof as zero work.</span>
      </div>
      {view.candidates.length > 0 ? (
        <div className="conversation-learning-journey__hints">
          <h5>Leading investigation hints</h5>
          <div className="conversation-learning-journey__hint-grid">
            {view.candidates.slice(0, 5).map(candidate => (
              <article key={candidate.id} className="conversation-learning-journey__hint">
                <strong>{candidate.title}</strong>
                <span>{candidate.mentions ?? 'UNKNOWN'} matching turns · {candidate.evidenceCount} provenance references</span>
                <small>{candidate.readyForInvestigation ? 'Eligible for bounded investigation, not admitted' : 'Needs more evidence'}</small>
              </article>
            ))}
          </div>
        </div>
      ) : <p className="conversation-learning-journey__empty">
        No verified conversation hints available in this feed. This does not establish that no capability gaps exist.
      </p>}
      <p className="conversation-learning-journey__fineprint">{view.provenanceNote}</p>
    </section>
  );
}
