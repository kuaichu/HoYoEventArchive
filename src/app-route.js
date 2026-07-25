const EVENT_ID_PATTERN = /^[a-z0-9]+-[a-z0-9-]+$/i;
const STATIC_ROUTE_PATHS = Object.freeze({
  events: '/events',
  timeline: '/timeline',
  reports: '/reports',
  returns: '/returns',
  expired: '/expired',
  favorites: '/favorites',
  about: '/about'
});
const STATIC_PATH_ROUTES = new Map(
  Object.entries(STATIC_ROUTE_PATHS).map(([name, pathname]) => [pathname, name])
);
const GAME_KEYS = new Set(['ys', 'sr', 'zzz', 'bh3']);
const LIST_ROUTE_NAMES = new Set([
  'home', 'events', 'reports', 'returns', 'expired', 'favorites', 'game'
]);
const TABS = new Set(['all', 'latest', 'ending', 'popular']);
const SORT_KEYS = new Set(['date-desc', 'date-asc', 'title-asc', 'status-asc']);
const LAYOUTS = new Set(['grid', 'list']);
const TYPE_FROM_SLUG = Object.freeze({
  report: '年度报告',
  return: '回归活动',
  preview: '版本前瞻',
  minigame: '小游戏',
  resource: '资料站',
  prereg: '预约/预抽卡',
  collab: '联动活动',
  other: '其他活动'
});
const STATUS_FROM_SLUG = Object.freeze({
  available: '可访问',
  expired: '已失效',
  login: '需登录',
  ended: '已结束'
});
const VERSION_FROM_SLUG = Object.freeze({
  prelaunch: '公测前',
  general: '通用',
  pending: '待确认'
});
const TYPE_TO_SLUG = new Map(Object.entries(TYPE_FROM_SLUG).map(([slug, value]) => [value, slug]));
const STATUS_TO_SLUG = new Map(Object.entries(STATUS_FROM_SLUG).map(([slug, value]) => [value, slug]));
const VERSION_TO_SLUG = new Map(Object.entries(VERSION_FROM_SLUG).map(([slug, value]) => [value, slug]));

export const DEFAULT_LIST_STATE = Object.freeze({
  tab: 'all',
  game: 'all',
  version: 'all',
  type: 'all',
  status: 'all',
  q: '',
  sort: 'date-desc',
  layout: 'grid'
});

function normalizeVersion(value) {
  if (typeof value !== 'string') return 'all';
  if (Object.hasOwn(VERSION_FROM_SLUG, value)) return VERSION_FROM_SLUG[value];
  if (VERSION_TO_SLUG.has(value)) return value;
  return /^v\d+\.\d+$/.test(value) ? value : 'all';
}

function normalizeQueryText(value) {
  return typeof value === 'string' ? Array.from(value.trim()).slice(0, 100).join('') : '';
}

function canonicalizeListState(routeName, gameKey, candidate = {}) {
  const fixedGame = routeName === 'game' ? gameKey : null;
  const game = fixedGame || (GAME_KEYS.has(candidate.game) ? candidate.game : 'all');
  const version = game === 'all' ? 'all' : normalizeVersion(candidate.version);
  return {
    tab: routeName === 'favorites'
      ? DEFAULT_LIST_STATE.tab
      : (TABS.has(candidate.tab) ? candidate.tab : DEFAULT_LIST_STATE.tab),
    game,
    version,
    type: routeName === 'reports'
      ? '年度报告'
      : routeName === 'returns'
        ? '回归活动'
        : (TYPE_TO_SLUG.has(candidate.type) ? candidate.type : DEFAULT_LIST_STATE.type),
    status: routeName === 'expired'
      ? '已失效'
      : (STATUS_TO_SLUG.has(candidate.status) ? candidate.status : DEFAULT_LIST_STATE.status),
    q: routeName === 'home' ? normalizeQueryText(candidate.q) : '',
    sort: SORT_KEYS.has(candidate.sort) ? candidate.sort : DEFAULT_LIST_STATE.sort,
    layout: LAYOUTS.has(candidate.layout) ? candidate.layout : DEFAULT_LIST_STATE.layout
  };
}

function parseListState(routeName, gameKey, search) {
  const params = new URLSearchParams(search);
  const game = params.get('game');
  const typeSlug = params.get('type');
  const statusSlug = params.get('status');
  const versionSlug = params.get('version');
  return canonicalizeListState(routeName, gameKey, {
    tab: params.get('tab'),
    game,
    version: Object.hasOwn(VERSION_FROM_SLUG, versionSlug)
      ? VERSION_FROM_SLUG[versionSlug]
      : versionSlug,
    type: TYPE_FROM_SLUG[typeSlug],
    status: STATUS_FROM_SLUG[statusSlug],
    q: params.get('q'),
    sort: params.get('sort'),
    layout: params.get('layout')
  });
}

function withListState(route, search = '') {
  if (!LIST_ROUTE_NAMES.has(route.name)) return route;
  const listState = parseListState(route.name, route.gameKey, search);
  return { ...route, listState };
}

export function validateEventId(eventId) {
  return typeof eventId === 'string' && EVENT_ID_PATTERN.test(eventId);
}

