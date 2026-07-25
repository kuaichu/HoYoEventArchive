import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLocation, serializeRoute } from '../src/app-route.js';
import {
  clearListRoute,
  routeMatchesLocation,
  updateListRoute
} from '../src/list-route-actions.js';

const events = [
  { gameKey: 'ys', version: 'v6.0' },
  { gameKey: 'sr', version: 'v3.1' },
  { gameKey: 'sr', version: '通用' }
];

test('game changes honor game paths and clear versions that do not belong to the next game', () => {
  const source = parseLocation('/games/ys', '?version=v6.0&status=available');
  assert.equal(
    serializeRoute(updateListRoute(source, { game: 'sr' }, events)),
    '/games/sr?status=available'
  );
  assert.equal(
    serializeRoute(updateListRoute(source, { game: 'all' }, events)),
    '/events?status=available'
  );

  const ordinary = parseLocation('/reports', '?game=ys&version=v6.0');
  assert.equal(
    serializeRoute(updateListRoute(ordinary, { game: 'sr' }, events)),
    '/reports?game=sr'
  );
});

test('fixed type, status, and favorites paths move to events when their preset changes', () => {
  assert.equal(
    serializeRoute(updateListRoute(parseLocation('/reports'), { type: '小游戏' }, events)),
    '/events?type=minigame'
  );
  assert.equal(
    serializeRoute(updateListRoute(parseLocation('/expired'), { status: '可访问' }, events)),
    '/events?status=available'
  );
  assert.equal(
    serializeRoute(updateListRoute(parseLocation('/favorites'), { tab: 'popular' }, events)),
    '/events?tab=popular'
  );
});

test('clearing list state preserves only pathname semantics', () => {
  for (const [url, expected] of [
    ['/events?game=ys&layout=list', '/events'],
    ['/games/ys?version=v6.0', '/games/ys'],
    ['/reports?game=ys', '/reports'],
    ['/favorites?game=ys', '/favorites'],
    ['/?q=周年', '/']
  ]) {
    assert.equal(serializeRoute(clearListRoute(parseLocation(url))), expected);
  }
});

test('deferred list updates apply only while the originating canonical route is current', () => {
  const route = parseLocation('/', '?q=周年&layout=list');
  assert.equal(routeMatchesLocation(route, '/', '?q=%E5%91%A8%E5%B9%B4&layout=list'), true);
  assert.equal(routeMatchesLocation(route, '/events/ys-1', ''), false);
  assert.equal(routeMatchesLocation(route, '/', '?layout=list'), false);
});
