import {
  classifyEventVersion,
  extractExplicitVersion,
  isNumericVersion
} from './version-classification.js';
import { normalizeStoredEventUrl } from '../src/event-url.js';

const permanentResourcePathFragments = [
  '/bbs/event/bbs-lineup-',
  '/event/character-builder/',
  '/event/cultivation-tool/',
  '/app/community-game-records/',
  '/app/interactive-map/'
];

const eventHostnames = new Set([
  'act.mihoyo.com',
  'webstatic.mihoyo.com',
  'act.hoyoverse.com',
  'webstatic.hoyoverse.com'
]);

const eventShortLinkHostnames = new Set(['mhyurl.cn']);

function isExternalMusicPlatformPage(url) {
  const hostname = url?.hostname?.toLowerCase();
  const pathname = url?.pathname || '';
  return (
    hostname === 'y.qq.com'
    && /^\/forest\/[^/]+\/index\.html$/i.test(pathname)
  ) || (
    hostname === 'm.kugou.com'
    && pathname === '/ssr/musicip/ip'
    && url.searchParams.has('ip_id')
  );
}

const identityQueryParams = new Set([
  'act_id',
  'activity_id',
  'event_id',
  'id',
  'page_id',
  'page_sn',
  'sn'
]);

const genericPageTitles = [
  /^原神版本页$/i,
  /^《?原神》?社区征集活动$/i,
  /^米游社$/i,
  /^网页活动$/i,
  /^活动页$/i,
  /^hoyolab$/i
];

function isUsefulTitle(title) {
  const normalized = title.trim();
  return normalized.length >= 4 && !genericPageTitles.some(pattern => pattern.test(normalized));
}

function cleanEventUrl(rawUrl) {
  return String(rawUrl || '').replace(/&amp;/g, '&').replace(/[.,;!?]$/, '');
}

function parseHttpUrl(rawUrl) {
  try {
    const url = new URL(cleanEventUrl(rawUrl));
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function isEventPageUrl(rawUrl) {
  const url = parseHttpUrl(rawUrl);
  return Boolean(
    url &&
    (eventHostnames.has(url.hostname) || isExternalMusicPlatformPage(url)) &&
    !url.pathname.includes('/common/') &&
    !url.pathname.match(/\.(png|jpg|jpeg|gif|svg)$/i)
  );
}

function isEventShortLink(rawUrl) {
  const url = parseHttpUrl(rawUrl);
  return Boolean(url && eventShortLinkHostnames.has(url.hostname));
}

export function isEventCandidateUrl(rawUrl) {
  return isEventPageUrl(rawUrl) || isEventShortLink(rawUrl);
}

export function isPlatformCampaignUrl(rawUrl) {
  return isExternalMusicPlatformPage(parseHttpUrl(rawUrl));
}

export function selectEventCandidateUrls(rawUrls) {
  const candidates = [...new Set(
    (Array.isArray(rawUrls) ? rawUrls : [])
      .map(cleanEventUrl)
      .filter(isEventCandidateUrl)
  )];
  const musicPlatformCandidates = candidates.filter(isPlatformCampaignUrl);
  const musicPlatformHosts = new Set(
    musicPlatformCandidates.map(candidate => parseHttpUrl(candidate)?.hostname)
  );
  if (musicPlatformHosts.size < 2) return candidates;

  const preferred = musicPlatformCandidates.find(candidate => parseHttpUrl(candidate)?.hostname === 'y.qq.com')
    || musicPlatformCandidates[0];
  return candidates.filter(candidate => !isPlatformCampaignUrl(candidate) || candidate === preferred);
}

export async function resolveEventUrl(
  rawUrl,
  fetchImpl = fetch,
  { timeoutMs = 8000, maxRedirects = 3 } = {}
) {
  const cleanedUrl = cleanEventUrl(rawUrl);
  if (isEventPageUrl(cleanedUrl)) return cleanedUrl;
  if (!isEventShortLink(cleanedUrl)) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let currentUrl = cleanedUrl;

  try {
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
      if (!isEventShortLink(currentUrl) && !isEventPageUrl(currentUrl)) return null;

      const response = await fetchImpl(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; HoYoEventArchive/1.0)'
        }
      });

      if (response.status >= 300 && response.status < 400) {
        if (redirectCount >= maxRedirects) return null;
        const location = response.headers?.get?.('location');
        if (!location) return null;
        const nextUrl = new URL(location, currentUrl).toString();
        if (!isEventShortLink(nextUrl) && !isEventPageUrl(nextUrl)) return null;
        currentUrl = nextUrl;
        continue;
      }

      if (!response.ok) return null;
      const finalUrl = cleanEventUrl(response.url || currentUrl);
      return isEventPageUrl(finalUrl) ? finalUrl : null;
    }
  } finally {
    clearTimeout(timeoutId);
  }

  return null;
}

