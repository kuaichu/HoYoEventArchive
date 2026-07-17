import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifySourceProcessingOutcome,
  fetchForumPosts,
  shouldFailCrawler
} from '../scripts/miyoushe-crawler.js';
import {
  classifyEventPageState,
  navigateWithRetries,
  screenshotNavigationUrl,
  selectMissingScreenshotEvents
} from '../scripts/capture-screenshots.js';
import { collectEventUpdates } from '../scripts/summarize-event-updates.js';
import { summarizeDeliveries } from '../scripts/tg-notify.js';

test('crawler fails only when every configured source failed', () => {
  assert.equal(
    shouldFailCrawler([
      { status: 'failed' },
      { status: 'failed' },
      { status: 'failed' },
      { status: 'failed' }
    ]),
    true
  );
  assert.equal(
    shouldFailCrawler([
      { status: 'failed' },
      { status: 'partial' },
      { status: 'failed' }
    ]),
    false
  );
  assert.equal(
    shouldFailCrawler([
      { status: 'failed' },
      { status: 'ok' }
    ]),
    false
  );
  assert.equal(shouldFailCrawler([]), true);
});

test('forum pagination distinguishes failed, partial, and valid empty sources', async () => {
  const game = { name: '测试游戏', forumId: 1 };

  const failed = await fetchForumPosts(game, async () => {
    throw new Error('offline');
  });
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.posts, []);

  let requestCount = 0;
  const partial = await fetchForumPosts(game, async () => {
    requestCount++;
    if (requestCount === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          retcode: 0,
          data: { list: [{ post: { post_id: 1 } }], is_last: false, last_id: 'next' }
        })
      };
    }
    return { ok: false, status: 503, json: async () => ({}) };
  });
  assert.equal(partial.status, 'partial');
  assert.equal(partial.posts.length, 1);

  const empty = await fetchForumPosts(game, async () => ({
    ok: true,
    status: 200,
    json: async () => ({ retcode: 0, data: { list: [], is_last: true, last_id: '' } })
  }));
  assert.equal(empty.status, 'ok');
  assert.deepEqual(empty.posts, []);
});

test('source processing fails when every fetched post is structurally invalid', () => {
  assert.equal(classifySourceProcessingOutcome('ok', 0, 4), 'failed');
  assert.equal(classifySourceProcessingOutcome('ok', 2, 1), 'partial');
  assert.equal(classifySourceProcessingOutcome('partial', 2, 0), 'partial');
  assert.equal(classifySourceProcessingOutcome('ok', 2, 0), 'ok');
});

test('screenshot selection excludes expired and existing images, sorts newest first, and limits', () => {
  const events = [
    { id: 'old', date: '2026.01.01', status: '可访问' },
    { id: 'expired', date: '2026.07.20', status: '已失效' },
    { id: 'existing', date: '2026.07.19', status: '可访问' },
    { id: 'newest', date: '2026.07.18', status: '需登录' },
    { id: 'middle', date: '2026.06.01', status: '已结束' }
  ];

  const selected = selectMissingScreenshotEvents(
    events,
    event => event.id === 'existing',
    2
  );

  assert.deepEqual(selected.map(event => event.id), ['newest', 'middle']);
});

test('forced screenshot IDs are recaptured even when an image already exists', () => {
  const events = [
    { id: 'existing', date: '2026.07.19', status: '可访问' },
    { id: 'missing', date: '2026.07.18', status: '可访问' }
  ];

  const selected = selectMissingScreenshotEvents(
    events,
    event => event.id === 'existing',
    Number.POSITIVE_INFINITY,
    new Set(['existing'])
  );

  assert.deepEqual(selected.map(event => event.id), ['existing', 'missing']);
});

test('event page readiness distinguishes GPU warning, loading, and the main UI', () => {
  assert.equal(
    classifyEventPageState({ coverText: '请开启浏览器硬件加速，获得更流畅的动画体验' }),
    'dismiss-gpu-warning'
  );
  assert.equal(
    classifyEventPageState({
      engineDetected: true,
      homeVisible: false,
      loadingProgress: 100,
      isShowLoading: true,
      currentScene: 'scene_loading'
    }),
    'waiting'
  );
  assert.equal(
    classifyEventPageState({
      engineDetected: true,
      homeVisible: true,
      loadingProgress: 100,
      isShowLoading: false,
      currentScene: 'scene_main',
      isGameLoading: false
    }),
    'ready'
  );
  assert.equal(classifyEventPageState({ coverText: '资源加载失败，请重试' }), 'fatal-error');
});

test('screenshot navigation strips tracking parameters and retries transient timeouts', async () => {
  assert.equal(
    screenshotNavigationUrl(
      'https://act.mihoyo.com/zzz/event/example/index.html?mhy_auth_required=true&utm_source=mys'
    ),
    'https://act.mihoyo.com/zzz/event/example/index.html'
  );

  let attempts = 0;
  const response = { status: () => 200 };
  const page = {
    goto: async () => {
      attempts++;
      if (attempts < 3) throw new Error('net::ERR_TIMED_OUT');
      return response;
    }
  };

  assert.equal(
    await navigateWithRetries(page, 'https://act.mihoyo.com/event', {
      attempts: 3,
      sleepFn: async () => {}
    }),
    response
  );
  assert.equal(attempts, 3);
});

test('metadata changes to an existing event produce a notifiable update', () => {
  const base = [{
    id: 'zzz-12',
    url: 'https://act.mihoyo.com/zzz/event/example/index.html',
    title: '初代虚狩，回归',
    version: '通用'
  }];
  const current = [{
    ...base[0],
    version: 'v3.1',
    startDate: '2026.07.17',
    endDate: '2026.09.09',
    reward: '预约得160菲林'
  }];

  const updates = collectEventUpdates(base, current);
  assert.deepEqual(updates.addedEvents, []);
  assert.deepEqual(updates.updatedEvents.map(event => event.id), ['zzz-12']);
  assert.deepEqual(updates.notificationEvents.map(event => event.id), ['zzz-12']);
});

test('forced screenshot recaptures can explicitly resend the refreshed event card', () => {
  const event = {
    id: 'zzz-12',
    url: 'https://act.mihoyo.com/zzz/event/example/index.html',
    title: '初代虚狩，回归',
    version: 'v3.1'
  };

  const updates = collectEventUpdates([event], [event], new Set(['zzz-12']));
  assert.deepEqual(updates.notificationEvents.map(item => item.id), ['zzz-12']);
});

test('Telegram delivery summaries distinguish complete, partial, and total failure', () => {
  assert.deepEqual(
    summarizeDeliveries([{ ok: true }, { ok: true }]),
    { attempted: 2, sentCount: 2, failedCount: 0, ok: true }
  );
  assert.deepEqual(
    summarizeDeliveries([{ ok: true }, { ok: false }]),
    { attempted: 2, sentCount: 1, failedCount: 1, ok: false }
  );
  assert.deepEqual(
    summarizeDeliveries([{ ok: false }]),
    { attempted: 1, sentCount: 0, failedCount: 1, ok: false }
  );
  assert.deepEqual(
    summarizeDeliveries([]),
    { attempted: 0, sentCount: 0, failedCount: 0, ok: false }
  );
});
