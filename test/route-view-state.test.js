import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLocation } from '../src/app-route.js';
import { activeNavTabForViewState, deriveViewState } from '../src/route-view-state.js';

const allFilters = { game: 'all', version: 'all', type: 'all', status: 'all' };
const defaultControls = { searchQuery: '', sortKey: 'date-desc', viewLayout: 'grid' };

test('query state deterministically hydrates every shareable list control', () => {
  const route = parseLocation(
    '/events',
    '?tab=ending&game=ys&version=v6.0&type=preview&status=available&sort=title-asc&layout=list'
  );
  assert.deepEqual(deriveViewState(route), {
    currentTab: 'library',
    currentSubtab: 'ending',
    filters: {
      game: 'ys', version: 'v6.0', type: '版本前瞻', status: '可访问'
    },
    searchQuery: '',
    sortKey: 'title-asc',
    viewLayout: 'list'
  });
});

test('home, events, and game routes produce complete independent view states', () => {
  assert.deepEqual(deriveViewState({ name: 'home' }), {
    currentTab: 'home',
    currentSubtab: 'all',
    filters: allFilters,
    ...defaultControls
  });
  assert.deepEqual(deriveViewState({ name: 'events' }), {
    currentTab: 'library',
    currentSubtab: 'all',
    filters: allFilters,
    ...defaultControls
  });
  assert.deepEqual(deriveViewState({ name: 'game', gameKey: 'sr' }), {
    currentTab: 'game',
    currentSubtab: 'all',
    filters: { ...allFilters, game: 'sr' },
    ...defaultControls
  });
});

test('special archive routes apply only their documented preset', () => {
  assert.deepEqual(deriveViewState({ name: 'reports' }), {
    currentTab: 'reports', currentSubtab: 'all',
    filters: { ...allFilters, type: '年度报告' }, ...defaultControls
  });
  assert.deepEqual(deriveViewState({ name: 'returns' }), {
    currentTab: 'reflow', currentSubtab: 'all',
    filters: { ...allFilters, type: '回归活动' }, ...defaultControls
  });
  assert.deepEqual(deriveViewState({ name: 'expired' }), {
    currentTab: 'expired', currentSubtab: 'all',
    filters: { ...allFilters, status: '已失效' }, ...defaultControls
  });
  assert.deepEqual(deriveViewState({ name: 'favorites' }), {
    currentTab: 'library', currentSubtab: 'favorites',
    filters: allFilters, ...defaultControls
  });
  assert.deepEqual(deriveViewState({ name: 'timeline' }), {
    currentTab: 'timeline', currentSubtab: 'all', filters: allFilters, ...defaultControls
  });
  assert.deepEqual(deriveViewState({ name: 'about' }), {
    currentTab: 'about', currentSubtab: 'all', filters: allFilters, ...defaultControls
  });
});

test('favorites routes never serialize local bookmark contents', () => {
  assert.deepEqual(
    deriveViewState({ name: 'favorites', bookmarks: ['ys-1'] }),
    deriveViewState({ name: 'favorites', bookmarks: ['sr-2'] })
  );
});

test('derived filters are fresh values and cannot leak into the next route', () => {
  const reports = deriveViewState({ name: 'reports' });
  reports.filters.game = 'ys';
  reports.filters.status = '已失效';

  assert.deepEqual(deriveViewState({ name: 'events' }).filters, allFilters);
  assert.deepEqual(deriveViewState({ name: 'reports' }).filters, {
    ...allFilters,
    type: '年度报告'
  });
});

test('navigation highlighting follows route-derived view state', () => {
  const expected = new Map([
    ['home', 'home'], ['events', 'library'], ['timeline', 'timeline'],
    ['reports', 'reports'], ['returns', 'reflow'], ['expired', 'expired'],
    ['favorites', 'library'], ['about', 'about']
  ]);
  for (const [routeName, tabName] of expected) {
    assert.equal(activeNavTabForViewState(deriveViewState({ name: routeName })), tabName);
  }
  assert.equal(
    activeNavTabForViewState(deriveViewState({ name: 'game', gameKey: 'ys' })),
    'home'
  );
});
