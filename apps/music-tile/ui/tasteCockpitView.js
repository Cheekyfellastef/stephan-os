import { toSpotifyEmbedUrl, parseSpotifyReference } from '../utils/spotifyEmbed.js';
import { buildMusicWorkspaceSummary } from '../data/musicTasteSummary.js';

export const TASTE_ANCHORS = [
  'Push - Universal Nation',
  'Binary Finary - 1999',
  'Three Drives - Greece 2000',
  'Sevdaliza - Save Me',
  'Anyma - Say Yes To Heaven remix',
  'Hunger & Law',
  'Pico Boulevard - Close Your Eyes',
  'Madonna, Above & Beyond - What It Feels Like for a Girl, Above & Beyond 12" Club',
];

export const REJECT_PATTERNS = [
  'Too cheesy vocal trance: Emma Hewitt, Susana, Ferry Corsten',
  'Too Goa / psy: Root Level',
  'Too harsh / unpleasant: Vakhtang / Eyes, Dreams Control',
  'Too boring / flat / average: Reality Senses, Clouds, Philomena, Adi Woodz, Rick Pier caution',
  'Wrong rock / industrial darkness: Chelsea Wolfe, How to Destroy Angels',
  'Too weird: Australiens',
];

export const POSITIVE_REASON_TAGS = ['reverb vocal','echo vocal','haunting female vocal','processed vocal','wide club pressure','emotional lift','serious trance DNA','slow build payoff','complex riff','off-kilter rhythm','Lana-coded','Sevdaliza-coded','Universal Nation spine'];
export const REJECT_REASON_TAGS = ['boring','flat','too cheesy','too harsh','too Goa / psy','too miserable / down','too weird','wrong vocal','wrong rock / industrial lane','no ghost','no complexity','no lift','no club pressure'];
export const FEEDBACK_SIGNALS = ['Fantastic','Liked','Good','Interesting','Nearly','Reject'];

export function buildTasteCockpitMarkup(tracks = []) {
  const summary = buildMusicWorkspaceSummary(tracks);
  const cards = (Array.isArray(tracks) ? tracks : []).map((track) => {
    const rawRef = track.spotifyUrl || track.spotifyUri || '';
    const embed = toSpotifyEmbedUrl(rawRef);
    const fallbackUrl = parseSpotifyReference(rawRef)?.openUrl || '';
    const needsSpotify = !embed;
    const notes = [...(track.positiveTags || []), ...(track.negativeTags || []), ...(track.feedbackReasons || [])];
    return `<li class="journey-item"><article class="track-card taste-track-card"><div><strong>${track.artist} - ${track.title}</strong></div><div class="track-meta">Lane: ${track.lane || 'Unassigned'} • Signal: ${track.signal || 'unknown'}</div>${notes.length ? `<div class="track-meta">Notes/Tags: ${notes.join(' · ')}</div>` : ''}${embed ? `<iframe src="${embed}" width="100%" height="152" frameborder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>` : '<p class="muted">Needs Spotify link</p>'}${fallbackUrl ? `<div class="action-row"><a class="inline-btn button-link" href="${fallbackUrl}" target="_blank" rel="noopener noreferrer">Open in Spotify</a></div>` : ''}<div class="action-row">${FEEDBACK_SIGNALS.map((signal) => `<button class="inline-btn" data-action="taste-feedback" data-id="${track.id}" data-signal="${signal.toLowerCase()}">${signal}</button>`).join('')}</div><div class="action-row">${POSITIVE_REASON_TAGS.map((tag) => `<button class="inline-btn" data-action="taste-positive-tag" data-id="${track.id}" data-tag="${tag}">${tag}</button>`).join('')}</div><div class="action-row">${REJECT_REASON_TAGS.map((tag) => `<button class="inline-btn" data-action="taste-reject-tag" data-id="${track.id}" data-tag="${tag}">${tag}</button>`).join('')}</div>${needsSpotify ? '<p class="muted">Metadata-only card rendered safely while Spotify reference is missing.</p>' : ''}</article></li>`;
  }).join('');

  return `<li class="journey-section-label">Spotify-first Taste Cockpit</li>
    <li class="journey-item"><article>
      <h3>Spotify-first Taste Cockpit</h3>
      <p class="muted">${summary.target}</p>
      <p class="muted">Spotify canonical · YouTube discovery/fallback</p>
    </article></li>
    <li class="journey-item"><article><strong>Current Sound Target</strong><p>${summary.learningLine}</p></article></li>
    <li class="journey-item"><article><strong>Taste Anchors</strong><ul>${TASTE_ANCHORS.map((item) => `<li>${item}</li>`).join('')}</ul></article></li>
    <li class="journey-item"><article><strong>Reject Patterns</strong><ul>${REJECT_PATTERNS.map((item) => `<li>${item}</li>`).join('')}</ul></article></li>
    <li class="journey-item"><article><strong>Reason Tags · Positive</strong><p>${POSITIVE_REASON_TAGS.join(' · ')}</p><strong>Reason Tags · Reject</strong><p>${REJECT_REASON_TAGS.join(' · ')}</p></article></li>
    <li class="journey-item"><article><strong>Summary Counters</strong><p>Liked/Good/Fantastic: ${summary.counts.likedGoodFantastic} · Interesting: ${summary.counts.interesting} · Nearly: ${summary.counts.nearly} · Reject: ${summary.counts.rejects}</p></article></li>
    ${cards}`;
}
