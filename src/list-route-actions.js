import { canonicalizeRoute, serializeRoute } from './app-route.js';
import { buildVersionOptions } from './event-list-domain.js';

function routeShell(route, name = route.name, gameKey = route.gameKey) {
  return name === 'game' ? { name, gameKey } : { name };
}

export function updateListRoute(route, changes, events = []) {
  const current = canonicalizeRoute(route);
  if (!current.listState) return current;

  let targetName = current.name;
  let targetGameKey = current.gameKey;
  const listState = { ...current.listState, ...changes };

  if (Object.hasOwn(changes, 'game')) {
    const nextGame = changes.game;
    if (current.name === 'game') {
      targetName = nextGame === 'all' ? 'events' : 'game';
      targetGameKey = nextGame === 'all' ? undefined : nextGame;
    }
    if (
      listState.version !== 'all'
      && !buildVersionOptions(events, nextGame).includes(listState.version)
    ) {
      listState.version = 'all';
    }
  }

  if (
    Object.hasOwn(changes, 'type')
    && ['reports', 'returns'].includes(current.name)
    && changes.type !== current.listState.type
  ) {
    targetName = 'events';
    targetGameKey = undefined;
  }
  if (
    Object.hasOwn(changes, 'status')
    && current.name === 'expired'
    && changes.status !== current.listState.status
  ) {
    targetName = 'events';
    targetGameKey = undefined;
  }
  if (Object.hasOwn(changes, 'tab') && current.name === 'favorites') {
    targetName = 'events';
    targetGameKey = undefined;
  }

  return canonicalizeRoute({
    ...routeShell(current, targetName, targetGameKey),
    listState
  });
}

export function clearListRoute(route) {
  const current = canonicalizeRoute(route);
  return canonicalizeRoute(routeShell(current));
}

export function hasClearableListState(route) {
  const current = canonicalizeRoute(route);
  return Boolean(current.listState)
    && serializeRoute(current) !== serializeRoute(clearListRoute(current));
}

export function hasUnavailableListVersion(route, events = []) {
  const current = canonicalizeRoute(route);
  return Boolean(current.listState)
    && current.listState.version !== 'all'
    && !buildVersionOptions(events, current.listState.game).includes(current.listState.version);
}

export function routeMatchesLocation(route, pathname, search = '') {
  if (!route?.listState) return false;
  return serializeRoute(route) === `${pathname}${search || ''}`;
}
