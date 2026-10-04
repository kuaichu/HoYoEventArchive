import { normalizeStoredEventUrl } from './event-url.js';
import { normalizeEventTimestamp, timestampDate } from './event-time.js';

export const GAME_KEYS = Object.freeze(['all', 'ys', 'sr', 'zzz', 'bh3']);

export const EVENT_TYPES = Object.freeze([
  '年度报告',
  '回归活动',
  '版本前瞻',
  '小游戏',
  '资料站',
  '预约/预抽卡',
  '联动活动',
  '其他活动'
]);

export const EVENT_STATUSES = Object.freeze([
  '可访问',
  '已失效',
  '需登录',
  '未开始',
  '已结束'
]);

export const TIME_SOURCES = Object.freeze(['activity-api', 'activity-config', 'announcement', 'manual']);

const DATE_PATTERN = /^\d{4}\.\d{2}\.\d{2}$/;
const ID_PATTERN = /^[a-z0-9]+-[a-z0-9-]+$/i;
export const VERSION_PATTERN = /^(?:v\d+\.\d+|公测前|通用|待确认)$/;
const NUMERIC_VERSION_PATTERN = /^v\d+\.\d+$/;
const FEATURED_KEYWORDS = Object.freeze([
  '三周年',
  '五周年',
  '周年庆',
  '二周年',
  '预抽卡',
  'WIKI',
  '概念站'
]);

export const EVENT_FIELDS = Object.freeze([
  'id',
  'title',
  'url',
  'game',
  'gameKey',
  'type',
  'status',
  'date',
  'dateType',
  'startDate',
  'endDate',
  'startAt',
  'endAt',
  'timeSource',
  'timeSourceUrl',
  'timeStages',
  'sourcePostId',
  'sourcePostTitle',
  'sourceNewsId',
  'sourceNewsUrl',
  'coverUrl',
  'coverSourceUrl',
  'tags',
  'version',
  'description',
  'descriptionSource',
  'reward',
  'rewards'
]);

export const GAME_META = Object.freeze({
  all: Object.freeze({
    name: '全部游戏',
    cover: '/images/hero_banner_bg.png',
    title: '游戏活动专区',
    description: ''
  }),
  ys: Object.freeze({
    name: '原神',
    cover: '/images/genshin_cover.png',
    title: '原神活动专区',
    description: '收录原神历年网页活动、概念网页与官方特别企划'
  }),
  sr: Object.freeze({
    name: '星穹铁道',
    cover: '/images/hsr_cover.png',
    title: '崩坏：星穹铁道活动专区',
    description: '收录星铁历年网页活动、数据报告及年度入梦指南'
  }),
  zzz: Object.freeze({
    name: '绝区零',
    cover: '/images/zzz_cover.png',
    title: '绝区零活动专区',
    description: '收录绝区零历次测试预约、公测活动及趣味H5'
  }),
  bh3: Object.freeze({
    name: '崩坏3',
    cover: '/images/bh3_cover.png',
    title: '崩坏3活动专区',
    description: '收录崩坏3历次版本大型H5网页企划与特别福利活动'
  })
});

export const STATUS_META = Object.freeze({
  可访问: Object.freeze({ className: 'available', icon: 'fa-circle-check' }),
  已失效: Object.freeze({ className: 'expired', icon: 'fa-triangle-exclamation' }),
  需登录: Object.freeze({ className: 'login', icon: 'fa-lock' }),
  未开始: Object.freeze({ className: 'upcoming', icon: 'fa-clock' }),
  已结束: Object.freeze({ className: 'ended', icon: 'fa-clock' })
});

function normalizeComparableDate(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replaceAll('.', '-');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;

  const [year, month, day] = normalized.split('-').map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return normalized;
}

export function currentShanghaiDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

