import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldNavigateInApp } from '../src/navigation-link.js';

function click(overrides = {}) {
  return {
    button: 0,
    defaultPrevented: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides
  };
}

function anchor(overrides = {}) {
  return {
    href: 'https://archive.test/events',
    target: '',
    hasAttribute: () => false,
    ...overrides
  };
}

test('ordinary left clicks on same-origin route links use app navigation', () => {
  assert.equal(
    shouldNavigateInApp(click(), anchor(), { origin: 'https://archive.test' }),
    true
  );
});

test('modified, middle, new-tab, download, and external links keep native behavior', () => {
  const currentLocation = { origin: 'https://archive.test' };
  for (const event of [
    click({ button: 1 }),
    click({ ctrlKey: true }),
    click({ metaKey: true }),
    click({ shiftKey: true }),
    click({ altKey: true })
  ]) {
    assert.equal(shouldNavigateInApp(event, anchor(), currentLocation), false);
  }
  assert.equal(
    shouldNavigateInApp(click(), anchor({ target: '_blank' }), currentLocation),
    false
  );
  assert.equal(
    shouldNavigateInApp(
      click(),
      anchor({ hasAttribute: name => name === 'download' }),
      currentLocation
    ),
    false
  );
  assert.equal(
    shouldNavigateInApp(
      click(),
      anchor({ href: 'https://external.test/events' }),
      currentLocation
    ),
    false
  );
});
