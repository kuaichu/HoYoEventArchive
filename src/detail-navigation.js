import { parseLocation, serializeRoute, validateEventId } from './app-route.js';

const DETAIL_HISTORY_STATE_KEY = 'hoyoEventArchiveDetail';

export function createDetailNavigation({ history, location, renderRoute }) {
  let backPending = false;

  function pageState() {
    const nextState = history.state && typeof history.state === 'object'
      ? { ...history.state }
      : {};
    delete nextState[DETAIL_HISTORY_STATE_KEY];
    return nextState;
  }

  function replay() {
    backPending = false;
    const route = parseLocation(location.pathname, location.search);
    const canonicalPathname = serializeRoute(route);
    if (canonicalPathname !== location.pathname) {
      history.replaceState(history.state, '', `${canonicalPathname}${location.search || ''}`);
    }
    renderRoute(route);
    return route;
  }

  function openEvent(eventId) {
    if (!validateEventId(eventId)) throw new TypeError('Invalid event id');
    const previousState = history.state && typeof history.state === 'object'
      ? history.state
      : {};
    history.pushState(
      { ...previousState, [DETAIL_HISTORY_STATE_KEY]: true },
      '',
      serializeRoute({ name: 'event', eventId })
    );
    return replay();
  }

  function navigate(route, options = {}) {
    const target = serializeRoute(route);
    if (location.pathname === target && !location.search) return replay();
    const method = options.replace === true ? 'replaceState' : 'pushState';
    history[method](pageState(), '', target);
    return replay();
  }

  function replace(route) {
    return navigate(route, { replace: true });
  }

  function closeDetail() {
    const route = parseLocation(location.pathname, location.search);
    const isEventPath = route.name === 'event'
      || (route.name === 'not-found' && route.pathname.startsWith('/events/'));
    if (!isEventPath) {
      if (route.name === 'not-found') return replace({ name: 'home' });
      return replay();
    }

    if (history.state?.[DETAIL_HISTORY_STATE_KEY] === true) {
      if (backPending) return null;
      backPending = true;
      history.back();
      return null;
    }

    const nextState = history.state && typeof history.state === 'object'
      ? { ...history.state }
      : history.state;
    if (nextState && typeof nextState === 'object') {
      delete nextState[DETAIL_HISTORY_STATE_KEY];
    }
    history.replaceState(nextState, '', '/events');
    return replay();
  }

  return { closeDetail, navigate, openEvent, replace, replay };
}
