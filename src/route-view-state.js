import { canonicalizeRoute, DEFAULT_LIST_STATE } from './app-route.js';

const DEFAULT_FILTERS = Object.freeze({
  game: 'all', version: 'all', type: 'all', status: 'all'
});

function createState(currentTab, listState = DEFAULT_LIST_STATE, currentSubtab = listState.tab) {
  return {
    currentTab,
    currentSubtab,
    filters: {
      ...DEFAULT_FILTERS,
      game: listState.game,
      version: listState.version,
      type: listState.type,
      status: listState.status
    },
    searchQuery: listState.q,
    sortKey: listState.sort,
    viewLayout: listState.layout
  };
}

export function deriveViewState(route) {
  const canonical = canonicalizeRoute(route);
  switch (canonical.name) {
    case 'events': return createState('library', canonical.listState);
    case 'game': return createState('game', canonical.listState);
    case 'timeline': return createState('timeline');
    case 'reports': return createState('reports', canonical.listState);
    case 'returns': return createState('reflow', canonical.listState);
    case 'expired': return createState('expired', canonical.listState);
    case 'favorites': return createState('library', canonical.listState, 'favorites');
    case 'about': return createState('about');
    case 'home': return createState('home', canonical.listState);
    default: return createState('home');
  }
}

export function activeNavTabForViewState(viewState) {
  return viewState.currentTab === 'game' ? 'home' : viewState.currentTab;
}
