import { parseLocation, serializeRoute, validateEventId } from './app-route.js';

const DETAIL_HISTORY_STATE_KEY = 'hoyoEventArchiveDetail';

export function createDetailNavigation({ history, location, renderRoute }) {
  let backPending = false;

  function replay() {
    backPending = false;
    const route = parseLocation(location.pathname, location.search);
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

  function closeDetail() {
    const route = parseLocation(location.pathname, location.search);
    if (route.name === 'home') return replay();

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
    history.replaceState(nextState, '', '/');
    return replay();
  }

  return { closeDetail, openEvent, replay };
}
