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

const repositoryEvents = JSON.parse(
  readFileSync(new URL('../src/events.json', import.meta.url), 'utf8')
);

test('the home location always serializes as the root path', () => {
  assert.deepEqual(parseLocation('/', ''), { name: 'home' });
  assert.equal(serializeRoute({ name: 'home' }), '/');
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
