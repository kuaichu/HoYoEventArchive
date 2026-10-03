import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  canonicalizeEventUrl,
  classifyCrawlerVersion,
  classifyEventType,
  enrichEventWithMetadata,
  extractAnnouncementMetadata,
  getAnnouncementDate,
  isEventCandidateUrl,
  isPermanentResourceUrl,
  isPlatformCampaignUrl,
  resolveEventUrl,
  resolveStoredEventUrl,
  selectEventCandidateUrls,
  selectEventTitle
} from './crawler-rules.js';

const permanentResources = [
  'https://webstatic.mihoyo.com/bbs/event/bbs-lineup-hkrpg/index.html#/home',
  'https://act.mihoyo.com/zzz/event/character-builder/index.html#/',
  'https://act.mihoyo.com/sr/event/cultivation-tool/index.html',
  'https://webstatic.mihoyo.com/app/community-game-records/rpg/index.html',
  'https://webstatic.mihoyo.com/sr/app/interactive-map/index.html#/map/682',
  'https://act.mihoyo.com/miliastra_wonderland/agreement?id=156266',
  'https://act.mihoyo.com/app/mihoyo-zzz-game-record/m.html#/zzz/roles/0/detail'
];

permanentResources.forEach(url => {
  assert.equal(isPermanentResourceUrl(url), true, `Expected permanent resource: ${url}`);
});

const realActivities = [
  'https://act.mihoyo.com/ys/event/e20260610sports/index.html',
  'https://act.mihoyo.com/puzzle/hkrpg/e20260522example/index.html',
  'https://webstatic.mihoyo.com/ys/event/e20210601blue_post/vert.html?page_sn=abc123'
];

realActivities.forEach(url => {
  assert.equal(isPermanentResourceUrl(url), false, `Expected event page: ${url}`);
});

assert.equal(isEventCandidateUrl('https://act.mihoyo.com/zzz/event/example/index.html'), true);
assert.equal(isEventCandidateUrl('https://mhyurl.cn/ufdx1aofg'), true);
assert.equal(isEventCandidateUrl('https://example.com/not-an-event'), false);

const zzzQqMusicUrl = 'https://y.qq.com/forest/dWx0qP3Z130jnshg/index.html?&channelid=2005001153&ADTAG=nr_clnr_yx187';
const zzzKugouMusicUrl = 'https://m.kugou.com/ssr/musicip/ip?ssr_header_param=48&ssr_url_param=790663&isHideTitleBar=1&ip_id=113857';
assert.equal(isEventCandidateUrl(zzzQqMusicUrl), true);
assert.equal(isEventCandidateUrl(zzzKugouMusicUrl), true);
assert.equal(isPlatformCampaignUrl(zzzQqMusicUrl), true);
assert.equal(isEventCandidateUrl('https://y.qq.com/n/ryqq/songDetail/ordinary-track'), false);
assert.deepEqual(selectEventCandidateUrls([zzzQqMusicUrl, zzzKugouMusicUrl]), [zzzQqMusicUrl]);
assert.equal(
  await resolveStoredEventUrl(zzzQqMusicUrl),
  'https://y.qq.com/forest/dWx0qP3Z130jnshg/index.html'
);

const finalZzzUrl = 'https://act.mihoyo.com/zzz/event/e20260717reserve-pvy5cf/index.html';
const redirectRequests = [];
const resolvedZzzUrl = await resolveEventUrl('https://mhyurl.cn/ufdx1aofg', async (url, options) => {
  redirectRequests.push({ url, options });
  if (url === 'https://mhyurl.cn/ufdx1aofg') {
    return {
      ok: false,
      status: 302,
      headers: { get: name => name.toLowerCase() === 'location' ? finalZzzUrl : null }
    };
  }
  return { ok: true, status: 200, headers: { get: () => null }, url };
});
assert.equal(resolvedZzzUrl, finalZzzUrl);
assert.equal(redirectRequests.length, 2);
assert.equal(redirectRequests[0].options.method, 'GET');
assert.equal(redirectRequests[0].options.redirect, 'manual');

const storedZzzUrl = await resolveStoredEventUrl(
  'https://mhyurl.cn/normalized',
  async (url) => {
    if (url === 'https://mhyurl.cn/normalized') {
      return {
        ok: false,
        status: 302,
        headers: {
          get: name => name.toLowerCase() === 'location'
            ? `${finalZzzUrl}?game_biz=nap_cn&mhy_presentation_style=fullscreen&utm_source=bbs`
            : null
        }
      };
    }
    return { ok: true, status: 200, headers: { get: () => null }, url };
  }
);
assert.equal(storedZzzUrl, finalZzzUrl);

let untrustedFetchCount = 0;
const rejectedRedirect = await resolveEventUrl('https://mhyurl.cn/untrusted', async () => {
  untrustedFetchCount++;
  return {
    ok: false,
    status: 302,
    headers: { get: () => 'https://example.com/phishing' }
  };
});
assert.equal(rejectedRedirect, null);
assert.equal(untrustedFetchCount, 1, 'Untrusted redirect targets must not be fetched');

