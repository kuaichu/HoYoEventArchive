import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeEventState,
  parsePersistedEventState,
  serializeEventState
} from '../src/event-storage.js';

const baseEvents = [
  {
    id: 'ys-1',
    title: 'Base title',
    url: 'https://act.mihoyo.com/base',
    game: '原神',
    gameKey: 'ys',
    type: '其他活动',
    status: '可访问',
    date: '2026.01.01',
    tags: ['网页活动'],
    version: '通用',
    description: 'Base description'
  },
  {
    id: 'sr-1',
    title: 'Second base event',
    url: 'https://act.mihoyo.com/second',
    game: '星穹铁道',
    gameKey: 'sr',
    type: '其他活动',
    status: '可访问',
    date: '2026.01.02',
    tags: [],
    version: '通用',
    description: ''
  }
];

test('existing date overrides and explicit clearing do not inherit incompatible repository clocks', () => {
  const base = [{ ...baseEvents[0], startDate: '2026.09.28', endDate: '2026.10.18',
    startAt: '2026-09-28T11:00+08:00', endAt: '2026-10-18T23:59+08:00' }];
  for (const endDate of ['2026.10.20', null]) {
    const overlay = parsePersistedEventState(JSON.stringify({ version: 2,
      overrides: { 'ys-1': { endDate } }, additions: [], deletedIds: [] }), base);
    const merged = mergeEventState(base, overlay.overlay)[0];
    assert.equal(merged.endDate, endDate ?? undefined);
    assert.equal(merged.endAt, undefined);
    assert.equal(merged.startAt, base[0].startAt);
    assert.equal(base[0].endAt, '2026-10-18T23:59+08:00');
  }
});

test('manual description provenance persists and survives repository description updates', () => {
  const base = [{ ...baseEvents[0], descriptionSource: 'announcement' }];
  const raw = JSON.stringify({
    version: 2,
    overrides: { 'ys-1': { description: 'My curated summary', descriptionSource: 'manual' } },
    additions: [],
    deletedIds: []
  });
  const overlay = parsePersistedEventState(raw, base).overlay;
  const persisted = parsePersistedEventState(serializeEventState(overlay), base).overlay;
  const updatedRepository = [{ ...base[0], description: 'New automatic summary' }];
  const merged = mergeEventState(updatedRepository, persisted);
  assert.equal(merged[0].description, 'My curated summary');
  assert.equal(merged[0].descriptionSource, 'manual');
  assert.equal(JSON.parse(JSON.stringify(merged))[0].descriptionSource, 'manual');
});

test('legacy arrays migrate only local additions without freezing stale repository fields', () => {
  const legacy = [
    { ...baseEvents[0], title: 'Locally edited title' },
    {
      ...baseEvents[0],
      id: 'ys-99',
      title: 'Custom event',
      url: 'https://act.mihoyo.com/custom'
    }
  ];

  const parsed = parsePersistedEventState(JSON.stringify(legacy), baseEvents);
  const merged = mergeEventState(baseEvents, parsed.overlay);

  assert.equal(parsed.migrated, true);
  assert.equal(merged.find(event => event.id === 'ys-1').title, 'Base title');
  assert.equal(merged.some(event => event.id === 'sr-1'), true);
  assert.equal(merged.some(event => event.id === 'ys-99'), true);
});

test('versioned overlays persist edits, tombstones, and additions', () => {
  const raw = JSON.stringify({
    version: 2,
    overrides: { 'ys-1': { title: 'Persistent edit' } },
    deletedIds: ['sr-1'],
    additions: [{
      ...baseEvents[0],
      id: 'ys-2',
      title: 'Persistent addition',
      url: 'https://act.mihoyo.com/addition'
    }]
  });

  const reparsed = parsePersistedEventState(raw, baseEvents);
  const newRepositoryEvent = { ...baseEvents[0], id: 'bh3-1', gameKey: 'bh3' };
  const merged = mergeEventState([...baseEvents, newRepositoryEvent], reparsed.overlay);

  assert.equal(merged.find(event => event.id === 'ys-1').title, 'Persistent edit');
  assert.equal(merged.some(event => event.id === 'sr-1'), false);
  assert.equal(merged.some(event => event.id === 'ys-2'), true);
  assert.equal(merged.some(event => event.id === 'bh3-1'), true);
});

test('corrupt or incompatible storage falls back to repository data', () => {
  for (const raw of ['{broken', '42', '{}']) {
    const parsed = parsePersistedEventState(raw, baseEvents);
    assert.equal(parsed.error !== null, true);
    assert.deepEqual(mergeEventState(baseEvents, parsed.overlay), baseEvents);
  }
});

test('overlays can explicitly remove optional fields', () => {
  const baseWithEndDate = [{ ...baseEvents[0], endDate: '2026.01.31' }];
  const raw = JSON.stringify({
    version: 2,
    overrides: { 'ys-1': { endDate: null } },
    additions: [],
    deletedIds: []
  });
  const reparsed = parsePersistedEventState(raw, baseWithEndDate);

  assert.equal(reparsed.overlay.overrides['ys-1'].endDate, null);
  assert.equal(mergeEventState(baseWithEndDate, reparsed.overlay)[0].endDate, undefined);
});

