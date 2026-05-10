function asArray(value) { return Array.isArray(value) ? value : []; }
function asObject(value) { return value && typeof value === 'object' ? value : {}; }

export function buildMusicMissionContext(state = {}) {
  const next = asObject(state);
  const discoveryPipeline = asObject(next.discoveryPipeline);
  const tasteDNA = asObject(next.tasteDNA);
  const listeningDeck = asArray(next.listeningDeck);
  const aiSuggestions = asArray(next.aiSuggestions);
  const aiSmarterJourney = asArray(next.aiSmarterJourney);
  const audit = asArray(next.aiCandidateAudit);
  const feedbackHistory = asArray(next.feedbackHistory);
  const recentEvents = asArray(next.presenceState?.recentEvents || next.recentEvents);
  const ratings = feedbackHistory.filter((entry) => entry && Object.prototype.hasOwnProperty.call(entry, 'id'));
  const dnaEntries = Object.entries(tasteDNA);
  const positives = dnaEntries.filter(([, meta]) => meta?.polarity !== 'negative').sort((a, b) => (b[1]?.weight || 0) - (a[1]?.weight || 0));
  const negatives = dnaEntries.filter(([, meta]) => meta?.polarity === 'negative').sort((a, b) => (b[1]?.weight || 0) - (a[1]?.weight || 0));
  const verification = {
    verified: asArray(discoveryPipeline.verifiedCandidates).length,
    searchOnly: asArray(discoveryPipeline.searchLeads).length,
    unverified: listeningDeck.filter((track) => String(track?.candidateVerificationStatus || '').includes('unverified')).length,
    notFound: audit.filter((entry) => entry?.status === 'not_found').length,
    hallucinated: audit.filter((entry) => String(entry?.status || '').includes('hallucinated')).length,
  };
  const spotifyVerifiedPlayableCount = listeningDeck.filter((track) => Boolean(track?.spotifyUrl || track?.spotifyUri)).length;
  const status = discoveryPipeline.query ? 'active' : 'idle';
  const currentArtistInput = String(next.lastDiscoveryMeta?.canonicalArtist || discoveryPipeline.query || '').trim();
  const currentTasteTarget = `${next.selection?.era || 'unknown-era'} · ${next.selection?.emotion || 'unknown-emotion'}`;
  const warnings = asArray(discoveryPipeline.warnings);
  const blockers = [];
  if (verification.searchOnly > verification.verified) blockers.push('Most candidates are still search leads.');
  if (verification.hallucinated > 0) blockers.push('Some AI candidates appear hallucinated.');
  if (spotifyVerifiedPlayableCount === 0 && listeningDeck.length > 0) blockers.push('Listening Deck has no verified Spotify links yet.');
  const setupStatus = asObject(next.integrationSetupSnapshot);
  const spotifySetup = {
    configured: Boolean(setupStatus.configured),
    status: setupStatus.status || 'unknown',
    missingSecrets: asArray(setupStatus.missingSecrets),
    nextAction: setupStatus.nextAction || 'Open Assisted Setup and retest Spotify resolver.',
    missionPacket: 'Enable Spotify Catalogue Search for Music Tile',
  };
  return {
    tile: 'music',
    title: 'Music Taste Cockpit',
    status,
    currentArtistInput,
    currentTasteTarget,
    plainEnglishSummary: `Music Tile is currently exploring ${currentArtistInput || 'no artist yet'}. Strongest positive traits are ${positives.slice(0, 3).map(([name]) => name).join(', ') || 'not established yet'}. Main blockers are ${blockers.join(' ') || 'no major blockers right now'}.`,
    tasteDNA: {
      strongestPositiveTraits: positives.slice(0, 5).map(([name, meta]) => ({ name, weight: Number(meta?.weight || 0) })),
      strongestNegativeTraits: negatives.slice(0, 5).map(([name, meta]) => ({ name, weight: Number(meta?.weight || 0) })),
      recentChanges: asArray(next.appliedTasteDnaChanges).slice(-5),
      anchors: asArray(next.selection?.anchors),
      rejects: negatives.slice(0, 5).map(([name]) => name),
      interestingSignals: asArray(next.pendingTasteDnaChanges).slice(0, 5),
    },
    discoveryPipeline: {
      query: discoveryPipeline.query || '',
      artistProfileStatus: discoveryPipeline.artistProfileStatus || 'unresolved',
      summary: discoveryPipeline.summary || 'No discovery pipeline summary yet.',
      verifiedCount: verification.verified,
      searchLeadCount: verification.searchOnly,
      aiSuggestionCount: aiSuggestions.length + aiSmarterJourney.length,
      fallbackCount: asArray(discoveryPipeline.fallbackCandidates).length,
      warnings,
      audit: audit.slice(-8),
    },
    listeningDeck: {
      count: listeningDeck.length,
      playableCount: spotifyVerifiedPlayableCount,
      unverifiedCount: verification.unverified,
      currentTopCards: listeningDeck.slice(0, 5).map((track) => ({ id: track?.id, artist: track?.artist, title: track?.title, verificationStatus: track?.candidateVerificationStatus || 'unknown' })),
      recentlyRated: ratings.slice(-5),
    },
    verification,
    ai: {
      transportStatus: next.aiRouteStatus || 'unknown',
      providerMetadataStatus: next.aiProviderMetadataStatus || 'unknown',
      responseMode: next.aiResponseMode || 'mixed',
      lastAiAction: next.aiLastAction || '',
      pendingSuggestions: asArray(next.pendingTasteDnaChanges).length,
      textFallbackActive: Boolean(next.aiTextFallbackActive),
    },
    spotify: {
      verifiedPlayableCount: spotifyVerifiedPlayableCount,
      missingLinkCount: Math.max(0, listeningDeck.length - spotifyVerifiedPlayableCount),
      searchOnlyCount: verification.searchOnly,
      setup: spotifySetup,
    },
    presence: {
      recentStephanosSays: recentEvents.slice(-6),
      awarenessQueueHighlights: asArray(next.presenceState?.awarenessQueue).slice(0, 4),
    },
    recommendedNextActions: blockers.length ? blockers : ['Rate more tracks to strengthen Taste DNA signals.', 'Promote verified candidates into Listening Deck.'],
  };
}