const zzzAnnouncement = `
亲爱的绳匠，《绝区零》3.1版本「初代虚狩，回归」预约&回归活动现已开启。
网页内，参与预约活动可得160菲林和游戏内纪念名片！邀请好友回归或注册游戏，最高可得340菲林！
游戏内签到活动期间，累计登录7日即可获赠480菲林！
参与网页内抽奖活动，赢取iPhone、游戏主机、手办、菲林等奖励~
【活动时间】
2026/07/17- 2026/09/09 05:59
`;
const zzzMetadata = extractAnnouncementMetadata(zzzAnnouncement);
assert.equal(zzzMetadata.version, 'v3.1');
assert.equal(zzzMetadata.startDate, '2026.07.17');
assert.equal(zzzMetadata.endDate, '2026.09.09');
assert.match(zzzMetadata.reward, /160菲林/);
assert.match(zzzMetadata.reward, /340菲林/);
assert.match(zzzMetadata.reward, /480菲林/);
assert.match(zzzMetadata.reward, /iPhone/);
assert.match(zzzMetadata.description, /绝区零.*3\.1版本/);

const impossibleDateMetadata = extractAnnouncementMetadata(`
【活动时间】
2026年2月31日-2026年3月2日
`);
assert.equal(impossibleDateMetadata.startDate, undefined, 'Impossible calendar dates must not be saved');
assert.equal(impossibleDateMetadata.endDate, undefined, 'An invalid range must not save only one endpoint');
const leapDayMetadata = extractAnnouncementMetadata(`
【活动时间】
2024年2月29日-2024年3月2日
`);
assert.equal(leapDayMetadata.startDate, '2024.02.29', 'Valid leap days must be accepted');

const submissionPhaseMetadata = extractAnnouncementMetadata(`
投稿征集阶段：
2026年8月19日 - 2026年9月9日
`);
assert.equal(submissionPhaseMetadata.startDate, '2026.08.19');
assert.equal(submissionPhaseMetadata.endDate, '2026.09.09');
const abbreviatedSubmissionMetadata = extractAnnouncementMetadata(`
报名投稿：2026年8月12日12:00~9月16日11:59
`);
assert.equal(abbreviatedSubmissionMetadata.startDate, '2026.08.12');
assert.equal(abbreviatedSubmissionMetadata.endDate, '2026.09.16');
const rolloverSubmissionMetadata = extractAnnouncementMetadata(`
报名投稿：2026年12月20日-1月5日
`);
assert.equal(rolloverSubmissionMetadata.startDate, undefined, 'Do not guess the year for abbreviated cross-year ranges');
assert.equal(rolloverSubmissionMetadata.endDate, undefined);

const drawingAnnouncementOptions = { title: '绘画征集活动' };
const publicNoticeMetadata = extractAnnouncementMetadata(`
公示时间：2026年8月19日 - 2026年9月9日
`, drawingAnnouncementOptions);
assert.equal(publicNoticeMetadata.startDate, undefined, 'Publicity dates are not submission dates');
assert.equal(publicNoticeMetadata.endDate, undefined);
const standalonePreviewDateMetadata = extractAnnouncementMetadata(`
2026年8月14日19:30-2026年8月16日23:59
`, { sourcePostTitle: '版本前瞻特别节目讨论' });
assert.equal(standalonePreviewDateMetadata.startDate, '2026.08.14');
assert.equal(standalonePreviewDateMetadata.endDate, '2026.08.16');
const unrelatedStandaloneDateMetadata = extractAnnouncementMetadata(`
2026年8月14日19:30-2026年8月16日23:59
`);
assert.equal(unrelatedStandaloneDateMetadata.startDate, undefined, 'Standalone ranges need an explicitly eligible announcement title');

const zzzMusicAnnouncement = `
《绝区零》二周年音乐平台活动现已开启，参与活动即可领取限量菲林礼包。
▼ 活动时间
2026年7月28日12:00 -- 2026年8月10日23:59
▼ 活动简介
活动期间，完成活动任务即可获得限量菲林礼包兑换码奖励。
`;
const zzzMusicMetadata = extractAnnouncementMetadata(zzzMusicAnnouncement);
assert.equal(zzzMusicMetadata.startDate, '2026.07.28');
assert.equal(zzzMusicMetadata.endDate, '2026.08.10');
assert.equal(classifyEventType(zzzMusicAnnouncement), '联动活动');
assert.equal(
  classifyCrawlerVersion({
    gameKey: 'zzz',
    title: '《绝区零》二周年音乐活动',
    sourcePostTitle: '新歌活动丨《绝区零》二周年音乐平台活动现已开启',
    body: zzzMusicAnnouncement,
    date: '2026.07.28',
    eventType: '联动活动',
    eventUrl: zzzQqMusicUrl
  }),
  '通用'
);

