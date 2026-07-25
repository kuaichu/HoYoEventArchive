import assert from 'node:assert/strict';
import test from 'node:test';

import { buildVersionOptions, selectEvents } from '../src/event-list-domain.js';

const events = [
  { id: 'ys-60', gameKey: 'ys', version: 'v6.0' },
  { id: 'ys-31', gameKey: 'ys', version: 'v3.1' },
  { id: 'ys-general', gameKey: 'ys', version: '通用' },
  { id: 'ys-pre', gameKey: 'ys', version: '公测前' },
  { id: 'ys-pending', gameKey: 'ys', version: '' },
  { id: 'sr-31', gameKey: 'sr', version: 'v3.1' }
];

test('public version options require a game and stay scoped and semantically sorted', () => {
  assert.deepEqual(buildVersionOptions(events, 'all'), []);
  assert.deepEqual(buildVersionOptions(events, 'sr'), ['v3.1']);
  assert.deepEqual(
    buildVersionOptions(events, 'ys'),
    ['v6.0', 'v3.1', '公测前', '通用', '待确认']
  );
});

const listEvents = [
  {
    id: 'ys-1', gameKey: 'ys', game: '原神', version: 'v3.1', type: '版本前瞻',
    status: '可访问', title: '原神周年', description: '预告', tags: ['周年庆'], date: '2026.01.03'
  },
  {
    id: 'sr-1', gameKey: 'sr', game: '星穹铁道', version: 'v3.1', type: '版本前瞻',
    status: '已结束', title: '列车活动', description: '回顾', tags: [], date: '2026.01.02'
  },
  {
    id: 'ys-2', gameKey: 'ys', game: '原神', version: '通用', type: '小游戏',
    status: '已失效', title: '网页小游戏', description: '小游戏说明', tags: [], date: '2026.01.01'
  }
];

test('event selection combines game and version without leaking same-name versions across games', () => {
  const original = structuredClone(listEvents);
  const selected = selectEvents(listEvents, {
    filters: { game: 'ys', version: 'v3.1', type: 'all', status: 'all' },
    currentSubtab: 'all',
    searchQuery: '',
    sortKey: 'date-desc',
    bookmarks: []
  });

  assert.deepEqual(selected.map(event => event.id), ['ys-1']);
  assert.deepEqual(listEvents, original);
});

test('tabs preserve latest, ending, featured, and favorites behavior', () => {
  const base = {
    filters: { game: 'all', version: 'all', type: 'all', status: 'all' },
    searchQuery: '', sortKey: 'date-desc', bookmarks: ['sr-1']
  };
  assert.deepEqual(
    selectEvents(listEvents, { ...base, currentSubtab: 'ending' }).map(event => event.id),
    ['sr-1', 'ys-2']
  );
  assert.deepEqual(
    selectEvents(listEvents, { ...base, currentSubtab: 'popular' }).map(event => event.id),
    ['ys-1']
  );
  assert.deepEqual(
    selectEvents(listEvents, { ...base, currentSubtab: 'favorites' }).map(event => event.id),
    ['sr-1']
  );

  const latestSource = Array.from({ length: 14 }, (_, index) => ({
    ...listEvents[0], id: `ys-${index}`, date: `2026.01.${String(index + 1).padStart(2, '0')}`
  }));
  assert.equal(selectEvents(latestSource, { ...base, currentSubtab: 'latest' }).length, 12);
});

test('search is case-insensitive across documented fields and combines with filters and sorting', () => {
  const base = {
    filters: { game: 'ys', version: 'all', type: 'all', status: 'all' },
    currentSubtab: 'all', bookmarks: []
  };
  assert.deepEqual(
    selectEvents(listEvents, { ...base, searchQuery: '周年', sortKey: 'date-desc' })
      .map(event => event.id),
    ['ys-1']
  );
  assert.deepEqual(
    selectEvents(listEvents, { ...base, searchQuery: '小游戏', sortKey: 'title-asc' })
      .map(event => event.id),
    ['ys-2']
  );
  assert.deepEqual(
    selectEvents(listEvents, {
      ...base,
      filters: { ...base.filters, version: 'v9.9' },
      searchQuery: '',
      sortKey: 'status-asc'
    }),
    []
  );
});
