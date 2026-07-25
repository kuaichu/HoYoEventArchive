import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canonicalizeRoute,
  parseLocation,
  resolveEventRoute,
  serializeRoute,
  validateEventId
} from '../src/app-route.js';
import { mergeEventState } from '../src/event-storage.js';

const defaultListState = {
  tab: 'all', game: 'all', version: 'all', type: 'all', status: 'all',
  q: '', sort: 'date-desc', layout: 'grid'
};

function listRoute(name, listState = {}, extra = {}) {
  const fixed = name === 'game' ? { game: extra.gameKey }
    : name === 'reports' ? { type: '年度报告' }
      : name === 'returns' ? { type: '回归活动' }
        : name === 'expired' ? { status: '已失效' }
          : {};
  return { name, ...extra, listState: { ...defaultListState, ...fixed, ...listState } };
}

const repositoryEvents = JSON.parse(
  readFileSync(new URL('../src/events.json', import.meta.url), 'utf8')
);

test('the home location always serializes as the root path', () => {
  assert.deepEqual(parseLocation('/', ''), listRoute('home'));
  assert.equal(serializeRoute({ name: 'home' }), '/');
});

test('list routes parse valid query values and serialize them in canonical order', () => {
  const route = parseLocation(
    '/events',
    '?layout=list&status=available&type=preview&version=v6.0&game=ys&tab=latest&sort=date-asc'
  );

  assert.deepEqual(route, {
    name: 'events',
    listState: {
      tab: 'latest',
      game: 'ys',
      version: 'v6.0',
      type: '版本前瞻',
      status: '可访问',
      q: '',
      sort: 'date-asc',
      layout: 'list'
    }
  });
  assert.equal(
    serializeRoute(route),
    '/events?tab=latest&game=ys&version=v6.0&type=preview&status=available&sort=date-asc&layout=list'
  );
});

test('every documented enum value round-trips through the public query contract', () => {
  for (const tab of ['latest', 'ending', 'popular']) {
    assert.equal(serializeRoute(parseLocation('/events', `?tab=${tab}`)), `/events?tab=${tab}`);
  }
  for (const game of ['ys', 'sr', 'zzz', 'bh3']) {
    assert.equal(serializeRoute(parseLocation('/events', `?game=${game}`)), `/events?game=${game}`);
  }
  for (const type of ['report', 'return', 'preview', 'minigame', 'resource', 'prereg', 'collab', 'other']) {
    assert.equal(serializeRoute(parseLocation('/events', `?type=${type}`)), `/events?type=${type}`);
  }
  for (const status of ['available', 'expired', 'login', 'ended']) {
    assert.equal(serializeRoute(parseLocation('/events', `?status=${status}`)), `/events?status=${status}`);
  }
  for (const sort of ['date-asc', 'title-asc', 'status-asc']) {
    assert.equal(serializeRoute(parseLocation('/events', `?sort=${sort}`)), `/events?sort=${sort}`);
  }
  assert.equal(serializeRoute(parseLocation('/events', '?layout=list')), '/events?layout=list');
});

test('list query canonicalization removes unknown, invalid, default, repeated, and conflicting values', () => {
  assert.deepEqual(
    parseLocation('/events', '?tab=bogus&tab=latest&game=all&version=v6.0&sort=date-desc&layout=grid&x=1'),
    { name: 'events', listState: defaultListState }
  );
  assert.equal(
    serializeRoute(parseLocation('/events', '?tab=bogus&tab=latest&game=all&version=v6.0&x=1')),
    '/events'
  );
  assert.deepEqual(parseLocation('/games/ys', '?game=sr&type=preview').listState, {
    ...defaultListState,
    game: 'ys',
    type: '版本前瞻'
  });
  assert.equal(
    serializeRoute(parseLocation('/games/ys', '?game=sr&type=preview')),
    '/games/ys?type=preview'
  );
});

