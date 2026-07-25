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

export function validateEventId(eventId) {
  return typeof eventId === 'string' && EVENT_ID_PATTERN.test(eventId);
}

export function canonicalizeRoute(route) {
  if (route?.name === 'home') return { name: 'home' };
  if (Object.hasOwn(STATIC_ROUTE_PATHS, route?.name)) return { name: route.name };
  if (route?.name === 'game') {
    if (GAME_KEYS.has(route.gameKey)) return { name: 'game', gameKey: route.gameKey };
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
  void search;
  const normalizedPathname = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (normalizedPathname === '/' || normalizedPathname === '/index.html') return { name: 'home' };
  const staticRouteName = STATIC_PATH_ROUTES.get(normalizedPathname);
  if (staticRouteName) return { name: staticRouteName };
  const gameMatch = /^\/games\/([^/]+)$/.exec(normalizedPathname);
  if (gameMatch) {
    try {
      return canonicalizeRoute({ name: 'game', gameKey: decodeURIComponent(gameMatch[1]) });
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
  if (Object.hasOwn(STATIC_ROUTE_PATHS, canonical.name)) {
    return STATIC_ROUTE_PATHS[canonical.name];
  }
  if (canonical.name === 'game') return `/games/${encodeURIComponent(canonical.gameKey)}`;
  if (canonical.name === 'event') return `/events/${encodeURIComponent(canonical.eventId)}`;
  if (canonical.name === 'not-found') return canonical.pathname;
  return '/';
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
