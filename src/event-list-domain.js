import { compareVersions } from './version-domain.js';
import { isFeaturedEvent } from './event-domain.js';

const GAME_KEYS = new Set(['ys', 'sr', 'zzz', 'bh3']);

export function buildVersionOptions(events, gameKey) {
  if (!GAME_KEYS.has(gameKey) || !Array.isArray(events)) return [];
  return [...new Set(events
    .filter(event => event?.gameKey === gameKey)
    .map(event => event.version || '待确认'))]
    .sort(compareVersions);
}

function eventTimestamp(event) {
  return new Date(String(event?.date || '').replace(/\./g, '/')).getTime();
}

function compareEvents(a, b, sortKey) {
  if (sortKey === 'date-asc') return eventTimestamp(a) - eventTimestamp(b);
  if (sortKey === 'title-asc') return a.title.localeCompare(b.title, 'zh');
  if (sortKey === 'status-asc') return a.status.localeCompare(b.status, 'zh');
  return eventTimestamp(b) - eventTimestamp(a);
}

function eventMatchesSearch(event, query) {
  const fields = [
    event.title,
    event.game,
    event.version,
    event.type,
    event.description,
    ...(Array.isArray(event.tags) ? event.tags : [])
  ];
  return fields.some(value => String(value || '').toLocaleLowerCase().includes(query));
}

export function selectEvents(events, options = {}) {
  const filters = options.filters || {};
  const bookmarks = Array.isArray(options.bookmarks) ? options.bookmarks : [];
  const currentSubtab = options.currentSubtab || 'all';
  const sortKey = options.sortKey || 'date-desc';
  const searchQuery = String(options.searchQuery || '').trim().toLocaleLowerCase();
  let list = Array.isArray(events) ? [...events] : [];

  if (filters.game && filters.game !== 'all') {
    list = list.filter(event => event.gameKey === filters.game);
  }
  if (filters.version && filters.version !== 'all') {
    list = list.filter(event => (event.version || '待确认') === filters.version);
  }
  if (filters.type && filters.type !== 'all') {
    list = list.filter(event => event.type === filters.type);
  }
  if (filters.status && filters.status !== 'all') {
    list = list.filter(event => event.status === filters.status);
  }

  if (currentSubtab === 'latest') {
    list.sort((a, b) => compareEvents(a, b, 'date-desc'));
    list = list.slice(0, 12);
  } else if (currentSubtab === 'ending') {
    list = list.filter(event => event.status === '已结束' || event.status === '已失效');
  } else if (currentSubtab === 'popular') {
    list = list.filter(isFeaturedEvent);
  } else if (currentSubtab === 'favorites') {
    list = list.filter(event => bookmarks.includes(event.id));
  }

  if (searchQuery) list = list.filter(event => eventMatchesSearch(event, searchQuery));
  list.sort((a, b) => compareEvents(a, b, sortKey));
  return list;
}