const zzzAnnualReportPageText =
  '法厄同年度大揭秘。参与活动，即有机会获取「奇迹的中奖者」限定名片与菲林奖励！';
const zzzAnnualReportMetadata = extractAnnouncementMetadata(zzzAnnualReportPageText);
assert.equal(classifyEventType(zzzAnnualReportPageText), '年度报告');
assert.match(zzzAnnualReportMetadata.reward, /限定名片/);
assert.match(zzzAnnualReportMetadata.reward, /菲林奖励/);
assert.equal(
  classifyCrawlerVersion({
    gameKey: 'zzz',
    title: '法厄同年度大揭秘',
    description: zzzAnnualReportPageText,
    date: '2026.07.29',
    eventType: '年度报告',
    eventUrl: 'https://act.mihoyo.com/zzz/event/e20260729-anniversary-smcfj5/index.html'
  }),
  'v3.1'
);

assert.equal(
  classifyCrawlerVersion({
    gameKey: 'ys',
    title: '《原神》「月之七」版本前瞻特别节目',
    date: '2026.04.30',
    eventType: '版本前瞻'
  }),
  'v6.6'
);
assert.equal(
  classifyCrawlerVersion({
    gameKey: 'ys',
    title: '全新网页活动开启',
    date: '2026.06.10',
    eventType: '其他活动'
  }),
  '待确认'
);

const enrichment = enrichEventWithMetadata(
  { id: 'zzz-12', version: '待确认', tags: ['回归活动'] },
  zzzMetadata
);
assert.equal(enrichment.changed, true);
assert.equal(enrichment.event.version, 'v3.1');
assert.equal(enrichment.event.startDate, '2026.07.17');
assert.equal(enrichment.event.endDate, '2026.09.09');
assert.match(enrichment.event.reward, /160菲林/);
assert.ok(enrichment.event.tags.includes('v3.1版本'));

const genericEnrichment = enrichEventWithMetadata(
  { id: 'zzz-tool', version: '通用', tags: ['网页活动'] },
  zzzMetadata
);
assert.equal(genericEnrichment.event.version, '通用');
assert.ok(!genericEnrichment.event.tags.includes('v3.1版本'));

assert.equal(
  canonicalizeEventUrl('https://example.com/event/index.html?page_sn=abc&utm_source=bbs'),
  'https://example.com/event/index.html?page_sn=abc'
);
assert.notEqual(
  canonicalizeEventUrl('https://example.com/event/index.html?page_sn=abc'),
  canonicalizeEventUrl('https://example.com/event/index.html?page_sn=def')
);
assert.equal(
  canonicalizeEventUrl('https://example.com/event/index.html?utm_source=a'),
  canonicalizeEventUrl('https://example.com/event/index.html?utm_source=b')
);

assert.equal(
  getAnnouncementDate({ post: { created_at: Date.parse('2026-06-10T16:30:00Z') / 1000 } }),
  '2026.06.11'
);
assert.equal(getAnnouncementDate({ post: {} }), null);

assert.equal(classifyEventType('《崩坏3》8.9版本前瞻'), '版本前瞻');
assert.equal(classifyEventType('《原神》版本前瞻特别节目'), '版本前瞻');
assert.equal(classifyEventType('3.0版本前瞻预热'), '版本前瞻');
assert.equal(classifyEventType('浮生孰来 八重神子预热小游戏'), '小游戏');
assert.equal(classifyEventType('群星邀约 预抽卡'), '预约/预抽卡');
assert.equal(classifyEventType('「恣锐锋镞」洛恩绘画征集活动开启'), '其他活动');
assert.equal(classifyEventType('足迹已经遍布提瓦特，分享视频回忆', { title: '「旅途回忆」视频共创活动征集' }), '其他活动');
assert.equal(classifyEventType('优秀作品有机会得到与官方合作的机会', { title: '「千星创作赛」正式启动！' }), '其他活动');
assert.equal(classifyEventType('年度报告开放，也欢迎分享视频回忆', { title: '年度开拓报告' }), '年度报告');

assert.equal(
  selectEventTitle('「月之七」版本活动祈愿预告第二期', '原神版本页'),
  '「月之七」版本活动祈愿预告第二期'
);
assert.equal(
  selectEventTitle('【有奖活动】洛恩绘画征集活动开启', '《原神》社区征集活动'),
  '【有奖活动】洛恩绘画征集活动开启'
);
assert.equal(
  selectEventTitle('公告标题', '早安，罗斯凯利法', '更长的分享标题'),
  '早安，罗斯凯利法'
);

const events = JSON.parse(fs.readFileSync(new URL('../src/events.json', import.meta.url), 'utf8'));
const ids = events.map(event => event.id);
assert.equal(new Set(ids).size, ids.length, 'Event IDs must be unique');

const canonicalUrls = events.map(event => canonicalizeEventUrl(event.url));
assert.equal(
  new Set(canonicalUrls).size,
  canonicalUrls.length,
  'Canonical event URLs must be unique'
);

console.log('Crawler rules passed.');
