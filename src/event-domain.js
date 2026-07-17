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
  '已结束'
]);

const DATE_PATTERN = /^\d{4}\.\d{2}\.\d{2}$/;
const ID_PATTERN = /^[a-z0-9]+-[a-z0-9-]+$/i;
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
  'sourcePostId',
  'sourcePostTitle',
  'tags',
  'version',
  'description',
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

export function resolveEventStatus(event, todayShanghai = currentShanghaiDate()) {
  const currentStatus = event?.status;

  if (!EVENT_STATUSES.includes(currentStatus)) return currentStatus;

  if (currentStatus === '已失效') return currentStatus;

  const endDate = normalizeComparableDate(event?.endDate);
  const today = normalizeComparableDate(todayShanghai);
  if (!endDate || !today) return currentStatus;

  return endDate < today ? '已结束' : currentStatus;
}

export function projectEventForDisplay(event, todayShanghai = currentShanghaiDate()) {
  return { ...event, status: resolveEventStatus(event, todayShanghai) };
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
  try {
    const url = new URL(String(value ?? ''));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function safeScreenshotUrl(id) {
  return typeof id === 'string' && ID_PATTERN.test(id)
    ? `/images/screenshots/${encodeURIComponent(id)}.png`
    : null;
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
  const url = pick('url', value => validText(value) && safeExternalUrl(value));
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
    version: pick('version', value => validText(value), '通用'),
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
  if (typeof event?.date === 'string' && (
    !DATE_PATTERN.test(event.date) || !normalizeComparableDate(event.date)
  )) {
    issues.push(`${prefix}.date must be a valid YYYY.MM.DD date`);
  }
  if (event?.dateType !== undefined && event.dateType !== 'announcement') {
    issues.push(`${prefix}.dateType is not supported`);
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

  if (!Array.isArray(event?.tags) || event.tags.some(tag => typeof tag !== 'string')) {
    issues.push(`${prefix}.tags must be an array of strings`);
  }

  if (!safeExternalUrl(event?.url)) {
    issues.push(`${prefix}.url must be an absolute credential-free HTTP(S) URL`);
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