test('time metadata persists through overlays, additions, JSON export, and explicit clearing', () => {
  const time = {
    startAt: '2026-01-01T08:00+08:00', endAt: '2026-01-31T23:59:00+08:00',
    timeSource: 'manual', timeSourceUrl: 'https://example.com/api?mode=detail',
    timeStages: [{ name: '活动', startAt: '2026-01-01T08:00+08:00', endAt: '2026-01-31T23:59:00+08:00' }]
  };
  const raw = JSON.stringify({
    version: 2, overrides: { 'ys-1': time }, deletedIds: [],
    additions: [{ ...baseEvents[0], ...time, id: 'ys-9', url: 'https://act.mihoyo.com/custom' }]
  });
  const overlay = parsePersistedEventState(raw, baseEvents).overlay;
  const reparsed = parsePersistedEventState(serializeEventState(overlay), baseEvents).overlay;
  for (const event of JSON.parse(JSON.stringify(mergeEventState(baseEvents, reparsed)))) {
    if (!['ys-1', 'ys-9'].includes(event.id)) continue;
    for (const field of Object.keys(time)) assert.deepEqual(event[field], time[field], field);
  }
  const withTime = [{ ...baseEvents[0], ...time }];
  const clear = JSON.stringify({
    version: 2, overrides: { 'ys-1': Object.fromEntries(Object.keys(time).map(field => [field, null])) },
    deletedIds: [], additions: []
  });
  const removed = parsePersistedEventState(clear, withTime).overlay;
  const persisted = parsePersistedEventState(serializeEventState(removed), withTime).overlay;
  const merged = mergeEventState(withTime, persisted)[0];
  for (const field of Object.keys(time)) {
    assert.equal(persisted.overrides['ys-1'][field], null, field);
    assert.equal(merged[field], undefined, field);
  }
});

test('cover edits and additions survive local persistence and JSON export', () => {
  const covers = {
    coverUrl: '/images/covers/ys-1.jpg',
    coverSourceUrl: 'https://example.com/image?mode=resize&signature=a%2Fb'
  };
  const raw = JSON.stringify({
    version: 2,
    overrides: { 'ys-1': covers },
    additions: [{ ...baseEvents[0], ...covers, id: 'ys-9', url: 'https://act.mihoyo.com/custom' }],
    deletedIds: []
  });
  const overlay = parsePersistedEventState(raw, baseEvents).overlay;
  const reparsed = parsePersistedEventState(serializeEventState(overlay), baseEvents);
  const exported = JSON.parse(JSON.stringify(mergeEventState(baseEvents, reparsed.overlay)));
  for (const id of ['ys-1', 'ys-9']) {
    const event = exported.find(event => event.id === id);
    assert.equal(event.coverUrl, covers.coverUrl);
    assert.equal(event.coverSourceUrl, covers.coverSourceUrl);
  }
});

test('title edits retain repository covers and explicit removals do not resurrect them', () => {
  const baseWithCovers = [{
    ...baseEvents[0],
    endDate: '2026.01.31',
    coverUrl: '/images/covers/ys-1.jpg',
    coverSourceUrl: 'https://example.com/image.jpg'
  }];
  const editedRaw = JSON.stringify({
    version: 2,
    overrides: { 'ys-1': { title: 'Edited title' } },
    additions: [],
    deletedIds: []
  });
  const edited = parsePersistedEventState(editedRaw, baseWithCovers).overlay;
  assert.equal(edited.overrides['ys-1'].coverUrl, undefined);
  const updatedRepositoryEvent = { ...baseWithCovers[0], endDate: '2026.02.28' };
  const mergedEditedEvent = mergeEventState([updatedRepositoryEvent], edited)[0];
  assert.equal(mergedEditedEvent.coverUrl, baseWithCovers[0].coverUrl);
  assert.equal(mergedEditedEvent.endDate, '2026.02.28');
  for (const value of [null, 'javascript:bad']) {
    const removedRaw = JSON.stringify({
      version: 2,
      overrides: { 'ys-1': { coverUrl: value, coverSourceUrl: value } },
      additions: [],
      deletedIds: []
    });
    const removed = parsePersistedEventState(removedRaw, baseWithCovers).overlay;
    const reparsed = parsePersistedEventState(serializeEventState(removed), baseWithCovers);
    const merged = mergeEventState(baseWithCovers, reparsed.overlay)[0];
    assert.equal(removed.overrides['ys-1'].coverUrl, null);
    assert.equal(removed.overrides['ys-1'].coverSourceUrl, null);
    assert.equal(merged.coverUrl, undefined);
    assert.equal(merged.coverSourceUrl, undefined);
  }
});

test('invalid additions are dropped and invalid override fields fall back to repository values', () => {
  const raw = JSON.stringify({
    version: 2,
    overrides: {
      'ys-1': { title: 42, date: 'bad', tags: 'bad' }
    },
    additions: [
      { id: 'ys-9', title: '', url: 'javascript:bad', gameKey: 'ys' }
    ],
    deletedIds: []
  });
  const merged = mergeEventState(baseEvents, parsePersistedEventState(raw, baseEvents).overlay);

  assert.equal(merged.find(event => event.id === 'ys-1').title, 'Base title');
  assert.equal(merged.find(event => event.id === 'ys-1').date, '2026.01.01');
  assert.deepEqual(merged.find(event => event.id === 'ys-1').tags, ['网页活动']);
  assert.equal(merged.some(event => event.id === 'ys-9'), false);
});

test('duplicate additions are normalized to one event ID', () => {
  const addition = {
    ...baseEvents[0],
    id: 'ys-9',
    url: 'https://act.mihoyo.com/custom'
  };
  const raw = JSON.stringify({
    version: 2,
    overrides: {},
    additions: [addition, { ...addition, title: 'Last value wins' }],
    deletedIds: []
  });
  const merged = mergeEventState(baseEvents, parsePersistedEventState(raw, baseEvents).overlay);

  assert.equal(merged.filter(event => event.id === 'ys-9').length, 1);
  assert.equal(merged.find(event => event.id === 'ys-9').title, 'Last value wins');
});
