import { readFileSync, writeFileSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

function write(path, content) {
  writeFileSync(path, content, 'utf8');
}

function replaceOnce(content, needle, replacement, label) {
  const first = content.indexOf(needle);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (content.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`Patch anchor is not unique: ${label}`);
  }
  return `${content.slice(0, first)}${replacement}${content.slice(first + needle.length)}`;
}

const autoPath = 'apps/music-tile/engine/nativeCatalogAutoApply.js';
let auto = read(autoPath);

auto = replaceOnce(
  auto,
`  image.src = artworkUrl;
  image.alt = 'Artwork for ' + String(track.title || track.name || 'this track');
  title.textContent = String(track.title || track.name || 'Unknown track') + ' · ' + String(track.artist || 'Unknown artist');
  return true;`,
`  const nextAlt = 'Artwork for ' + String(track.title || track.name || 'this track');
  const nextTitle = String(track.title || track.name || 'Unknown track') + ' · ' + String(track.artist || 'Unknown artist');
  if (image.getAttribute('src') !== artworkUrl) image.src = artworkUrl;
  if (image.alt !== nextAlt) image.alt = nextAlt;
  if (title.textContent !== nextTitle) title.textContent = nextTitle;
  return true;`,
  'idempotent artwork projection',
);

auto = replaceOnce(
  auto,
`  const observer = new MutationObserver(() => {
    queueHydration();
    queueAutomaticResolution();
  });
  observer.observe(deck, { childList: true, subtree: true });`,
`  const observer = new MutationObserver((records) => {
    const deckStructureChanged = records.some((record) => {
      const changedNodes = [
        ...Array.from(record.addedNodes || []),
        ...Array.from(record.removedNodes || []),
      ];
      return changedNodes.some((node) => (
        node?.nodeType === 1
        && (node.matches?.('.player-deck-card') || node.querySelector?.('.player-deck-card'))
      ));
    });
    if (!deckStructureChanged) return;
    queueHydration();
    queueAutomaticResolution();
  });
  observer.observe(deck, { childList: true, subtree: false });`,
  'bounded deck observer',
);

write(autoPath, auto);

const contractPath = 'tests/music-tile-auto-url-artwork-source-contract.test.mjs';
let contract = read(contractPath);
contract = replaceOnce(
  contract,
`  assert.match(autoApply, /if \\(typeof document !== 'undefined'\\) announceAppliedTrack/);
});`,
`  assert.match(autoApply, /if \\(typeof document !== 'undefined'\\) announceAppliedTrack/);
  assert.match(autoApply, /observer\\.observe\\(deck, \\{ childList: true, subtree: false \\}\\)/);
  assert.match(autoApply, /if \\(title\\.textContent !== nextTitle\\) title\\.textContent = nextTitle/);
  assert.doesNotMatch(autoApply, /observer\\.observe\\(deck, \\{ childList: true, subtree: true \\}\\)/);
});`,
  'observer regression contract',
);
write(contractPath, contract);

for (const [path, text] of [[autoPath, auto], [contractPath, contract]]) {
  if (text.includes('<<<<<<<') || text.includes('>>>>>>>')) {
    throw new Error(`Conflict marker in ${path}`);
  }
}

console.log('MUSIC_AUTO_ARTWORK_OBSERVER_FIX_APPLIED=YES');