test('search text is home-only, trimmed, encoded safely, and limited to 100 characters', () => {
  const longQuery = `  周年${'测'.repeat(120)}  `;
  const route = parseLocation('/', `?q=${encodeURIComponent(longQuery)}`);
  assert.equal(Array.from(route.listState.q).length, 100);
  assert.equal(route.listState.q.startsWith('周年'), true);
  assert.equal(serializeRoute(route).startsWith('/?q=%E5%91%A8%E5%B9%B4'), true);

  assert.equal(parseLocation('/events', '?q=周年').listState.q, '');
  assert.equal(serializeRoute(parseLocation('/events', '?q=周年')), '/events');
});

test('special version slugs map to internal values only when a valid game is selected', () => {
  for (const [slug, value] of [
    ['prelaunch', '公测前'], ['general', '通用'], ['pending', '待确认']
  ]) {
    const route = parseLocation('/events', `?game=sr&version=${slug}`);
    assert.equal(route.listState.version, value);
    assert.equal(serializeRoute(route), `/events?game=sr&version=${slug}`);
  }
  assert.equal(parseLocation('/events', '?version=general').listState.version, 'all');
  assert.equal(serializeRoute(parseLocation('/events', '?version=general')), '/events');
});

test('fixed list routes remove query values that conflict with pathname semantics', () => {
  const cases = [
    ['/favorites?tab=popular', '/favorites', 'tab', 'all'],
    ['/reports?type=return', '/reports', 'type', '年度报告'],
    ['/returns?type=report', '/returns', 'type', '回归活动'],
    ['/expired?status=available', '/expired', 'status', '已失效']
  ];
  for (const [url, canonicalUrl, key, value] of cases) {
    const route = parseLocation(url);
    assert.equal(route.listState[key], value);
    assert.equal(serializeRoute(route), canonicalUrl);
  }
});

test('non-list routes discard list query and parse/serialize remains idempotent', () => {
  for (const url of ['/timeline?game=ys', '/about?layout=list', '/events/ys-1?tab=latest']) {
    const first = parseLocation(url);
    const canonicalUrl = serializeRoute(first);
    const second = parseLocation(canonicalUrl);
    assert.deepEqual(second, first);
    assert.equal(canonicalUrl.includes('?'), false);
  }
});

test('primary archive views have stable public paths', () => {
  const routes = new Map([
    ['/events', listRoute('events')],
    ['/timeline', { name: 'timeline' }],
    ['/reports', listRoute('reports')],
    ['/returns', listRoute('returns')],
    ['/expired', listRoute('expired')],
    ['/favorites', listRoute('favorites')],
    ['/about', { name: 'about' }]
  ]);

  for (const [pathname, route] of routes) {
    assert.deepEqual(parseLocation(pathname, ''), route);
    assert.equal(serializeRoute(route), pathname);
  }
});

test('game routes accept only the archive game keys', () => {
  for (const gameKey of ['ys', 'sr', 'zzz', 'bh3']) {
    const route = listRoute('game', {}, { gameKey });
    assert.deepEqual(parseLocation(`/games/${gameKey}`, ''), route);
    assert.equal(serializeRoute(route), `/games/${gameKey}`);
  }

  for (const pathname of ['/games/all', '/games/genshin', '/games/YS', '/games/ys/extra']) {
    assert.deepEqual(parseLocation(pathname, ''), { name: 'not-found', pathname });
  }
});

test('legacy, trailing-slash, and encoded paths canonicalize without changing route meaning', () => {
  const examples = new Map([
    ['/index.html', listRoute('home')],
    ['/events/', listRoute('events')],
    ['/timeline///', { name: 'timeline' }],
    ['/games/ys/', listRoute('game', {}, { gameKey: 'ys' })],
    ['/games/%79%73', listRoute('game', {}, { gameKey: 'ys' })]
  ]);

  for (const [pathname, route] of examples) {
    assert.deepEqual(parseLocation(pathname, '?ignored=phase-two'), route);
    assert.deepEqual(parseLocation(serializeRoute(route), ''), route);
  }
  assert.equal(serializeRoute(parseLocation('/index.html', '')), '/');
});