export function canonicalizeRoute(route) {
  if (route?.name === 'home') {
    return {
      name: 'home',
      listState: canonicalizeListState('home', null, route.listState)
    };
  }
  if (Object.hasOwn(STATIC_ROUTE_PATHS, route?.name)) {
    const canonical = { name: route.name };
    return LIST_ROUTE_NAMES.has(route.name)
      ? { ...canonical, listState: canonicalizeListState(route.name, null, route.listState) }
      : canonical;
  }
  if (route?.name === 'game') {
    if (GAME_KEYS.has(route.gameKey)) {
      const canonical = { name: 'game', gameKey: route.gameKey };
      return {
        ...canonical,
        listState: canonicalizeListState('game', route.gameKey, route.listState)
      };
    }
    return {
      name: 'not-found',
      pathname: `/games/${encodeURIComponent(String(route.gameKey ?? ''))}`
    };
  }
  if (route?.name === 'event') {
    if (validateEventId(route.eventId)) {
      return { name: 'event', eventId: route.eventId };
    }
    return {
      name: 'not-found',
      pathname: `/events/${encodeURIComponent(String(route.eventId ?? ''))}`
    };
  }
  if (
    route?.name === 'not-found'
    && typeof route.pathname === 'string'
    && route.pathname.startsWith('/')
    && route.pathname !== '/'
  ) {
    return { name: 'not-found', pathname: route.pathname };
  }
  return { name: 'home' };
}

export function parseLocation(pathname, search = '') {
  if (!search && typeof pathname === 'string' && pathname.includes('?')) {
    const url = new URL(pathname, 'https://example.invalid');
    pathname = url.pathname;
    search = url.search;
  }
  const normalizedPathname = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (normalizedPathname === '/' || normalizedPathname === '/index.html') {
    return withListState({ name: 'home' }, search);
  }
  const staticRouteName = STATIC_PATH_ROUTES.get(normalizedPathname);
  if (staticRouteName) return withListState({ name: staticRouteName }, search);
  const gameMatch = /^\/games\/([^/]+)$/.exec(normalizedPathname);
  if (gameMatch) {
    try {
      const route = canonicalizeRoute({ name: 'game', gameKey: decodeURIComponent(gameMatch[1]) });
      return route.name === 'game' ? withListState(route, search) : route;
    } catch {
      return canonicalizeRoute({ name: 'not-found', pathname });
    }
  }
  const match = /^\/events\/([^/]+)$/.exec(normalizedPathname);
  if (!match) return canonicalizeRoute({ name: 'not-found', pathname });
  try {
    const eventId = decodeURIComponent(match[1]);
    if (!validateEventId(eventId)) {
      return canonicalizeRoute({ name: 'not-found', pathname });
    }
    return canonicalizeRoute({ name: 'event', eventId });
  } catch {
    return canonicalizeRoute({ name: 'not-found', pathname });
  }
}

export function serializeRoute(route) {
  const canonical = canonicalizeRoute(route);
  let pathname;
  if (Object.hasOwn(STATIC_ROUTE_PATHS, canonical.name)) {
    pathname = STATIC_ROUTE_PATHS[canonical.name];
  } else if (canonical.name === 'game') {
    pathname = `/games/${encodeURIComponent(canonical.gameKey)}`;
  } else if (canonical.name === 'event') {
    return `/events/${encodeURIComponent(canonical.eventId)}`;
  } else if (canonical.name === 'not-found') {
    return canonical.pathname;
  } else {
    pathname = '/';
  }

  if (!canonical.listState) return pathname;
  const params = new URLSearchParams();
  const state = canonical.listState;
  if (canonical.name !== 'favorites' && state.tab !== DEFAULT_LIST_STATE.tab) {
    params.set('tab', state.tab);
  }
  if (canonical.name !== 'game' && state.game !== DEFAULT_LIST_STATE.game) params.set('game', state.game);
  if (state.version !== DEFAULT_LIST_STATE.version) {
    params.set('version', VERSION_TO_SLUG.get(state.version) || state.version);
  }
  if (!['reports', 'returns'].includes(canonical.name) && state.type !== DEFAULT_LIST_STATE.type) {
    params.set('type', TYPE_TO_SLUG.get(state.type));
  }
  if (canonical.name !== 'expired' && state.status !== DEFAULT_LIST_STATE.status) {
    params.set('status', STATUS_TO_SLUG.get(state.status));
  }
  if (canonical.name === 'home' && state.q) params.set('q', state.q);
  if (state.sort !== DEFAULT_LIST_STATE.sort) params.set('sort', state.sort);
  if (state.layout !== DEFAULT_LIST_STATE.layout) params.set('layout', state.layout);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function resolveEventRoute(route, events) {
  const canonical = canonicalizeRoute(route);
  if (canonical.name === 'home') return { status: 'home' };
  if (canonical.name !== 'event') return { status: 'missing', eventId: null };

  const event = Array.isArray(events)
    ? events.find(candidate => candidate?.id === canonical.eventId)
    : null;
  return event
    ? { status: 'found', event }
    : { status: 'missing', eventId: canonical.eventId };
}