export function resolveEventStatus(event, todayShanghai = currentShanghaiDate(), now = new Date()) {
  const currentStatus = event?.status;

  if (!EVENT_STATUSES.includes(currentStatus)) return currentStatus;

  if (currentStatus === '已失效') return currentStatus;

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const endAt = normalizeEventTimestamp(event?.endAt);
  if (endAt) {
    // Minute-only announcements include that entire minute, even when it is :00.
    const cutoff = Date.parse(endAt) + (endAt.length === 22 ? 60_000 : 0);
    if (nowMs >= cutoff) return '已结束';
  }
  const endDate = normalizeComparableDate(event?.endDate);
  const today = normalizeComparableDate(todayShanghai);
  if (!endAt && endDate && today && endDate < today) return '已结束';

  const startAt = normalizeEventTimestamp(event?.startAt);
  if (startAt && Number.isFinite(nowMs) && ['可访问', '未开始'].includes(currentStatus)) {
    return nowMs < Date.parse(startAt) ? '未开始' : '可访问';
  }
  const startDate = normalizeComparableDate(event?.startDate);
  if (!startAt && startDate && today && ['可访问', '未开始'].includes(currentStatus)) {
    return startDate > today ? '未开始' : '可访问';
  }
  return currentStatus;
}

export function projectEventForDisplay(event, todayShanghai = currentShanghaiDate(), now = new Date()) {
  return { ...event, status: resolveEventStatus(event, todayShanghai, now) };
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function safeExternalUrl(value) {
  return normalizeStoredEventUrl(value);
}

export function safeCoverUrl(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  if (/^\/images\/covers\/[a-z0-9]+-[a-z0-9-]+\.(?:jpg|jpeg|png|webp)$/i.test(cleaned)) {
    return cleaned;
  }
  try {
    const url = new URL(cleaned);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    // Image transformations and signed URLs depend on their original query parameters.
    return url.toString();
  } catch {
    return null;
  }
}

function safeCoverSourceUrl(value) {
  const url = safeCoverUrl(value);
  return url && !url.startsWith('/') ? url : null;
}

function timeStageIssues(stages, prefix) {
  const issues = [];
  if (!Array.isArray(stages) || stages.length < 1 || stages.length > 12) {
    return [`${prefix} must contain between 1 and 12 stages`];
  }
  let previousAnchor;
  for (const [index, stage] of stages.entries()) {
    const path = `${prefix}[${index}]`;
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) {
      issues.push(`${path} must be a stage object`);
      continue;
    }
    if (Object.keys(stage).some(field => !['name', 'startAt', 'endAt'].includes(field))) {
      issues.push(`${path} contains unsupported fields`);
    }
    if (typeof stage.name !== 'string' || !stage.name.trim() || stage.name.trim().length > 48) {
      issues.push(`${path}.name must be a non-empty string of at most 48 characters`);
    }
    const startAt = normalizeEventTimestamp(stage.startAt);
    const endAt = normalizeEventTimestamp(stage.endAt);
    for (const field of ['startAt', 'endAt']) {
      if (Object.prototype.hasOwnProperty.call(stage, field) && !normalizeEventTimestamp(stage[field])) {
        issues.push(`${path}.${field} must be a valid ISO timestamp with an explicit timezone`);
      }
    }
    if (!startAt && !endAt) issues.push(`${path} requires at least one valid timestamp`);
    if (startAt && endAt && Date.parse(startAt) > Date.parse(endAt)) {
      issues.push(`${path}.startAt must not be after endAt`);
    }
    const anchor = startAt || endAt;
    if (anchor && previousAnchor && Date.parse(anchor) < Date.parse(previousAnchor)) {
      issues.push(`${path} must follow chronological stage order`);
    }
    if (anchor) previousAnchor = anchor;
  }
  return issues;
}

const BUILD_SCREENSHOT_VERSION = typeof __SCREENSHOT_VERSION__ === 'string'
  ? __SCREENSHOT_VERSION__
  : '';

export function safeScreenshotUrl(id, version = BUILD_SCREENSHOT_VERSION) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
  const base = `/images/screenshots/${encodeURIComponent(id)}.png`;
  const normalizedVersion = String(version || '').trim();
  return normalizedVersion ? `${base}?v=${encodeURIComponent(normalizedVersion)}` : base;
}

export function normalizeGameKey(value) {
  return GAME_KEYS.includes(value) ? value : 'all';
}

