export const MUSIC_LANES = [
  'Dark Courtyard / Serious Trance DNA',
  'Ghost Vocal / Reverb Female Voice',
  'Lana Ghost / Slow-Burn Club Lift',
  'Club Engine But Missing Ghost',
  'Interesting Complexity',
  'Reject: Cheesy Vocal Trance',
  'Reject: Goa / Psy Excess',
  'Reject: Flat / Boring / Average',
  'Reject: Harsh / Unpleasant',
  'Reject: Too Miserable / Down',
  'Reject: Wrong Rock / Industrial Darkness',
];

export const SEEDED_TASTE_TRACKS = [
  { id:'anchor-universal-nation', title:'Universal Nation', artist:'Push', canonicalSource:'spotify', spotifyUrl:'https://open.spotify.com/track/1lXzvA8rQwRz4t5Lwz4M8W', signal:'fantastic', lane:MUSIC_LANES[0], positiveTags:['serious trance DNA','Universal Nation spine'] },
  { id:'anchor-1999', title:'1999', artist:'Binary Finary', canonicalSource:'spotify', spotifyUri:'spotify:track:0R2evcrs4W4lR5vbhwA2Q4', signal:'liked', lane:MUSIC_LANES[0], positiveTags:['serious trance DNA','slow build payoff'] },
  { id:'anchor-save-me', title:'Save Me', artist:'Sevdaliza', canonicalSource:'spotify', spotifyUrl:'https://open.spotify.com/track/2GQfQw0f9M8e8P3G2NL8eN', signal:'liked', lane:MUSIC_LANES[1], positiveTags:['Sevdaliza-coded','processed vocal'] },
  { id:'reject-ferry', title:'General Ferry Corsten lane', artist:'Ferry Corsten', canonicalSource:'manual', signal:'reject', lane:MUSIC_LANES[5], negativeTags:['too cheesy'], feedbackReasons:['wrong trance branch / too bright'] },
];
