import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_LIST_STATE, parseLocation } from '../src/app-route.js';
import { createDetailNavigation } from '../src/detail-navigation.js';

const listRoute = name => ({ name, listState: { ...DEFAULT_LIST_STATE } });

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

test('page navigation pushes, replaces, and avoids duplicate history entries', () => {
  const browser = createBrowserHarness('/');
  const rendered = [];
  const navigation = createDetailNavigation({
    history: browser.history,
    location: browser.location,
    renderRoute: route => rendered.push(route)
  });

  navigation.navigate({ name: 'events' });
  navigation.navigate({ name: 'events' });
  navigation.replace({ name: 'timeline' });

  assert.equal(browser.location.pathname, '/timeline');
  assert.deepEqual(rendered, [
    listRoute('events'),
    listRoute('events'),
    { name: 'timeline' }
  ]);
  assert.deepEqual(browser.counts(), { pushCalls: 1, replaceCalls: 1, backCalls: 0 });
});

test('replay canonicalizes legacy and trailing-slash paths with replace only', () => {
  const browser = createBrowserHarness('/index.html');
  const rendered = [];
  const navigation = createDetailNavigation({
    history: browser.history,
    location: browser.location,
    renderRoute: route => rendered.push(route)
  });

  navigation.replay();

  assert.equal(browser.location.pathname, '/');
  assert.deepEqual(rendered, [listRoute('home')]);
  assert.deepEqual(browser.counts(), { pushCalls: 0, replaceCalls: 1, backCalls: 0 });
});

test('replay canonicalizes the complete pathname and search with replace only', () => {
  const browser = createBrowserHarness('/events?layout=list&game=ys&unknown=1');
  const rendered = [];
  const navigation = createDetailNavigation({
    history: browser.history,
    location: browser.location,
    renderRoute: route => rendered.push(route)
  });

  navigation.replay();

  assert.equal(browser.location.pathname, '/events');
  assert.equal(browser.location.search, '?game=ys&layout=list');
  assert.equal(rendered[0].listState.game, 'ys');
  assert.equal(rendered[0].listState.layout, 'list');
  assert.deepEqual(browser.counts(), { pushCalls: 0, replaceCalls: 1, backCalls: 0 });
});

test('same-path query updates replace in place and identical canonical URLs do not write history', () => {
  const browser = createBrowserHarness('/events?game=ys');
  const navigation = createDetailNavigation({
    history: browser.history,
    location: browser.location,
    renderRoute: () => {}
  });

  navigation.replace(parseLocation('/events', '?game=ys&layout=list'));
  navigation.replace(parseLocation('/events', '?game=ys&layout=list'));

  assert.equal(browser.location.search, '?game=ys&layout=list');
  assert.deepEqual(browser.counts(), { pushCalls: 0, replaceCalls: 1, backCalls: 0 });
});

test('detail URLs stay clean and Back replays the complete filtered source URL', () => {
  const browser = createBrowserHarness('/events?tab=latest&game=ys&layout=list');
  const rendered = [];
  const navigation = createDetailNavigation({
    history: browser.history,
    location: browser.location,
    renderRoute: route => rendered.push(route)
  });

  navigation.openEvent('ys-1');
  assert.equal(`${browser.location.pathname}${browser.location.search}`, '/events/ys-1');
  navigation.closeDetail();
  navigation.replay();

  assert.equal(
    `${browser.location.pathname}${browser.location.search}`,
    '/events?tab=latest&game=ys&layout=list'
  );
  assert.equal(rendered.at(-1).listState.tab, 'latest');
  assert.equal(rendered.at(-1).listState.game, 'ys');
  assert.deepEqual(browser.counts(), { pushCalls: 1, replaceCalls: 0, backCalls: 1 });
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
    listRoute('home'),
    { name: 'event', eventId: 'gen-1' }
  ]);
  assert.deepEqual(browser.counts(), { pushCalls: 1, replaceCalls: 0, backCalls: 1 });
});

test('details return to every supported source view and Forward reopens without pushing', () => {
  for (const sourcePath of [
    '/', '/events', '/games/ys', '/timeline', '/reports', '/returns', '/expired', '/favorites', '/about'
  ]) {
    const browser = createBrowserHarness(sourcePath);
    const rendered = [];
    const navigation = createDetailNavigation({
      history: browser.history,
      location: browser.location,
      renderRoute: route => rendered.push(route)
    });

    navigation.openEvent('gen-1');
    navigation.closeDetail();
    navigation.replay();
    browser.history.forward();
    navigation.replay();

    assert.deepEqual(rendered.at(-2), parseLocation(sourcePath, ''));
    assert.deepEqual(rendered.at(-1), { name: 'event', eventId: 'gen-1' });
    assert.deepEqual(browser.counts(), { pushCalls: 1, replaceCalls: 0, backCalls: 1 });
  }
});

test('a directly loaded detail closes safely by replacing the URL with the events route', () => {
  const browser = createBrowserHarness('/events/ys-1', { unrelated: 'preserved' });
  const rendered = [];
  const navigation = createDetailNavigation({
    history: browser.history,
    location: browser.location,
    renderRoute: route => rendered.push(route)
  });

  navigation.replay();
  navigation.closeDetail();

  assert.equal(browser.location.pathname, '/events');
  assert.deepEqual(browser.history.state, { unrelated: 'preserved' });
  assert.deepEqual(rendered, [
    { name: 'event', eventId: 'ys-1' },
    listRoute('events')
  ]);
  assert.deepEqual(browser.counts(), { pushCalls: 0, replaceCalls: 1, backCalls: 0 });
});

test('invalid event paths close to the library while unrelated unknown paths close home', () => {
  for (const [initialPath, expectedPath, expectedRoute] of [
    ['/events/not-an-id!', '/events', listRoute('events')],
    ['/unknown/path', '/', listRoute('home')]
  ]) {
    const browser = createBrowserHarness(initialPath);
    const rendered = [];
    const navigation = createDetailNavigation({
      history: browser.history,
      location: browser.location,
      renderRoute: route => rendered.push(route)
    });

    navigation.closeDetail();

    assert.equal(browser.location.pathname, expectedPath);
    assert.deepEqual(rendered, [expectedRoute]);
    assert.deepEqual(browser.counts(), { pushCalls: 0, replaceCalls: 1, backCalls: 0 });
  }
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
