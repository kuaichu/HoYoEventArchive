import test from 'node:test';
import assert from 'node:assert/strict';
import { parseActivityTime, parseChinaTime, parseUnixTime } from '../scripts/activity-time-parser.js';

test('China clocks retain minute and second precision and reject invalid clocks', () => {
  assert.equal(parseChinaTime('2026-09-28 11:00'), '2026-09-28T11:00+08:00');
  assert.equal(parseChinaTime('2026-09-28 11:00:00'), '2026-09-28T11:00:00+08:00');
  for (const value of ['2026-02-30 11:00', '2026-09-28 24:00', '0000-01-01 00:00', '2026-09-28', '0']) assert.equal(parseChinaTime(value), null);
  assert.equal(parseUnixTime(0), null);
  assert.equal(parseUnixTime(-1), null);
  assert.equal(parseUnixTime(Date.parse('2026-10-01T04:00:00Z') / 1000), '2026-10-01T12:00:00+08:00');
});

test('activity sections preserve mixed date and clock precision', () => {
  assert.deepEqual(parseActivityTime('<p>〓活动时间〓</p><p>2022年9月28日-2022年10月12日 23:59</p><p>〓参与条件〓</p>'), {
    startDate: '2022.09.28', endAt: '2022-10-12T23:59+08:00'
  });
  assert.deepEqual(parseActivityTime('活动时间：2026/5/22 12:00-2026/5/24 23:59 参与方式：抽奖'), {
    startAt: '2026-05-22T12:00+08:00', endAt: '2026-05-24T23:59+08:00'
  });
});

test('omitted years only use trusted date context or same interval explicit year', () => {
  assert.deepEqual(parseActivityTime('活动时间：9月9日-10月10日', { announcementDate: '2026.09.09' }), {
    startDate: '2026.09.09', endDate: '2026.10.10'
  });
  assert.equal(parseActivityTime('活动时间：9月9日-10月10日').startDate, undefined);
  assert.deepEqual(parseActivityTime('活动时间：2026年12月28日至1月3日'), {
    startDate: '2026.12.28', endDate: '2027.01.03'
  });
  assert.deepEqual(parseActivityTime('活动时间：12月28日至2027年1月3日'), {
    startDate: '2026.12.28', endDate: '2027.01.03'
  });
});

test('start remains unknown for immediate opening and version-relative durations', () => {
  assert.deepEqual(parseActivityTime('活动时间：即日起至2026年10月10日23:59'), { endAt: '2026-10-10T23:59+08:00' });
  assert.equal(parseActivityTime('活动时间：4.6版本期间').startAt, undefined);
  for (const value of ['活动时间：2026年2月30日-2026年3月4日', '活动时间：2026年10月10日-2026年9月9日']) assert.equal(parseActivityTime(value).startDate, undefined);
});

test('statistics, award claims, script strings and arbitrary prose never become an activity window', () => {
  for (const value of [
    '本次年度数据统计范围为2025年9月1日04:00~2026年9月1日04:00',
    '奖励领取时间：2026年9月1日-2026年10月1日',
    '正文2026年9月1日-2026年10月1日',
    '<script>"活动时间：2026年9月1日-2026年10月1日"</script>',
    '活动时间：4.6版本期间\n正文参考日期：2026年9月1日-2026年10月1日',
    '统计活动时间：2025年9月1日-2026年9月1日',
    '活动时间：以公告为准。奖励领取时间：2026年9月1日-2026年10月1日'
  ]) assert.equal(parseActivityTime(value).startDate, undefined, value);
});

test('named clock stages are preserved within activity section without date-only stage coercion', () => {
  const result = parseActivityTime('〓活动时间〓\n2026年10月1日12:00:00 至 2026年11月3日04:00:00\n一阶段活动期间：2026年10月1日12:00:00 至 2026年10月22日04:00:00\n二阶段活动期间：2026年10月22日08:00:00 至 2026年11月3日04:00:00\n〓参与条件〓\n第三阶段：2026年11月4日-2026年11月5日');
  assert.equal(result.timeStages.length, 2);
  assert.deepEqual(result.timeStages[1], { name: '二阶段', startAt: '2026-10-22T08:00:00+08:00', endAt: '2026-11-03T04:00:00+08:00' });
  assert.equal(parseActivityTime('活动时间：2026年10月1日-2026年11月3日\n第一阶段：2026年10月1日-2026年10月22日').timeStages, undefined);
});

