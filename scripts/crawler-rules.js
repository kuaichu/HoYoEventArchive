import {
  classifyEventVersion,
  extractExplicitVersion,
  isNumericVersion
} from './version-classification.js';

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
    eventHostnames.has(url.hostname) &&
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

function stripHtml(rawHtml) {
  return String(rawHtml || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractPostText(post) {
  try {
    const ops = typeof post?.structured_content === 'string'
      ? JSON.parse(post.structured_content)
      : post?.structured_content;
    if (Array.isArray(ops)) {
      const text = ops
        .map(op => typeof op?.insert === 'string' ? op.insert : '')
        .filter(Boolean)
        .join('\n')
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
  const match = String(rawDate || '').match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (!match) return undefined;
  return `${match[1]}.${match[2].padStart(2, '0')}.${match[3].padStart(2, '0')}`;
}

function extractRewardSummary(text) {
  const rewardKeyword = /(原石|星琼|菲林|水晶|名片|抽奖|奖励|礼包|兑换码|iPhone|PlayStation|PS5|手办|周边|游戏主机)/i;
  const rewardAction = /(可得|获得|获赠|赢取|领取|抽奖|奖励|最高可得)/;
  const rewardScope = String(text || '').split(/【?活动时间】?/)[0];
  const sentences = rewardScope
    .replace(/\r/g, '')
    .split(/(?<=[。！？!?~～])|\n+/)
    .map(sentence => sentence
      .trim()
      .replace(/^[>【】\s]+|[【】\s]+$/g, '')
      .replace(/[。！？!?~～]+$/g, ''))
    .filter(sentence => sentence.length >= 8)
    .filter(sentence => rewardKeyword.test(sentence) && rewardAction.test(sentence));

  const unique = [...new Set(sentences)].slice(0, 6);
  if (unique.length === 0) return undefined;
  return unique.join('；').slice(0, 300);
}

export function extractAnnouncementMetadata(rawText) {
  const text = String(rawText || '').replace(/\r/g, '');
  const activityTimeSection = text.match(/【?活动时间】?\s*[:：]?([\s\S]{0,240})/i)?.[1] || '';
  const dateRange = activityTimeSection.match(
    /(\d{4}[./-]\d{1,2}[./-]\d{1,2})\s*(?:-|—|–|~|～|至|到)\s*(\d{4}[./-]\d{1,2}[./-]\d{1,2})/
  );
  const description = text
    .split(/\n+/)
    .map(line => line.trim())
    .find(line => line.length >= 12 && !/^【.+】$/.test(line));

  return {
    version: extractExplicitVersion(text),
    startDate: normalizeDateToken(dateRange?.[1]),
    endDate: normalizeDateToken(dateRange?.[2]),
    reward: extractRewardSummary(text),
    description: description?.slice(0, 280)
  };
}

export function classifyCrawlerVersion({ gameKey, title, sourcePostTitle, description, body, date, eventType }) {
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
  setIfMissing(
    'description',
    metadata?.description,
    value => !value || value === '提瓦特/米游社官方网页活动。' || value === '米游社官方网页活动。'
  );

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
    return permanentResourcePathFragments.some(fragment => path.includes(fragment));
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

export function classifyEventType(text) {
  const normalized = text.toLowerCase();

  if (
    normalized.includes('前瞻') ||
    normalized.includes('版本预热') ||
    normalized.includes('特别节目')
  ) {
    return '版本前瞻';
  }
  if (normalized.includes('年度报告') || normalized.includes('年报') || normalized.includes('足迹')) {
    return '年度报告';
  }
  if (normalized.includes('回归') || normalized.includes('重聚') || normalized.includes('召回')) {
    return '回归活动';
  }
  if (normalized.includes('联动') || normalized.includes('合作')) {
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