test('ordinary and cross-game event ids parse as opaque event routes', () => {
  for (const eventId of ['ys-1', 'gen-1']) {
    const route = { name: 'event', eventId };
    assert.deepEqual(parseLocation(`/events/${eventId}`, ''), route);
    assert.equal(serializeRoute(route), `/events/${eventId}`);
  }
});

test('event paths normalize trailing slashes and percent-encoded ids', () => {
  for (const pathname of ['/events/gen-1/', '/events/gen%2D1']) {
    const route = parseLocation(pathname, '?ignored=phase-one');
    assert.deepEqual(route, { name: 'event', eventId: 'gen-1' });
    assert.equal(serializeRoute(route), '/events/gen-1');
  }
});

test('invalid event ids, repeated slashes, and unknown paths remain not-found routes', () => {
  assert.equal(validateEventId('gen-1'), true);
  assert.equal(validateEventId('event'), false);
  assert.equal(validateEventId('ys-1?admin'), false);

  for (const pathname of [
    '/events/not-an-id!',
    '/events/%E0%A4%A',
    '/events//ys-1',
    '/unknown/path'
  ]) {
    const route = parseLocation(pathname, '');
    assert.deepEqual(route, { name: 'not-found', pathname });
    assert.equal(serializeRoute(route), pathname);
    assert.deepEqual(parseLocation(serializeRoute(route), ''), route);
  }

  assert.deepEqual(canonicalizeRoute({ name: 'event', eventId: 'invalid' }), {
    name: 'not-found',
    pathname: '/events/invalid'
  });
});

test('event routes resolve only against the final visible event collection', () => {
  const repositoryEvent = repositoryEvents.find(event => event.id === 'gen-1');
  const tombstonedEvent = repositoryEvents.find(event => event.id === 'ys-1');
  assert.ok(repositoryEvent);
  assert.ok(tombstonedEvent);

  const addition = {
    ...repositoryEvent,
    id: 'custom-1',
    title: 'Overlay addition',
    url: 'https://example.test/custom-1'
  };
  const finalVisibleEvents = mergeEventState(repositoryEvents, {
    version: 2,
    overrides: {},
    additions: [addition],
    deletedIds: [tombstonedEvent.id]
  });

  assert.deepEqual(
    resolveEventRoute({ name: 'event', eventId: repositoryEvent.id }, finalVisibleEvents),
    { status: 'found', event: repositoryEvent }
  );
  assert.deepEqual(
    resolveEventRoute({ name: 'event', eventId: 'custom-1' }, finalVisibleEvents),
    { status: 'found', event: addition }
  );
  assert.deepEqual(
    resolveEventRoute({ name: 'event', eventId: tombstonedEvent.id }, finalVisibleEvents),
    { status: 'missing', eventId: tombstonedEvent.id }
  );
  assert.deepEqual(
    resolveEventRoute({ name: 'event', eventId: 'ys-999' }, finalVisibleEvents),
    { status: 'missing', eventId: 'ys-999' }
  );
});

test('parse and serialize reach a stable canonical route', () => {
  for (const pathname of [
    '/',
    '/index.html',
    '/events',
    '/events/',
    '/games/ys',
    '/games/%79%73',
    '/timeline/',
    '/reports',
    '/returns',
    '/expired',
    '/favorites',
    '/about',
    '/events/ys-1',
    '/events/gen-1/',
    '/events/gen%2D1',
    '/events//ys-1',
    '/unknown/path'
  ]) {
    const firstRoute = parseLocation(pathname, '?layout=list');
    const canonicalUrl = serializeRoute(firstRoute);
    const secondRoute = parseLocation(canonicalUrl, '');
    assert.deepEqual(secondRoute, firstRoute);
    assert.equal(serializeRoute(secondRoute), canonicalUrl);
  }
});
