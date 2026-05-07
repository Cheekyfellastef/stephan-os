const RULES = [
  { includes: ['club engine'], plus: ['wide club sound', 'club engine'] },
  { includes: ['no ghost'], minus: ['no ghost'] },
  { includes: ['too goa', 'goa'], minus: ['too Goa / psy'] },
  { includes: ['builds', 'build'], plus: ['slow-build payoff'] },
  { includes: ['echo'], plus: ['echo vocal'] },
  { includes: ['reverb'], plus: ['reverb vocal'] },
  { includes: ['cheesy'], minus: ['too cheesy'] },
  { includes: ['boring'], minus: ['boring'] },
  { includes: ['flat'], minus: ['flat'] },
  { includes: ['portal'], plus: ['Universal Nation spine', 'serious trance DNA', 'emotional lift'] },
];

export function parseFeedback(text) {
  const t = String(text || '').toLowerCase();
  const plus = new Set();
  const minus = new Set();
  RULES.forEach((rule) => {
    if (rule.includes.some((token) => t.includes(token))) {
      (rule.plus || []).forEach((x) => plus.add(x));
      (rule.minus || []).forEach((x) => minus.add(x));
    }
  });
  return { plus: Array.from(plus), minus: Array.from(minus), raw: text };
}
