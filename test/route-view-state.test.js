import assert from 'node:assert/strict';
import test from 'node:test';

import { activeNavTabForViewState, deriveViewState } from '../src/route-view-state.js';

const allFilters = { game: 'all', type: 'all', status: 'all' };

test('home, events, and game routes produce complete independent view states', () => {
  assert.deepEqual(deriveViewState({ name: 'home' }), {
    currentTab: 'home',
    currentSubtab: 'all',
    filters: allFilters,
    searchQuery: ''
  });
  assert.deepEqual(deriveViewState({ name: 'events' }), {
    currentTab: 'library',
    currentSubtab: 'all',
    filters: allFilters,
    searchQuery: ''
  });
  assert.deepEqual(deriveViewState({ name: 'game', gameKey: 'sr' }), {
    currentTab: 'game',
    currentSubtab: 'all',
    filters: { ...allFilters, game: 'sr' },
    searchQuery: ''
  });
});

test('special archive routes apply only their documented preset', () => {
  assert.deepEqual(deriveViewState({ name: 'reports' }), {
    currentTab: 'reports', currentSubtab: 'all',
    filters: { ...allFilters, type: '年度报告' }, searchQuery: ''
  });
  assert.deepEqual(deriveViewState({ name: 'returns' }), {
    currentTab: 'reflow', currentSubtab: 'all',
    filters: { ...allFilters, type: '回归活动' }, searchQuery: ''
  });
  assert.deepEqual(deriveViewState({ name: 'expired' }), {
    currentTab: 'expired', currentSubtab: 'all',
    filters: { ...allFilters, status: '已失效' }, searchQuery: ''
  });
  assert.deepEqual(deriveViewState({ name: 'favorites' }), {
    currentTab: 'library', currentSubtab: 'favorites',
    filters: allFilters, searchQuery: ''
  });
  assert.deepEqual(deriveViewState({ name: 'timeline' }), {
    currentTab: 'timeline', currentSubtab: 'all', filters: allFilters, searchQuery: ''
  });
  assert.deepEqual(deriveViewState({ name: 'about' }), {
    currentTab: 'about', currentSubtab: 'all', filters: allFilters, searchQuery: ''
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
