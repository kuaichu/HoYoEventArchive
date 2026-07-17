import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  buildFinishedNotificationPlan,
  deleteDeliveredMessages,
  eventHashTags,
  formatVersion,
  resolveTelegramTargets
} from '../scripts/tg-notify.js';

const baseInput = {
  status: 'success',
  trigger: 'schedule',
  duration: '29s',
  project: 'HoYoEventArchive',
  runId: '123',
  runUrl: 'https://github.com/kuaichu/HoYoEventArchive/actions/runs/123',
  statusTargets: '-100-status',
  eventTargets: '-100-channel',
  transientDeleteAfterSeconds: 120
};

test('pre-launch and pending versions stay readable in Telegram cards', () => {
  assert.equal(formatVersion('公测前'), '公测前');
  assert.equal(formatVersion(undefined), '待确认');
  assert.match(eventHashTags({ game: '星穹铁道', version: '公测前', tags: [] }), /#公测前/);
  assert.doesNotMatch(eventHashTags({ game: '星穹铁道', version: '公测前', tags: [] }), /Ver公测前/);
});

test('auto-crawl does not send a redundant running notification', () => {
  const workflow = fs.readFileSync(
    new URL('../.github/workflows/auto-crawl.yml', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(workflow, /tg-notify\.js started/);
});

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

test('successful no-change runs stay silent', () => {
  const plan = buildFinishedNotificationPlan({
    ...baseInput,
    dataChanged: false,
    updateSummary: '',
    eventUpdates: []
  });

  assert.equal(plan.eventCards.enabled, false);
  assert.equal(plan.summary.enabled, false);
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
  assert.equal(plan.eventCards.deleteAfterSeconds, 0);
  assert.equal(plan.summary.enabled, true);
  assert.equal(plan.summary.targets, '-100-status');
  assert.equal(plan.summary.deleteAfterSeconds, 0);
  assert.match(plan.summary.text, /Data: changed and committed/);
  assert.doesNotMatch(plan.summary.text, /no changes/);
  assert.doesNotMatch(plan.summary.text, /temporary notice will be deleted/);
});

test('changed runs do not duplicate a summary when cards and status share one chat', () => {
  const plan = buildFinishedNotificationPlan({
    ...baseInput,
    dataChanged: true,
    updateSummary: '新增活动: 通知测试活动',
    eventUpdates: [{ id: 'notification-test', title: '通知测试活动' }],
    statusTargets: '-100-status',
    eventTargets: '-100-status'
  });

  assert.equal(plan.eventCards.enabled, true);
  assert.equal(plan.summary.enabled, false);
});

test('forced screenshot verification can resend one card without a repository commit', () => {
  const plan = buildFinishedNotificationPlan({
    ...baseInput,
    dataChanged: false,
    updateSummary: '绝区零 v3.1 活动更新: 初代虚狩，回归',
    eventUpdates: [{ id: 'zzz-12', title: '初代虚狩，回归' }],
    statusTargets: '-100-status',
    eventTargets: '-100-status',
    forceEventCards: true
  });

  assert.equal(plan.eventCards.enabled, true);
  assert.equal(plan.summary.enabled, false);
});

test('committed non-event changes are not mislabeled or deleted', () => {
  const plan = buildFinishedNotificationPlan({
    ...baseInput,
    dataChanged: true,
    updateSummary: '',
    eventUpdates: []
  });

  assert.equal(plan.eventCards.enabled, false);
  assert.equal(plan.summary.enabled, true);
  assert.equal(plan.summary.deleteAfterSeconds, 0);
  assert.match(plan.summary.text, /changed and committed/);
  assert.match(plan.summary.text, /no newly added event summary was generated/);
  assert.doesNotMatch(plan.summary.text, /no event updates detected/);
});

test('synthetic notification tests send one temporary card and no summary', () => {
  const plan = buildFinishedNotificationPlan({
    ...baseInput,
    dataChanged: true,
    updateSummary: '[TEST ONLY] simulated event',
    eventUpdates: [{ id: 'notification-test', title: '通知测试活动' }],
    notificationTest: true
  });

  assert.equal(plan.eventCards.enabled, true);
  assert.equal(plan.eventCards.deleteAfterSeconds, 120);
  assert.equal(plan.summary.enabled, false);
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
  assert.equal(plan.summary.enabled, true);
  assert.equal(plan.summary.targets, '-100-status');
  assert.equal(plan.summary.deleteAfterSeconds, 0);
  assert.match(plan.summary.text, /sync failed/);
});

test('deletion refuses to silently succeed without Telegram message identifiers', async () => {
  await assert.rejects(
    deleteDeliveredMessages(
      [{ ok: true, target: '-100-status' }],
      120,
      { sleepFn: async () => {}, deleteFn: async () => true, dryRun: false }
    ),
    /missing Telegram message identifiers/
  );
});

test('Telegram deletion failures propagate to the workflow', async () => {
  const delivery = {
    ok: true,
    target: '-100-status',
    message: { chat: { id: -100123 }, message_id: 456 }
  };

  await assert.rejects(
    deleteDeliveredMessages(
      [delivery],
      120,
      {
        sleepFn: async () => {},
        deleteFn: async () => {
          throw new Error('delete forbidden');
        },
        dryRun: false
      }
    ),
    /delete forbidden/
  );
});
