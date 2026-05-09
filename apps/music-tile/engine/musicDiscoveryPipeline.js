import { resolveArtistIntelligence } from './musicArtistIntelligence.js';
import { generateMusicSearchQueries } from './musicSearchQueryGenerator.js';
import { resolveMusicCandidate } from './musicCatalogResolver.js';
import { adjudicateMusicReality } from './musicRealityAdjudicator.js';

export async function runMusicDiscoveryPipeline({ query = '', tasteDNA = {}, aiHints = [], localCandidates = [] } = {}) {
  const artistProfile = resolveArtistIntelligence(query);
  const leads = [...localCandidates, ...aiHints];
  const resolved = await Promise.all(leads.map((c) => resolveMusicCandidate(c)));
  const scored = resolved.map((c) => {
    const reality = adjudicateMusicReality(c);
    const positive = Object.keys(tasteDNA || {}).filter((k) => tasteDNA[k]?.polarity !== 'negative');
    const matched = positive.filter((t) => `${c.title} ${c.artist} ${(c.resolverNotes || '')}`.toLowerCase().includes(String(t).toLowerCase()));
    const verificationScore = reality.playable ? 3 : -1;
    const localScore = matched.length;
    const finalScore = localScore + verificationScore;
    return { ...c, localScore, aiScore: c.sourceKind === 'ai' ? 1 : 0, verificationScore, finalScore, why: matched, risk: reality.riskFlags };
  });
  const verifiedCandidates = scored.filter((c) => c.finalScore >= 1 && c.verificationStatus.includes('verified'));
  const searchLeads = scored.filter((c) => c.verificationStatus === 'search_only' || c.verificationStatus === 'needs_user_confirmation');
  const fallbackCandidates = scored.length ? [] : [{ title: 'Taste DNA fallback', artist: query || 'Unknown', verificationStatus: 'search_only' }];
  return {
    query,
    artistProfileStatus: artistProfile.status,
    summary: `Resolved ${scored.length} candidates.`,
    verifiedCandidates,
    searchLeads,
    aiSuggestions: scored.filter((c) => c.sourceKind === 'ai'),
    fallbackCandidates,
    warnings: scored.some((c) => c.verificationStatus === 'likely_hallucinated') ? ['hallucination-risk'] : [],
    resultCount: scored.length,
    targetCount: 8,
    searchQueries: generateMusicSearchQueries({ artist: query, tasteDNA }),
  };
}
