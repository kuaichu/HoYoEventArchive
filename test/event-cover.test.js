import assert from 'node:assert/strict';
import test from 'node:test';
import { eventImageCandidates, setEventImage } from '../src/event-cover.js';
import { GAME_META } from '../src/event-domain.js';

const event = {
  id: 'ys-1', gameKey: 'ys', status: '可访问',
  coverUrl: '/images/covers/ys-1.jpg', coverSourceUrl: 'https://example.com/image.jpg?mode=resize'
};

test('images prefer archived official covers, then their remote source, screenshots, and game defaults', () => {
  assert.deepEqual(eventImageCandidates(event), [
    event.coverUrl, event.coverSourceUrl, '/images/screenshots/ys-1.png', GAME_META.ys.cover
  ]);
  assert.deepEqual(eventImageCandidates({ ...event, coverUrl: 'javascript:bad', coverSourceUrl: null }), [
    '/images/screenshots/ys-1.png', GAME_META.ys.cover
  ]);
  assert.deepEqual(eventImageCandidates({ ...event, coverUrl: event.coverSourceUrl }), [
    event.coverSourceUrl, '/images/screenshots/ys-1.png', GAME_META.ys.cover
  ]);
});

test('expired records retain official covers but keep the game default when no official image exists', () => {
  assert.equal(eventImageCandidates({ ...event, status: '已失效' })[0], event.coverUrl);
  assert.deepEqual(eventImageCandidates({ ...event, status: '已失效', coverUrl: null, coverSourceUrl: null }), [
    GAME_META.ys.cover
  ]);
  assert.equal(eventImageCandidates({ ...event, status: '已失效', coverUrl: null })[0], event.coverSourceUrl);
});

test('build versions invalidate archived image caches without rewriting remote image queries', () => {
  assert.deepEqual(eventImageCandidates(event, 'next build'), [
    `${event.coverUrl}?v=next%20build`, event.coverSourceUrl,
    '/images/screenshots/ys-1.png?v=next%20build', GAME_META.ys.cover
  ]);
});

test('image errors advance through each candidate once and stop at the game default', () => {
  const sources = [];
  const image = { set src(value) { sources.push(value); } };
  setEventImage(image, event);
  assert.equal(image.referrerPolicy, 'no-referrer');
  while (image.onerror) image.onerror();
  assert.deepEqual(sources, eventImageCandidates(event));
  assert.equal(image.onerror, null);
});

test('reusing the detail image replaces the previous failure chain', () => {
  const image = {};
  setEventImage(image, event);
  image.onerror();
  setEventImage(image, { id: 'sr-1', gameKey: 'sr', status: '已失效' });
  assert.equal(image.src, GAME_META.sr.cover);
  assert.equal(image.onerror, null);
});
