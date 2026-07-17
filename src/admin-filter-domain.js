export function adminGameLabel(game) {
  return game === '全部游戏' ? '通用活动' : game;
}

export function encodeVersionFilter(game, version) {
  return JSON.stringify([game, version]);
}

export function parseVersionFilter(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [game, version] = parsed;
    if (typeof game !== 'string' || typeof version !== 'string' || !game || !version) return null;
    return { game, version };
  } catch {
    return null;
  }
}

function compareVersions(a, b) {
  const specialRank = new Map([['公测前', 1], ['通用', 2], ['待确认', 3]]);
  const aRank = specialRank.get(a) || 0;
  const bRank = specialRank.get(b) || 0;
  if (aRank !== bRank) return aRank - bRank;
  if (aRank > 0) return 0;
  return b.localeCompare(a, 'zh-CN', { numeric: true });
}

export function buildVersionFilterGroups(events, selectedGame = '') {
  const games = selectedGame
    ? [selectedGame]
    : [...new Set(events.map(event => event.game).filter(Boolean))]
        .sort((a, b) => adminGameLabel(a).localeCompare(adminGameLabel(b), 'zh-CN'));

  return games.map(game => {
    const versions = [...new Set(events
      .filter(event => event.game === game)
      .map(event => event.version || '待确认'))]
      .sort(compareVersions);

    return {
      game,
      label: adminGameLabel(game),
      options: versions.map(version => ({
        version,
        value: encodeVersionFilter(game, version),
        label: selectedGame ? version : `${adminGameLabel(game)} · ${version}`
      }))
    };
  }).filter(group => group.options.length > 0);
}

export function eventMatchesVersionFilter(event, value) {
  const selected = parseVersionFilter(value);
  if (!selected) return true;
  return event.game === selected.game && (event.version || '待确认') === selected.version;
}
