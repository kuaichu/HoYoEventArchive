const EVENT_ID_PATTERN = /^[a-z0-9]+-[a-z0-9-]+$/i;

export function validateEventId(eventId) {
  return typeof eventId === 'string' && EVENT_ID_PATTERN.test(eventId);
}

export function canonicalizeRoute(route) {
  if (route?.name === 'home') return { name: 'home' };
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
  if (pathname === '/') return { name: 'home' };
  const match = /^\/events\/([^/]+)\/*$/.exec(pathname);
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