export async function resolveStoredEventUrl(rawUrl, fetchImpl = fetch, options = {}) {
  const resolvedUrl = await resolveEventUrl(rawUrl, fetchImpl, options);
  return resolvedUrl ? normalizeStoredEventUrl(resolvedUrl) : null;
}

function stripHtml(rawHtml) {
  return String(rawHtml || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:p|div|li|h[1-6]|ul|ol|section|article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (entity, hex, decimal) => {
      const codePoint = Number.parseInt(hex || decimal, hex ? 16 : 10);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    })
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractPostText(post) {
  try {
    const structured = typeof post?.structured_content === 'string'
      ? JSON.parse(post.structured_content)
      : post?.structured_content;
    const ops = Array.isArray(structured) ? structured : structured?.ops;
    if (Array.isArray(ops)) {
      const text = ops
        .map(op => typeof op?.insert === 'string' ? op.insert : '')
        .filter(Boolean)
        .join('')
        .replace(/\r/g, '')
        .trim();
      if (text) return text;
    }
  } catch {
    // Fall back to the HTML/plain content field below.
  }

  return stripHtml(post?.content || '');
}

function normalizeDateToken(rawDate) {
  const match = String(rawDate || '').match(
    /(\d{4})\s*(?:年|[./-])\s*(\d{1,2})\s*(?:月|[./-])\s*(\d{1,2})\s*日?/
  );
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return undefined;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) return undefined;
  return `${match[1]}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
}

const rewardKeyword = /(原石|星琼|菲林|水晶|摩拉|徽章|挂件|名片|补给卡|奖励|礼包|兑换码|iPhone|PlayStation|PS5|手办|周边|游戏主机)/i;
const rewardAction = /(可得|获得|获赠|赠送|赢取|领取|抽奖|奖励|最高可得)/;
const explicitReward = /\d+\s*(?:万|千)?\s*(?:原石|星琼|菲林|水晶|摩拉|补给卡)|(?:原石|星琼|菲林|水晶|摩拉|徽章|挂件|礼包|手办|周边|补给卡).{0,40}[*x×]\s*\d+/i;
const administrativeText = /(注意事项|免责声明|客服|活动最终解释|解释权|隐私政策|用户协议|法律法规|社区规则|禁止参赛|严禁抄袭|审核状态|测试服|正式服效果为准|获奖名单.*(?:公布|公示)|奖励名单|(?:奖励|奖品)说明预览|收货(?:信息|地址)|收件(?:信息|地址)|(?:回复|填写|提交).*收款信息|(?:奖品|奖励|周边).*(?:地址填写|填写教程)|奖励名额.*(?:不代表|实际获奖)|(?:发送|送达|发至).*(?:邮箱|邮件|账户)|发货|寄送|关注.*私信|逾期.*放弃(?:奖品|奖励)|(?:视为|即代表).{0,8}(同意|接受)|确保.*(?:发放|到账)|(?:奖品|奖励).*(?:发放|到账)|(?:发放|领取).{0,8}(时长|时间|工作日)|不可.{0,5}(领取|获得)|无法.{0,5}(领取|获得))/;
const genericDescriptions = new Set(['提瓦特/米游社官方网页活动。', '米游社官方网页活动。', '官方网页活动。']);

function splitOutsideQuotes(text, punctuation) {
  const pairs = new Map([['「', '」'], ['『', '』'], ['“', '”'], ['"', '"'], ['《', '》'], ['【', '】'], ['（', '）'], ['(', ')'], ['[', ']']]);
  const stack = [];
  const fragments = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === stack.at(-1)) stack.pop();
    else if (pairs.has(character)) stack.push(pairs.get(character));
    if (stack.length === 0 && punctuation.test(character)) {
      fragments.push(text.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < text.length) fragments.push(text.slice(start));
  return fragments;
}

function removeAdministrativeSuffix(sentence) {
  if (/^[※*\s]*(?:虚拟奖励|实物奖励|米游币及头像挂件奖励|(?:请)?获得现金奖励|奖励名单|(?:奖励|奖品)说明预览)/.test(sentence)) return '';
  const clauses = splitOutsideQuotes(sentence, /[，,；;]/);
  const administrativeIndex = clauses.findIndex(clause => administrativeText.test(clause));
  if (administrativeIndex < 0) return sentence;
  return clauses.slice(0, administrativeIndex).join('').replace(/[，,；;\s]+$/, '');
}

function announcementSentences(rawText) {
  const sentences = [];
  let administrativeSection = false;
  for (const rawLine of String(rawText || '').replace(/\r/g, '').split(/\n+/)) {
    const line = rawLine.trim()
      .replace(/^[>▼▲◆◇●•■□★☆▌\s]+/, '')
      .replace(/^(?:[（(]?\d+[）)]?[、]|[（(]?\d+[）)]|\d+\.(?!\d)|[一二三四五六七八九十]+、)\s*/, '');
    const heading = line.replace(/[【】\[\]「」〓◆◇▼▲●•■□★☆_=—–―\-*~:：\s]/g, '');
    if (/^(?:(?:活动)?注意事项|活动须知|免责声明|奖励发放|奖品发放|温馨提示|常见问题|补充说明|活动说明|爱酱小贴士)$/.test(heading)) {
      administrativeSection = true;
      continue;
    }
    if (/^(?:(?:网页)?活动(?:时间|简介|内容|参与方式|玩法|规则|奖励|奖励一览|介绍)|(?:网页)?参与方式|奖励内容|(?:奖励|奖品)一览)$/.test(heading)) {
      administrativeSection = false;
      continue;
    }
    const emptySectionHeading = /^[\p{Script=Han}]{2,18}(?:奖励|说明|规则|须知|方式|内容|介绍|时间|一览)$/u.test(heading)
      && !/[:：]\s*\S/.test(line)
      && !/(可得|获得|获赠|赢取|领取|完成|原石|星琼|菲林|水晶|兑换码)/.test(heading);
    if (emptySectionHeading) continue;
    if (administrativeSection || !line) continue;
    sentences.push(...splitOutsideQuotes(line, /[。！？!?]/)
      .map(sentence => removeAdministrativeSuffix(sentence.trim()))
      .filter(sentence => sentence && !isIncompleteNavigation(sentence)));
  }
  return sentences;
}

function removeGreeting(sentence) {
  return sentence
    .replace(/^(?:(?:亲爱的|尊敬的|各位|所有的)\s*)?(?:旅行者|奇匠|开拓者|舰长|绳匠)(?:们)?(?:大家)?(?:好呀|你好|您好|你们好|大家好|好)?[！!，,：:、\s]+/, '')
    .trim();
}

function hasReward(sentence) {
  return rewardKeyword.test(sentence) && (rewardAction.test(sentence) || explicitReward.test(sentence)) && !administrativeText.test(sentence);
}

function isIncompleteNavigation(sentence) {
  return /(?:点击|前往|进入|查看|访问|打开|跳转至|跳转到)[。！？!?~～；;，,、\s]*$/.test(sentence);
}

function isBarePrizeList(sentence) {
  return explicitReward.test(sentence)
    && !/(参与|完成|可得|获得|获赠|赠送|赢取|领取|必得|机会|随机|首次|每次)/.test(sentence);
}

function isDateOrNavigation(sentence) {
  return /^(?:https?:\/\/|(?:点击|点此|扫描|扫码).{0,12}(?:参与|进入|前往|观看|查看|链接|二维码)|(?:活动入口|参与入口|活动链接|返回首页|上一页|下一页|了解更多|活动时间)\s*[:：]?)/.test(sentence)
    || /^(?:点击|点此)[^。！？!?，,]*[<>]{2,}$/.test(sentence)
    || /(?:点击(?:下方|上方)链接|扫描(?:下方|上方)二维码)/.test(sentence) && !hasReward(sentence)
    || /^(?:投稿征集阶段|征集阶段|投稿时间|开奖时间|公示时间|活动截止)\s*[:：]/.test(sentence)
    || /^(?:本期活动时间|制作投稿|奇域评审|获奖公示)\s*[:：]/.test(sentence)
    || /^\d{4}\s*(?:年|[./-])\s*\d{1,2}\s*(?:月|[./-])/.test(sentence)
    || /^【[^】]+】$/.test(sentence);
}

function isAnnouncementPreamble(sentence) {
  return /^[^，,。！？!?：:]*(?:活动|功能)(?:现已|正式|已|即将)?(?:开启|上线|开放|开始)(?:啦|了|咯|哦)?[。！？!?~～]*$/.test(sentence)
    || /^欢迎(?:添加|加入|参与|参加)/.test(sentence) && !hasReward(sentence)
    || /^相信.{0,40}(?:美好|瞬间).{0,20}值得记录/.test(sentence)
    || /^(?:「|“).*(?:一帧帧影像|记录回忆的绚烂多彩).*[」”]$/.test(sentence) && !hasReward(sentence)
    || /^(?:之前|此前|上次|上一期).{0,20}(?:分享|介绍|讲过|教程)/.test(sentence)
    || /^(?:但|不过)?有些.{0,35}(?:跟|向).{0,20}说[：:]/.test(sentence);
}

function extractDescription(text, { title, sourcePostTitle } = {}) {
  const titleKey = value => String(value || '').replace(/[\s。！？!?~～「」《》【】]/g, '');
  const titles = [title, sourcePostTitle].filter(Boolean).map(titleKey);
  const candidates = announcementSentences(text)
    .map(removeGreeting)
    .filter(sentence => sentence.length >= 8 && !administrativeText.test(sentence))
    .filter(sentence => !isDateOrNavigation(sentence) && !isAnnouncementPreamble(sentence) && !titles.includes(titleKey(sentence)))
    .map((sentence, index) => {
      const versionIntro = /^\d+(?:\.\d+)+版本/.test(sentence) && /(角色|专题|展示|内容|开启|上线|登场)/.test(sentence);
      const content = !isBarePrizeList(sentence) && (versionIntro || /(完成|回顾|测一测|测试|冒险风格|分享|收集|解锁|体验|游玩|试玩|反馈报告|发起.{0,12}共创邀请|挑战|答题|签到|累计登录|邀请好友|添加|预约|预抽卡|观看|聆听|创作|投稿|绘画|上传|选择|匹配|寻找|回忆|记录|抽取|制作|搭配|换装|拍照|拍摄|拼图|闯关|扮演|养成|应援|点亮|投票|寄语|留言|经营|兑换|参与.{0,20}公益|写下.{0,20}(?:回应|回信)|版本.{0,40}(?:专题|展示页|内容介绍))/.test(sentence));
      const reward = hasReward(sentence);
      return { sentence, index, content, reward, useful: content || reward, barePrizeList: isBarePrizeList(sentence) };
    })
    .filter(candidate => candidate.useful && candidate.sentence.length <= 280);

  // Select activity details first, then explicit rewards, keeping the official reading order.
  const prioritized = [
    ...candidates.filter(candidate => candidate.content).slice(0, 2),
    ...candidates.filter(candidate => candidate.reward && !candidate.barePrizeList)
  ];
  const selected = [];
  const seen = new Set();
  let length = 0;
  for (const candidate of prioritized) {
    const sentence = /[。！？!?~～][」』”]$/.test(candidate.sentence)
      ? candidate.sentence
      : candidate.sentence.replace(/[。！？!?~～；;，,、\s]+$/, '') + '。';
    if (seen.has(sentence) || length + sentence.length > 280) continue;
    seen.add(sentence);
    selected.push({ ...candidate, sentence });
    length += sentence.length;
    if (selected.length === 3) break;
  }
  return selected.sort((a, b) => a.index - b.index).map(candidate => candidate.sentence).join('') || undefined;
}

function extractRewardSummary(text) {
  const sentences = announcementSentences(text)
    .map(removeGreeting)
    .map(sentence => sentence.replace(/^[>【】\s]+|[【】\s]+$/g, '').replace(/[。！？!?~～；;，,、\s]+$/g, ''))
    .filter(sentence => sentence.length >= 4 && hasReward(sentence));

  const selected = [];
  let length = 0;
  for (const sentence of new Set(sentences)) {
    const additionalLength = sentence.length + (selected.length ? 1 : 0);
    if (length + additionalLength > 300) continue;
    selected.push(sentence);
    length += additionalLength;
    if (selected.length === 6) break;
  }
  return selected.join('；') || undefined;
}

export function extractAnnouncementMetadata(rawText, options = {}) {
  const text = String(rawText || '').replace(/\r/g, '');
  const lines = text.split('\n');
  const datePattern = /(?<startYear>\d{4})\s*(?:年|[./-])\s*(?<startMonth>\d{1,2})\s*(?:月|[./-])\s*(?<startDay>\d{1,2})\s*日?\s*(?:\d{1,2}:\d{2})?\s*(?:--?|—|–|~|～|至|到)\s*(?:(?<endYear>\d{4})\s*(?:年|[./-])\s*)?(?<endMonth>\d{1,2})\s*(?:月|[./-])\s*(?<endDay>\d{1,2})\s*日?/;
  const dateHead = /^(?:本期)?(?:网页)?(?:活动参与时间|活动时间|参与时间|投稿征集阶段|征集阶段|报名投稿)\s*[:：]?\s*(.*)$/;
  const excludedHead = /^(?:开奖|公示|获奖|评审|审核|名单)/;

  function readDateRange(candidate, { requireEndYear = false } = {}) {
    const match = candidate.match(datePattern);
    if (!match || (requireEndYear && !match.groups.endYear)) return null;
    const startYear = Number(match.groups.startYear);
    const endYear = Number(match.groups.endYear || match.groups.startYear);
    const startDate = normalizeDateToken(`${startYear}年${match.groups.startMonth}月${match.groups.startDay}日`);
    const endDate = normalizeDateToken(`${endYear}年${match.groups.endMonth}月${match.groups.endDay}日`);
    if (!startDate || !endDate || endDate < startDate) return null;
    return { startDate, endDate };
  }

  let dateRange = null;
  let hasDateHead = false;
  for (let index = 0; index < lines.length && !dateRange; index++) {
    const line = lines[index].trim()
      .replace(/^[▼▲◆◇●•■□★☆▌\s]+/, '')
      .replace(/^【(.*)】$/, '$1')
      .replace(/^\[(.*)\]$/, '$1')
      .replace(/^[〓—_=*\-]+\s*|\s*[〓—_=*\-]+$/g, '');
    const heading = line.match(dateHead);
    if (!heading) continue;
    hasDateHead = true;
    const section = [heading[1]];
    for (let next = index + 1; next < lines.length && next <= index + 4; next++) {
      const nextLine = lines[next].trim().replace(/^[▼▲◆◇●•■□★☆▌\s]+/, '');
      if (dateHead.test(nextLine) || excludedHead.test(nextLine)) break;
      if (nextLine) section.push(nextLine);
      if (section.join(' ').length >= 240) break;
    }
    dateRange = readDateRange(section.join(' '));
  }

  if (!hasDateHead && !dateRange && /(?:前瞻.{0,4}(?:节目|讨论)|绘画征集)/.test(`${options.title || ''}\n${options.sourcePostTitle || ''}`)) {
    for (const line of lines) {
      if (excludedHead.test(line.trim())) continue;
      dateRange = readDateRange(line, { requireEndYear: true });
      if (dateRange) break;
    }
  }

  return {
    version: extractExplicitVersion(text),
    startDate: dateRange?.startDate,
    endDate: dateRange?.endDate,
    reward: extractRewardSummary(text),
    description: extractDescription(text, options)
  };
}

export function isDescriptionResource(event = {}) {
  if (/(?:服务协议|用户协议|隐私政策)/.test(`${event.title || ''}\n${event.sourcePostTitle || ''}`)) return true;
  const pathname = parseHttpUrl(event.url)?.pathname || '';
  return /\/(?:agreement|privacy|terms)(?:[\/._-]|$)/i.test(pathname);
}

export function enrichEventDescription(event, postText, options = {}) {
  const currentDescription = event.description || '';
  if (event.descriptionSource === 'manual' || isDescriptionResource(event)) return { event, changed: false };

  const legacyDescription = String(options.legacyText ?? postText ?? '')
    .replace(/\r/g, '')
    .split(/\n+/)
    .map(line => line.trim())
    .find(line => line.length >= 12 && !/^【.+】$/.test(line))
    ?.slice(0, 280);
  const mayReplace = !currentDescription.trim()
    || genericDescriptions.has(currentDescription.trim())
    || currentDescription === legacyDescription
    || ['announcement', 'page'].includes(event.descriptionSource);
  if (!mayReplace) return { event, changed: false };

  const description = extractDescription(postText, { title: event.title, sourcePostTitle: event.sourcePostTitle });
  if (!description || description === currentDescription) return { event, changed: false };
  return { event: { ...event, description, descriptionSource: 'announcement' }, changed: true };
}

export function classifyCrawlerVersion({ gameKey, title, sourcePostTitle, description, body, date, eventType, eventUrl }) {
  if (isPlatformCampaignUrl(eventUrl)) return '通用';
  const dateFallbackTypes = new Set(['年度报告', '回归活动', '小游戏', '预约/预抽卡', '联动活动']);
  return classifyEventVersion({
    gameKey,
    title,
    sourcePostTitle,
    description,
    body,
    date,
    allowDateFallback: dateFallbackTypes.has(eventType)
  });
}

export function enrichEventWithMetadata(event, metadata) {
  const enriched = { ...event };
  let changed = false;

  const setIfMissing = (field, value, isMissing) => {
    if (!value || !isMissing(enriched[field])) return;
    enriched[field] = value;
    changed = true;
  };

  setIfMissing('version', metadata?.version, value => !value || value === '待确认');
  setIfMissing('startDate', metadata?.startDate, value => !value);
  setIfMissing('endDate', metadata?.endDate, value => !value);
  setIfMissing('reward', metadata?.reward, value => !value || value === '未识别');
  if (enriched.descriptionSource !== 'manual' && !isDescriptionResource(enriched)) {
    setIfMissing(
      'description',
      metadata?.description,
      value => !value || genericDescriptions.has(value)
    );
    if (enriched.description !== event.description) enriched.descriptionSource = 'announcement';
  }

  if (isNumericVersion(metadata?.version) && enriched.version === metadata.version) {
    const versionTag = `${metadata.version}版本`;
    const tags = Array.isArray(enriched.tags) ? [...enriched.tags] : [];
    if (!tags.includes(versionTag)) {
      tags.push(versionTag);
      enriched.tags = tags;
      changed = true;
    }
  }

  return { event: enriched, changed };
}

export function selectEventTitle(subject, pageTitle, ogTitle = '') {
  if (isUsefulTitle(pageTitle || '')) return pageTitle.trim();
  if (isUsefulTitle(ogTitle || '')) return ogTitle.trim();
  return (subject || pageTitle || ogTitle || '').trim();
}

export function isPermanentResourceUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const path = url.pathname.toLowerCase();
    return isDescriptionResource({ url: rawUrl })
      || path.includes('/app/mihoyo-zzz-game-record/')
      || permanentResourcePathFragments.some(fragment => path.includes(fragment));
  } catch {
    return false;
  }
}

export function canonicalizeEventUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const identityParams = [...url.searchParams.entries()]
      .filter(([name]) => identityQueryParams.has(name.toLowerCase()))
      .sort(([nameA, valueA], [nameB, valueB]) => {
        return nameA.localeCompare(nameB) || valueA.localeCompare(valueB);
      });

    const path = url.pathname.replace(/\/$/, '');
    const query = new URLSearchParams(identityParams).toString();
    return `${url.origin}${path}${query ? `?${query}` : ''}`;
  } catch {
    return rawUrl.split('#')[0].replace(/\/$/, '');
  }
}

export function getAnnouncementDate(item) {
  const rawTimestamp = item?.news_meta?.start_at_sec || item?.post?.created_at;
  const seconds = Number.parseInt(rawTimestamp, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(seconds * 1000));

  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}.${values.month}.${values.day}`;
}

