import assert from 'node:assert/strict';
import test from 'node:test';

import { createDetailNavigation } from '../src/detail-navigation.js';

function createBrowserHarness(initialUrl = '/', initialState = null, deferBack = false) {
  const entries = [{ url: initialUrl, state: initialState }];
  let index = 0;
  let pushCalls = 0;
  let replaceCalls = 0;
  let backCalls = 0;

  const location = { pathname: '/', search: '' };
  const applyUrl = value => {
    const url = new URL(value, 'https://example.test');
    location.pathname = url.pathname;
    location.search = url.search;
  };
  applyUrl(initialUrl);

  const history = {
    get state() {
      return entries[index].state;
    },
    pushState(state, _title, url) {
      pushCalls++;
      entries.splice(index + 1);
      entries.push({ state, url });
      index = entries.length - 1;
      applyUrl(url);
    },
    replaceState(state, _title, url) {
      replaceCalls++;
      entries[index] = { state, url };
      applyUrl(url);
    },
    back() {
      backCalls++;
      if (deferBack) return;
      if (index > 0) index--;
      applyUrl(entries[index].url);
    },
    forward() {
      if (index < entries.length - 1) index++;
      applyUrl(entries[index].url);
    }
  };

  return {
    history,
    location,
    counts: () => ({ pushCalls, replaceCalls, backCalls })
  };
}

test('opening a detail from an event card pushes its URL and renders it once', () => {
  const browser = createBrowserHarness('/');
  const rendered = [];
  const navigation = createDetailNavigation({
    history: browser.history,
    location: browser.location,
    renderRoute: route => rendered.push(route)
  });

  navigation.openEvent('ys-1');

  assert.equal(browser.location.pathname, '/events/ys-1');
  assert.deepEqual(rendered, [{ name: 'event', eventId: 'ys-1' }]);
  assert.deepEqual(browser.counts(), { pushCalls: 1, replaceCalls: 0, backCalls: 0 });
});

test('Back closes an internally opened detail and Forward reopens it without another push', () => {
  const browser = createBrowserHarness('/');
  const rendered = [];
  const navigation = createDetailNavigation({
    history: browser.history,
    location: browser.location,
    renderRoute: route => rendered.push(route)
  });

  navigation.openEvent('gen-1');
  navigation.closeDetail();
  navigation.replay(); // popstate after Back
  browser.history.forward();
  navigation.replay(); // popstate after Forward

  assert.deepEqual(rendered, [
    { name: 'event', eventId: 'gen-1' },
    { name: 'home' },
    { name: 'event', eventId: 'gen-1' }
  ]);
  assert.deepEqual(browser.counts(), { pushCalls: 1, replaceCalls: 0, backCalls: 1 });
});

test('a directly loaded detail closes safely by replacing the URL with the home route', () => {
  const browser = createBrowserHarness('/events/ys-1', { unrelated: 'preserved' });
  const rendered = [];
  const navigation = createDetailNavigation({
    history: browser.history,
    location: browser.location,
    renderRoute: route => rendered.push(route)
  });

  navigation.replay();
  navigation.closeDetail();

  assert.equal(browser.location.pathname, '/');
  assert.deepEqual(browser.history.state, { unrelated: 'preserved' });
  assert.deepEqual(rendered, [
    { name: 'event', eventId: 'ys-1' },
    { name: 'home' }
  ]);
  assert.deepEqual(browser.counts(), { pushCalls: 0, replaceCalls: 1, backCalls: 0 });
});

test('timeline activations use the same push-only detail navigation', () => {
  const browser = createBrowserHarness('/');
  const rendered = [];
  const navigation = createDetailNavigation({
    history: browser.history,
    location: browser.location,
    renderRoute: route => rendered.push(route)
  });

  navigation.openEvent('custom-1');

  assert.equal(browser.location.pathname, '/events/custom-1');
  assert.deepEqual(rendered, [{ name: 'event', eventId: 'custom-1' }]);
  assert.equal(browser.counts().pushCalls, 1);
});

test('repeated close requests before popstate cannot skip past the previous page', () => {
  const browser = createBrowserHarness('/', null, true);
  const navigation = createDetailNavigation({
    history: browser.history,
    location: browser.location,
    renderRoute: () => {}
  });

  navigation.openEvent('ys-1');
  navigation.closeDetail();
  navigation.closeDetail();

  assert.equal(browser.counts().backCalls, 1);
});
