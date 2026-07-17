import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFinishedNotificationPlan, resolveTelegramTargets } from '../scripts/tg-notify.js';

const baseInput = {
  status: 'success',
  trigger: 'schedule',
  duration: '29s',
  project: 'HoYoEventArchive',
  runId: '123',
  runUrl: 'https://github.com/kuaichu/HoYoEventArchive/actions/runs/123',
  statusTargets: '-100-status',
  eventTargets: '-100-channel',
  transientDeleteAfterSeconds: 90
};

test('event cards fall back to the working status chat when no channel is configured', () => {
  assert.deepEqual(
    resolveTelegramTargets({ TG_CHAT_ID: '-100-status', TG_CHANNEL_CHAT_ID: '' }),
    { statusTargets: '-100-status', eventTargets: '-100-status' }
  );
  assert.deepEqual(
    resolveTelegramTargets({ TG_CHAT_ID: '-100-status', TG_CHANNEL_CHAT_ID: '-100-channel' }),
    { statusTargets: '-100-status', eventTargets: '-100-channel' }
  );
});

test('successful no-change runs send a temporary status summary only', () => {
  const plan = buildFinishedNotificationPlan({
    ...baseInput,
    dataChanged: false,
    updateSummary: '',
    eventUpdates: []
  });

  assert.equal(plan.eventCards.enabled, false);
  assert.equal(plan.summary.targets, '-100-status');
  assert.equal(plan.summary.deleteAfterSeconds, 90);
  assert.match(plan.summary.text, /Data: no changes/);
  assert.match(plan.summary.text, /temporary notice will be deleted/);
});

test('changed runs send event cards to the channel and a persistent summary to the status chat', () => {
  const plan = buildFinishedNotificationPlan({
    ...baseInput,
    dataChanged: true,
    updateSummary: '原神 v6.0 新增活动: 通知测试活动',
    eventUpdates: [{ id: 'notification-test', title: '通知测试活动' }]
  });

  assert.equal(plan.eventCards.enabled, true);
  assert.equal(plan.eventCards.targets, '-100-channel');
  assert.equal(plan.summary.targets, '-100-status');
  assert.equal(plan.summary.deleteAfterSeconds, 0);
  assert.match(plan.summary.text, /Data: changed and committed/);
  assert.doesNotMatch(plan.summary.text, /no changes/);
  assert.doesNotMatch(plan.summary.text, /temporary notice will be deleted/);
});

test('committed non-event changes are not mislabeled or deleted', () => {
  const plan = buildFinishedNotificationPlan({
    ...baseInput,
    dataChanged: true,
    updateSummary: '',
    eventUpdates: []
  });

  assert.equal(plan.eventCards.enabled, false);
  assert.equal(plan.summary.deleteAfterSeconds, 0);
  assert.match(plan.summary.text, /changed and committed/);
  assert.match(plan.summary.text, /no newly added event summary was generated/);
  assert.doesNotMatch(plan.summary.text, /no event updates detected/);
});

test('synthetic notification tests are clearly labeled as uncommitted', () => {
  const plan = buildFinishedNotificationPlan({
    ...baseInput,
    dataChanged: true,
    updateSummary: '[TEST ONLY] simulated event',
    eventUpdates: [{ id: 'notification-test', title: '通知测试活动' }],
    notificationTest: true
  });

  assert.match(plan.summary.text, /notification test/);
  assert.match(plan.summary.text, /simulated change \(not committed\)/);
  assert.doesNotMatch(plan.summary.text, /changed and committed/);
  assert.equal(plan.summary.deleteAfterSeconds, 0);
  assert.equal(plan.eventCards.enabled, true);
});

test('failed runs always produce a persistent status-chat summary', () => {
  const plan = buildFinishedNotificationPlan({
    ...baseInput,
    status: 'failure',
    dataChanged: false,
    updateSummary: '',
    eventUpdates: [{ id: 'ignored', title: 'ignored' }]
  });

  assert.equal(plan.eventCards.enabled, false);
  assert.equal(plan.summary.targets, '-100-status');
  assert.equal(plan.summary.deleteAfterSeconds, 0);
  assert.match(plan.summary.text, /sync failed/);
});
