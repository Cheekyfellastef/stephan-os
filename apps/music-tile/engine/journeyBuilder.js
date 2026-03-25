import { mapSelectionToIntent, describeIntentVibe } from './intentMapper.js';
import { rankTracksForIntent, selectJourneyTracks } from './trackSelector.js';

export function buildJourney(selection, library) {
  const intent = mapSelectionToIntent(selection);
  const ranked = rankTracksForIntent(library, intent);
  const journey = selectJourneyTracks(ranked, intent, 6);

  return {
    intent,
    detectedVibe: describeIntentVibe(intent),
    ranked,
    journey
  };
}