export function gameKeyForName(name) {
  return Object.entries(GAME_META).find(([, meta]) => meta.name === name)?.[0] || 'all';
}

export function statusMeta(status) {
  return STATUS_META[status] || STATUS_META['已结束'];
}

export function isAvailable(event) {
  return event?.status === '可访问';
}

export function isFeaturedEvent(event) {
  const title = typeof event?.title === 'string' ? event.title : '';
  const tags = Array.isArray(event?.tags) ? event.tags : [];
  return FEATURED_KEYWORDS.some(keyword => (
    title.includes(keyword) || tags.some(tag => String(tag).includes(keyword))
  ));
}

export function normalizeBookmarks(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(item => typeof item === 'string' && item.trim() !== ''))];
}

export function normalizeEvent(raw, fallback = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const fallbackEvent = fallback && typeof fallback === 'object' ? fallback : {};
  const own = field => Object.prototype.hasOwnProperty.call(raw, field);
  const validText = (value, allowEmpty = false) => (
    typeof value === 'string' && (allowEmpty || value.trim() !== '')
  );
  const validDate = value => Boolean(normalizeComparableDate(value));
  const pick = (field, validator, defaultValue = null) => {
    if (validator(raw[field])) return raw[field];
    if (validator(fallbackEvent[field])) return fallbackEvent[field];
    return defaultValue;
  };

  const id = pick('id', value => typeof value === 'string' && ID_PATTERN.test(value));
  if (!id) return null;

  const gameKey = pick('gameKey', value => GAME_KEYS.includes(value));
  const title = pick('title', value => validText(value));
  const url = safeExternalUrl(raw.url) || safeExternalUrl(fallbackEvent.url);
  const type = pick('type', value => EVENT_TYPES.includes(value));
  const status = pick('status', value => EVENT_STATUSES.includes(value));
  const date = pick('date', validDate);

  if (!gameKey || !title || !url || !type || !status || !date) return null;

  const normalized = {
    id,
    title,
    url,
    game: GAME_META[gameKey].name,
    gameKey,
    type,
    status,
    date: date.replaceAll('-', '.'),
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter(tag => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean)
      : Array.isArray(fallbackEvent.tags)
        ? fallbackEvent.tags.filter(tag => typeof tag === 'string')
        : [],
    version: pick('version', value => validText(value), '待确认'),
    description: pick('description', value => validText(value, true), '')
  };

  if (own('dateType')) {
    if (raw.dateType === 'announcement') normalized.dateType = raw.dateType;
  } else if (fallbackEvent.dateType === 'announcement') {
    normalized.dateType = fallbackEvent.dateType;
  }

  for (const field of ['startDate', 'endDate']) {
    if (own(field)) {
      if (raw[field] !== null && raw[field] !== undefined && validDate(raw[field])) {
        normalized[field] = raw[field].replaceAll('-', '.');
      }
    } else if (validDate(fallbackEvent[field])) {
      normalized[field] = fallbackEvent[field].replaceAll('-', '.');
    }
  }

  for (const field of ['sourcePostId', 'sourcePostTitle', 'reward', 'rewards']) {
    if (own(field)) {
      if (raw[field] !== null && raw[field] !== undefined && typeof raw[field] === 'string') {
        normalized[field] = raw[field];
      }
    } else if (typeof fallbackEvent[field] === 'string') {
      normalized[field] = fallbackEvent[field];
    }
  }

  for (const field of ['coverUrl', 'coverSourceUrl']) {
    const sanitize = field === 'coverUrl' ? safeCoverUrl : safeCoverSourceUrl;
    const value = sanitize(own(field) ? raw[field] : fallbackEvent[field]);
    if (value) normalized[field] = value;
  }

  for (const field of ['startAt', 'endAt']) {
    const value = normalizeEventTimestamp(own(field) ? raw[field] : fallbackEvent[field]);
    const dateField = field === 'startAt' ? 'startDate' : 'endDate';
    const explicitlyCleared = own(dateField) && raw[dateField] === null;
    if (value && !explicitlyCleared && (!normalized[dateField] || normalized[dateField] === timestampDate(value))) {
      normalized[field] = value;
    }
  }
  const timeSource = own('timeSource') ? raw.timeSource : fallbackEvent.timeSource;
  if (TIME_SOURCES.includes(timeSource)) normalized.timeSource = timeSource;
  const timeSourceUrl = safeCoverSourceUrl(own('timeSourceUrl') ? raw.timeSourceUrl : fallbackEvent.timeSourceUrl);
  if (timeSourceUrl) normalized.timeSourceUrl = timeSourceUrl;
  const timeStages = own('timeStages') ? raw.timeStages : fallbackEvent.timeStages;
  if (timeStageIssues(timeStages, 'timeStages').length === 0) {
    normalized.timeStages = timeStages.map(stage => ({
      name: stage.name.trim(),
      ...(stage.startAt === undefined ? {} : { startAt: normalizeEventTimestamp(stage.startAt) }),
      ...(stage.endAt === undefined ? {} : { endAt: normalizeEventTimestamp(stage.endAt) })
    }));
  }

  const sourceNewsId = own('sourceNewsId') ? raw.sourceNewsId : fallbackEvent.sourceNewsId;
  if (typeof sourceNewsId === 'string' && /^\d+$/.test(sourceNewsId)) {
    normalized.sourceNewsId = sourceNewsId;
  }
  const sourceNewsUrl = safeExternalUrl(own('sourceNewsUrl') ? raw.sourceNewsUrl : fallbackEvent.sourceNewsUrl);
  if (sourceNewsUrl) normalized.sourceNewsUrl = sourceNewsUrl;

  const descriptionSource = own('descriptionSource') ? raw.descriptionSource : fallbackEvent.descriptionSource;
  if (['announcement', 'page', 'manual'].includes(descriptionSource)) {
    normalized.descriptionSource = descriptionSource;
  }

  return normalized;
}