export function classifyEventType(text, options = {}) {
  const normalized = text.toLowerCase();

  // The activity title is more specific than incidental words in its rules,
  // such as a video submission's "footprints" or a creator contest's "cooperation".
  const title = String(options.title ?? text);
  if (/视频.{0,8}(?:共创|征集)|(?:奇域|千星).{0,12}创作(?:大)?赛|绘画征集/.test(title)) {
    return '其他活动';
  }

  if (
    normalized.includes('前瞻') ||
    normalized.includes('版本预热') ||
    normalized.includes('特别节目')
  ) {
    return '版本前瞻';
  }
  if (
    normalized.includes('年度报告') ||
    normalized.includes('年度大揭秘') ||
    normalized.includes('年报') ||
    normalized.includes('足迹')
  ) {
    return '年度报告';
  }
  if (normalized.includes('回归') || normalized.includes('重聚') || normalized.includes('召回')) {
    return '回归活动';
  }
  if (normalized.includes('联动') || normalized.includes('合作') || normalized.includes('音乐平台活动')) {
    return '联动活动';
  }
  if (
    normalized.includes('小游戏') ||
    normalized.includes('游玩')
  ) {
    return '小游戏';
  }
  if (
    normalized.includes('资料站') ||
    normalized.includes('图鉴') ||
    normalized.includes('计算器') ||
    normalized.includes('指南')
  ) {
    return '资料站';
  }
  if (normalized.includes('预约') || normalized.includes('预抽卡')) {
    return '预约/预抽卡';
  }
  return '其他活动';
}