test('calendar dates around version updates remain dates and relative starts remain unknown', () => {
  assert.deepEqual(parseActivityTime('活动时间：2025/04/09 3.2版本更新后 - 2025/05/10 23:59'), { startDate: '2025.04.09', endAt: '2025-05-10T23:59+08:00' });
  assert.deepEqual(parseActivityTime('活动时间：2026/04/22 4.2更新后—2026/05/10 23:59'), { startDate: '2026.04.22', endAt: '2026-05-10T23:59+08:00' });
  assert.deepEqual(parseActivityTime('活动时间：3.4版本更新后至2025/08/13 06:00 UTC+8'), { endAt: '2025-08-13T06:00+08:00', versionStart: 'v3.4' });
  assert.deepEqual(parseActivityTime('活动时间：3.4版本更新后～2025年8月13日6:00（UTC+8）'), { endAt: '2025-08-13T06:00+08:00', versionStart: 'v3.4' });
  assert.equal(parseActivityTime('活动时间：4.6版本期间').versionPeriod, 'v4.6');
  assert.equal(parseActivityTime('活动时间：以官方公告为准\n活动奖励：4.6版本期间可获得奖励').versionPeriod, undefined);
  assert.deepEqual(parseActivityTime('活动结束时间 2026/09/09 05:59:59'), { endAt: '2026-09-09T05:59:59+08:00' });
});

test('creative campaign participation is submission period and review is a separate stage', () => {
  const text = '2.活动周期\n（1）奇域投稿期：2026年8月12日12:00:00 至 2026年9月16日11:59:59。\n（2）奇域评审期：2026年9月16日12:00:00 至 2026年10月16日23:59:59。\n（3）结果公示时间：评审期结束后开始，公示期为7个自然日。';
  assert.deepEqual(parseActivityTime(text), { startAt: '2026-08-12T12:00:00+08:00', endAt: '2026-09-16T11:59:59+08:00',
    timeStages: [{ name: '评审', startAt: '2026-09-16T12:00:00+08:00', endAt: '2026-10-16T23:59:59+08:00' }] });
  assert.equal(parseActivityTime(text.replace('奇域投稿期：', '报名投稿：')).endAt, '2026-09-16T11:59:59+08:00');
  assert.equal(parseActivityTime('2.活动周期\n（1）作品评审期：2026年9月16日12:00:00 至 2026年10月16日23:59:59。').startAt, undefined);
});

test('relative submission closing time cannot consume the next review opening as its second endpoint', () => {
  const result = parseActivityTime('2.活动周期\n（1）制作投稿期：7.1版更后 至 2026年11月2日11:59:59。\n（2）奇域评审期：2026年11月2日12:00:00 至 2026年12月4日23:59:59。\n（3）获奖公示期：评审期结束后开始，公示期为7个自然日。');
  assert.equal(result.startAt, undefined);
  assert.equal(result.startDate, undefined);
  assert.equal(result.endAt, '2026-11-02T11:59:59+08:00');
  assert.equal(result.versionStart, 'v7.1');
  assert.deepEqual(result.timeStages, [{ name: '评审', startAt: '2026-11-02T12:00:00+08:00', endAt: '2026-12-04T23:59:59+08:00' }]);
});

test('explicit start and end labels preserve date-only version opening without inventing a clock', () => {
  assert.deepEqual(parseActivityTime('活动时间\n开始时间：2024年11月6日 1.3版本「虚拟杀机」上线后\n结束时间：2024年12月2日 23:59:59'), {
    startDate: '2024.11.06', endAt: '2024-12-02T23:59:59+08:00'
  });
  assert.deepEqual(parseActivityTime('活动时间：即日起-2024/12/18 23:59'), { endAt: '2024-12-18T23:59+08:00' });
});