export function validateEvent(event, index = -1) {
  const prefix = index >= 0 ? `events[${index}]` : 'event';
  const issues = [];
  const requiredStrings = [
    'id',
    'title',
    'url',
    'game',
    'gameKey',
    'type',
    'status',
    'date',
    'version'
  ];

  for (const field of requiredStrings) {
    if (typeof event?.[field] !== 'string' || event[field].trim() === '') {
      issues.push(`${prefix}.${field} must be a non-empty string`);
    }
  }

  if (typeof event?.id === 'string' && !ID_PATTERN.test(event.id)) {
    issues.push(`${prefix}.id has an invalid format`);
  }
  if (!GAME_KEYS.includes(event?.gameKey)) {
    issues.push(`${prefix}.gameKey is not supported`);
  }
  if (!EVENT_TYPES.includes(event?.type)) {
    issues.push(`${prefix}.type is not supported`);
  }
  if (!EVENT_STATUSES.includes(event?.status)) {
    issues.push(`${prefix}.status is not supported`);
  }
  if (typeof event?.version === 'string' && !VERSION_PATTERN.test(event.version)) {
    issues.push(`${prefix}.version is not a supported classification`);
  }
  if (event?.type === '版本前瞻' && !NUMERIC_VERSION_PATTERN.test(event?.version || '')) {
    issues.push(`${prefix}.version previews require a numeric target version`);
  }
  if (typeof event?.date === 'string' && (
    !DATE_PATTERN.test(event.date) || !normalizeComparableDate(event.date)
  )) {
    issues.push(`${prefix}.date must be a valid YYYY.MM.DD date`);
  }
  if (event?.dateType !== undefined && event.dateType !== 'announcement') {
    issues.push(`${prefix}.dateType is not supported`);
  }
  if (event?.descriptionSource !== undefined && !['announcement', 'page', 'manual'].includes(event.descriptionSource)) {
    issues.push(`${prefix}.descriptionSource is not supported`);
  }
  if (event?.endDate !== undefined && !normalizeComparableDate(event.endDate)) {
    issues.push(`${prefix}.endDate must be a valid YYYY.MM.DD date`);
  }
  if (
    event?.startDate !== undefined &&
    !normalizeComparableDate(event.startDate)
  ) {
    issues.push(`${prefix}.startDate must be a valid YYYY.MM.DD date`);
  }
  if (
    normalizeComparableDate(event?.startDate) &&
    normalizeComparableDate(event?.endDate) &&
    normalizeComparableDate(event.startDate) > normalizeComparableDate(event.endDate)
  ) {
    issues.push(`${prefix}.startDate must not be after endDate`);
  }

  for (const [field, dateField] of [['startAt', 'startDate'], ['endAt', 'endDate']]) {
    if (event?.[field] === undefined || event[field] === null) continue;
    const timestamp = normalizeEventTimestamp(event[field]);
    if (!timestamp) {
      issues.push(`${prefix}.${field} must be a valid ISO timestamp with an explicit timezone`);
    } else if (normalizeComparableDate(event[dateField])
      && timestampDate(timestamp) !== event[dateField].replaceAll('-', '.')) {
      issues.push(`${prefix}.${field} must match the Shanghai date in ${dateField}`);
    }
  }
  if (normalizeEventTimestamp(event?.startAt) && normalizeEventTimestamp(event?.endAt)
    && Date.parse(event.startAt) > Date.parse(event.endAt)) {
    issues.push(`${prefix}.startAt must not be after endAt`);
  }
  if (event?.timeSource !== undefined && event.timeSource !== null && !TIME_SOURCES.includes(event.timeSource)) {
    issues.push(`${prefix}.timeSource is not supported`);
  }
  if (event?.timeSourceUrl !== undefined && event.timeSourceUrl !== null && !safeCoverSourceUrl(event.timeSourceUrl)) {
    issues.push(`${prefix}.timeSourceUrl must be an absolute credential-free HTTP(S) URL`);
  }
  if (event?.timeStages !== undefined && event.timeStages !== null) {
    issues.push(...timeStageIssues(event.timeStages, `${prefix}.timeStages`));
  }

  if (!Array.isArray(event?.tags) || event.tags.some(tag => typeof tag !== 'string')) {
    issues.push(`${prefix}.tags must be an array of strings`);
  }

  if (!safeExternalUrl(event?.url)) {
    issues.push(`${prefix}.url must be an absolute credential-free HTTP(S) URL`);
  }
  if (event?.sourceNewsId !== undefined && event.sourceNewsId !== null
    && (typeof event.sourceNewsId !== 'string' || !/^\d+$/.test(event.sourceNewsId))) {
    issues.push(`${prefix}.sourceNewsId must be a numeric string`);
  }
  if (event?.sourceNewsUrl !== undefined && event.sourceNewsUrl !== null && !safeExternalUrl(event.sourceNewsUrl)) {
    issues.push(`${prefix}.sourceNewsUrl must be an absolute credential-free HTTP(S) URL`);
  }
  if (event?.coverUrl !== undefined && event.coverUrl !== null && !safeCoverUrl(event.coverUrl)) {
    issues.push(`${prefix}.coverUrl must be an archived cover path or a credential-free HTTP(S) URL`);
  }
  if (
    event?.coverSourceUrl !== undefined && event.coverSourceUrl !== null &&
    !safeCoverSourceUrl(event.coverSourceUrl)
  ) {
    issues.push(`${prefix}.coverSourceUrl must be an absolute credential-free HTTP(S) URL`);
  }
  if (GAME_META[event?.gameKey]?.name !== event?.game) {
    issues.push(`${prefix}.game must match gameKey`);
  }

  return issues;
}

export function validateEventCollection(events) {
  if (!Array.isArray(events)) return ['events must be an array'];

  const issues = events.flatMap((event, index) => validateEvent(event, index));
  const ids = new Set();
  const urls = new Set();

  events.forEach((event, index) => {
    if (ids.has(event.id)) issues.push(`events[${index}].id is duplicated`);
    ids.add(event.id);

    if (urls.has(event.url)) issues.push(`events[${index}].url is duplicated`);
    urls.add(event.url);
  });

  return issues;
}
