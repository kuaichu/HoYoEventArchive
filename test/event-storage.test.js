import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createEmptyEventOverlay,
  deleteEventFromOverlay,
  mergeEventState,
  nextEventId,
  parsePersistedEventState,
  serializeEventState,
  upsertEventInOverlay
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

test('manual description provenance persists and survives repository description updates', () => {
  const base = [{ ...baseEvents[0], descriptionSource: 'announcement' }];
  const overlay = upsertEventInOverlay(createEmptyEventOverlay(), base, {
    ...base[0], description: 'My curated summary', descriptionSource: 'manual'
  });
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
  let overlay = createEmptyEventOverlay();
  overlay = upsertEventInOverlay(overlay, baseEvents, {
    ...baseEvents[0],
    title: 'Persistent edit'
  });
  overlay = deleteEventFromOverlay(overlay, baseEvents, 'sr-1');
  overlay = upsertEventInOverlay(overlay, baseEvents, {
    ...baseEvents[0],
    id: 'ys-2',
    title: 'Persistent addition',
    url: 'https://act.mihoyo.com/addition'
  });

  const reparsed = parsePersistedEventState(serializeEventState(overlay), baseEvents);
  const merged = mergeEventState(baseEvents, reparsed.overlay);

  assert.equal(merged.find(event => event.id === 'ys-1').title, 'Persistent edit');
  assert.equal(merged.some(event => event.id === 'sr-1'), false);
  assert.equal(merged.some(event => event.id === 'ys-2'), true);
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
  const overlay = upsertEventInOverlay(createEmptyEventOverlay(), baseWithEndDate, {
    ...baseWithEndDate[0],
    endDate: undefined
  });
  const reparsed = parsePersistedEventState(serializeEventState(overlay), baseWithEndDate);

  assert.equal(overlay.overrides['ys-1'].endDate, null);
  assert.equal(mergeEventState(baseWithEndDate, reparsed.overlay)[0].endDate, undefined);
});

test('cover edits and additions survive local persistence and JSON export', () => {
  const covers = {
    coverUrl: '/images/covers/ys-1.jpg',
    coverSourceUrl: 'https://example.com/image?mode=resize&signature=a%2Fb'
  };
  let overlay = upsertEventInOverlay(createEmptyEventOverlay(), baseEvents, {
    ...baseEvents[0], ...covers
  });
  overlay = upsertEventInOverlay(overlay, baseEvents, {
    ...baseEvents[0], ...covers, id: 'ys-9', url: 'https://act.mihoyo.com/custom'
  });
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
    coverUrl: '/images/covers/ys-1.jpg',
    coverSourceUrl: 'https://example.com/image.jpg'
  }];
  const edited = upsertEventInOverlay(createEmptyEventOverlay(), baseWithCovers, {
    ...baseWithCovers[0], title: 'Edited title'
  });
  assert.equal(edited.overrides['ys-1'].coverUrl, undefined);
  assert.equal(mergeEventState(baseWithCovers, edited)[0].coverUrl, baseWithCovers[0].coverUrl);
  for (const value of [null, 'javascript:bad']) {
    const removed = upsertEventInOverlay(edited, baseWithCovers, {
      ...baseWithCovers[0], coverUrl: value, coverSourceUrl: value
    });
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

test('new IDs never reuse deleted or repository-backed IDs', () => {
  const overlay = {
    version: 2,
    overrides: {},
    additions: [{ ...baseEvents[0], id: 'ys-3', url: 'https://act.mihoyo.com/three' }],
    deletedIds: ['ys-2']
  };
  const base = [baseEvents[0], { ...baseEvents[0], id: 'ys-2' }];

  assert.equal(nextEventId('ys', base, overlay), 'ys-4');
});
