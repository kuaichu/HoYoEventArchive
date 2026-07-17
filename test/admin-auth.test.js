import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { handleAdminRequest, verifyBasicAuthorization } from '../functions/_middleware.js';

const fixturePassword = 'fixture-password';
const fixtureSalt = new TextEncoder().encode('fixture-salt-123');
const fixtureConfig = {
  username: 'admin',
  salt: fixtureSalt,
  verifier: new Uint8Array(
    createHash('sha256')
      .update(Buffer.concat([
        Buffer.from(fixtureSalt),
        Buffer.from([0]),
        Buffer.from(`admin:${fixturePassword}`, 'utf8')
      ]))
      .digest()
  )
};

function basic(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

function contextFor(pathname, authorization) {
  let nextCalls = 0;
  return {
    context: {
      request: new Request(`https://example.test${pathname}`, {
        headers: authorization ? { Authorization: authorization } : {}
      }),
      next: async () => {
        nextCalls++;
        return new Response('protected admin html', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=UTF-8' }
        });
      }
    },
    getNextCalls: () => nextCalls
  };
}

test('admin password verification accepts only the configured username and password', async () => {
  assert.equal(await verifyBasicAuthorization(basic('admin', fixturePassword), fixtureConfig), true);
  assert.equal(await verifyBasicAuthorization(basic('admin', 'wrong-password'), fixtureConfig), false);
  assert.equal(await verifyBasicAuthorization(basic('someone-else', fixturePassword), fixtureConfig), false);
  assert.equal(await verifyBasicAuthorization('Bearer token', fixtureConfig), false);
});

test('admin routes reject anonymous access before serving static HTML', async () => {
  for (const pathname of ['/admin', '/admin/', '/admin.html']) {
    const fixture = contextFor(pathname);
    const response = await handleAdminRequest(fixture.context, fixtureConfig);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('WWW-Authenticate'), /^Basic /);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(fixture.getNextCalls(), 0);
  }
});

test('valid admin credentials serve a private non-cacheable response', async () => {
  const fixture = contextFor('/admin', basic('admin', fixturePassword));
  const response = await handleAdminRequest(fixture.context, fixtureConfig);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'protected admin html');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.match(response.headers.get('Vary'), /Authorization/);
  assert.equal(fixture.getNextCalls(), 1);
});

test('public routes bypass admin authentication', async () => {
  const fixture = contextFor('/index.html');
  const response = await handleAdminRequest(fixture.context, fixtureConfig);
  assert.equal(response.status, 200);
  assert.equal(fixture.getNextCalls(), 1);
});
