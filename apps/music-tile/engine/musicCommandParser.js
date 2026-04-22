const INTENTS = ['discover', 'filter', 'rate', 'play', 'expand', 'suppress', 'explain'];

function normalizeCommand(input) {
  return String(input || '').trim().toLowerCase();
}

export function parseMusicCommand(input) {
  const command = normalizeCommand(input);
  if (!command) return { intent: 'explain', entities: {}, raw: input };

  if (command.startsWith('show') || command.startsWith('find') || command.startsWith('discover')) {
    return {
      intent: 'discover',
      entities: {
        unseen: command.includes('unseen'),
        longSetsOnly: command.includes('long set') || command.includes('only long'),
      },
      raw: input,
    };
  }

  if (command.startsWith('more like this') || command.startsWith('expand')) {
    return { intent: 'expand', entities: {}, raw: input };
  }

  if (command.startsWith('hide this channel') || command.startsWith('block this channel')) {
    return { intent: 'suppress', entities: { target: 'channel' }, raw: input };
  }

  if (command.startsWith('rate')) {
    const ratingMatch = command.match(/-?\d+/);
    return {
      intent: 'rate',
      entities: { rating: ratingMatch ? Number(ratingMatch[0]) : 0 },
      raw: input,
    };
  }

  if (command.startsWith('play') || command.includes('flow mode')) {
    return { intent: 'play', entities: { mode: command.includes('flow') ? 'flow' : 'discovery' }, raw: input };
  }

  if (command.startsWith('only') || command.startsWith('filter')) {
    return {
      intent: 'filter',
      entities: {
        longSetsOnly: command.includes('long'),
        unseen: command.includes('unseen'),
      },
      raw: input,
    };
  }

  return {
    intent: INTENTS.find((intent) => command.includes(intent)) || 'explain',
    entities: {},
    raw: input,
  };
}
