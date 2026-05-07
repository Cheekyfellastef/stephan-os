import { toSpotifyEmbedUrl, parseSpotifyReference } from '../utils/spotifyEmbed.js';
import { buildMusicWorkspaceSummary } from '../data/musicTasteSummary.js';

export const TASTE_ANCHORS = [
  'Push - Universal Nation','Binary Finary - 1999','Three Drives - Greece 2000','Sevdaliza - Save Me','Anyma - Say Yes To Heaven remix','Hunger & Law','Pico Boulevard - Close Your Eyes','Madonna, Above & Beyond - What It Feels Like for a Girl, Above & Beyond 12" Club',
];
export const INTERESTING_SIGNALS = ['I Feel You, 8Kays remix','Distorted Voices','Guiding Light','Angst','Pray - DARCULA','Mirador','Rick Pier - Meteorite'];
export const REJECT_PATTERNS = [
  'Too cheesy vocal trance: Emma Hewitt, Susana, Ferry Corsten','Too Goa / psy: Root Level','Too harsh / unpleasant: Vakhtang / Eyes, Dreams Control','Too boring / flat / average: Reality Senses, Clouds, Philomena, Adi Woodz, Rick Pier caution','Wrong rock / industrial darkness: Chelsea Wolfe, How to Destroy Angels','Too weird: Australiens',
];
export const POSITIVE_REASON_TAGS = ['reverb vocal','echo vocal','haunting female vocal','processed vocal','wide club pressure','emotional lift','serious trance DNA','slow build payoff','complex riff','off-kilter rhythm','Lana-coded','Sevdaliza-coded','Universal Nation spine'];
export const REJECT_REASON_TAGS = ['boring','flat','too cheesy','too harsh','too Goa / psy','too miserable / down','too weird','wrong vocal','wrong rock / industrial lane','no ghost','no complexity','no lift','no club pressure'];
export const FEEDBACK_SIGNALS = ['Fantastic','Liked','Good','Interesting','Nearly','Reject'];

export function buildTasteProfileMarkup(tracks=[]) {
  const summary = buildMusicWorkspaceSummary(tracks);
  return `
  <article class="summary-card"><strong>Current Sound Target</strong><p>${summary.target}</p><p>${summary.learningLine}</p></article>
  <article class="summary-card"><strong>Positive Anchors</strong><ul>${TASTE_ANCHORS.map((i)=>`<li>${i}</li>`).join('')}</ul></article>
  <article class="summary-card"><strong>Interesting / Investigate</strong><ul>${INTERESTING_SIGNALS.map((i)=>`<li>${i}</li>`).join('')}</ul></article>
  <article class="summary-card"><strong>Reject Patterns</strong><ul>${REJECT_PATTERNS.map((i)=>`<li>${i}</li>`).join('')}</ul></article>
  <article class="summary-card"><strong>Taste Rules</strong><p>Dark but alive. Strange only when it serves club spell. No cheese, no flat wallpaper, no harshness.</p></article>
  <article class="summary-card"><strong>Counts</strong><p>Liked/Good/Fantastic: ${summary.counts.likedGoodFantastic} · Interesting: ${summary.counts.interesting} · Nearly: ${summary.counts.nearly} · Reject: ${summary.counts.rejects}</p></article>`;
}

export function buildListeningCardsMarkup(tracks=[]) {
  return (tracks||[]).map((track)=>{
    const rawRef = track.spotifyUrl || track.spotifyUri || '';
    const embed = toSpotifyEmbedUrl(rawRef);
    const fallbackUrl = parseSpotifyReference(rawRef)?.openUrl || '';
    const yt = Array.isArray(track.youtubeUrlCandidates) && track.youtubeUrlCandidates[0] ? track.youtubeUrlCandidates[0] : '';
    return `<li class="journey-item"><article class="track-card taste-track-card"><div><strong>${track.title}</strong><div class="track-meta">${track.artist} · ${track.signal || 'unknown'} · ${track.lane || 'Unassigned'}</div></div>${embed ? `<iframe src="${embed}" width="100%" height="152" style="border:0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>` : '<p class="muted">Needs Spotify link</p>'}<div class="action-row">${fallbackUrl ? `<a class="inline-btn button-link" target="_blank" rel="noopener noreferrer" href="${fallbackUrl}">Open in Spotify</a>` : '<a class="inline-btn button-link" target="_blank" rel="noopener noreferrer" href="https://open.spotify.com/search/'+encodeURIComponent(track.artist+' '+track.title)+'">Find on Spotify</a>'}${yt ? `<a class="inline-btn button-link ghost" target="_blank" rel="noopener noreferrer" href="${yt}">Open YouTube</a>` : `<a class="inline-btn button-link ghost" target="_blank" rel="noopener noreferrer" href="https://www.youtube.com/results?search_query=${encodeURIComponent(track.artist+' '+track.title)}">Find on YouTube</a>`}</div><div class="action-row">${FEEDBACK_SIGNALS.map((signal)=>`<button type="button" class="inline-btn" data-action="taste-feedback" data-id="${track.id}" data-signal="${signal.toLowerCase()}">${signal}</button>`).join('')}</div><div class="action-row">${POSITIVE_REASON_TAGS.map((tag)=>`<button type="button" class="inline-btn" data-action="taste-positive-tag" data-id="${track.id}" data-tag="${tag}">${tag}</button>`).join('')}</div><div class="action-row">${REJECT_REASON_TAGS.map((tag)=>`<button type="button" class="inline-btn" data-action="taste-reject-tag" data-id="${track.id}" data-tag="${tag}">${tag}</button>`).join('')}</div></article></li>`
  }).join('');
}
