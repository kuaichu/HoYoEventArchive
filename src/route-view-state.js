import { canonicalizeRoute } from './app-route.js';

const DEFAULT_FILTERS = Object.freeze({ game: 'all', type: 'all', status: 'all' });

function createState(currentTab, currentSubtab = 'all', filters = {}) {
  return {
    currentTab,
    currentSubtab,
    filters: { ...DEFAULT_FILTERS, ...filters },
    searchQuery: ''
  };
}

export function deriveViewState(route) {
  const canonical = canonicalizeRoute(route);
  switch (canonical.name) {
    case 'events': return createState('library');
    case 'game': return createState('game', 'all', { game: canonical.gameKey });
    case 'timeline': return createState('timeline');
    case 'reports': return createState('reports', 'all', { type: '年度报告' });
    case 'returns': return createState('reflow', 'all', { type: '回归活动' });
    case 'expired': return createState('expired', 'all', { status: '已失效' });
    case 'favorites': return createState('library', 'favorites');
    case 'about': return createState('about');
    default: return createState('home');
  }
}

export function activeNavTabForViewState(viewState) {
  return viewState.currentTab === 'game' ? 'home' : viewState.currentTab;
}
