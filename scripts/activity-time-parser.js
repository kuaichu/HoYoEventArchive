// Official event copy uses Beijing time. Retain its precision: date-only copy
// produces dates, and a minute-only clock never gains invented seconds.
import { normalizeEventTimestamp } from '../src/event-time.js';

const pad = value => String(value).padStart(2, '0');

function validParts(year, month, day, hour = 0, minute = 0, second = 0) {
  if (year < 2000 || year > 2100 || hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
}

export function parseChinaTime(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\+08:00)?$/.exec(value.trim());
  if (!match || Number(match[1]) < 2000 || Number(match[1]) > 2100) return null;
  return normalizeEventTimestamp(`${match[1]}-${pad(match[2])}-${pad(match[3])}T${pad(match[4])}:${match[5]}${match[6] === undefined ? '' : `:${match[6]}`}+08:00`) ?? null;
}

export function parseUnixTime(value) {
  if (value === '' || value === null || value === undefined) return null;
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return null;
  const date = new Date((seconds + 8 * 3600) * 1000);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100) return null;
  return `${date.toISOString().slice(0, 19)}+08:00`;
}

export function activityText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<\/?(?:p|div|h[1-6]|br|li|tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => Number(code) <= 0x10ffff ? String.fromCodePoint(Number(code)) : '')
    .replace(/[\t\r ]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
}

// Two alternatives avoid interpreting version numbers, statistics, or clocks as dates.
const DATE_TOKEN = /(?:(\d{4})年\s*)?(\d{1,2})月\s*(\d{1,2})日(?:\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?|(?:(\d{4})[-/.])?(\d{1,2})[-/.](\d{1,2})(?:[ T]*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/g;
function tokens(text) {
  return [...text.matchAll(DATE_TOKEN)].filter(match => {
    // A version such as 3.2更新后 is not March 2. Dot dates in real intervals
    // remain supported, while an immediately following version word excludes it.
    return !(!match[1] && !match[7] && /^(?:版本|更新|版更|上线)/.test(text.slice(match.index + match[0].length)));
  }).map(match => ({
    year: Number(match[1] ?? match[7]) || null,
    month: Number(match[2] ?? match[8]), day: Number(match[3] ?? match[9]),
    hour: match[4] ?? match[10], minute: match[5] ?? match[11], second: match[6] ?? match[12],
    index: match.index, end: match.index + match[0].length
  }));
}
function render(token, year) {
  const hour = Number(token.hour ?? 0), minute = Number(token.minute ?? 0), second = Number(token.second ?? 0);
  if (!year || !validParts(year, token.month, token.day, hour, minute, second)) return null;
  const date = `${year}.${pad(token.month)}.${pad(token.day)}`;
  return token.hour === undefined ? { date } : {
    at: `${date.replaceAll('.', '-')}T${pad(hour)}:${pad(minute)}${token.second === undefined ? '' : `:${pad(second)}`}+08:00`
  };
}
function referenceYear(options) {
  for (const value of [options.announcementDate, options.startDate, options.date]) {
    const match = /^(20\d{2})[-/.]\d{1,2}[-/.]\d{1,2}/.exec(String(value ?? ''));
    if (match) return Number(match[1]);
  }
  return null;
}
function interval(text, year, endOnly = false) {
  const labelled = /(?:开始时间|开始日期)[：:]\s*([^\n]+)\n\s*(?:结束时间|结束日期)[：:]\s*([^\n]+)/.exec(text);
  if (labelled) return interval(`${labelled[1]}至${labelled[2]}`, year, endOnly);
  const found = tokens(text);
  if (!found.length) return null;
  const first = found[0], second = found[1];
  if (/统计|奖励|领取|发放|公示|评选/.test(text.slice(0, first.index))) return null;
  if (!second) {
    if (!endOnly && !/即日起|截止|截至|结束|(?:版本|更新|版更|上线)[\s\S]*(?:至|到|[-—–~～])/.test(text.slice(0, first.index))) return null;
    const end = render(first, first.year ?? year);
    return end ? { ...(end.at ? { endAt: end.at } : { endDate: end.date }) } : null;
  }
  if (/版本|更新|版更|上线/.test(text.slice(0, first.index))) return null;
  // Require a range delimiter directly between dates; dates in prose are unrelated.
  const between = text.slice(first.end, second.index).replace(/\([^)]*\)|（[^）]*）/g, '').trim();
  if (!/^(?:(?:\d+(?:\.\d+)+)(?:版本)?(?:「[^」]*」)?(?:更新|版更|上线|开启)后\s*)?(?:至|到|[-—–~～])+\s*$/.test(between)) return null;
  let startYear = first.year ?? second.year ?? year;
  let endYear = second.year ?? first.year ?? year;
  if (!first.year && second.year && first.month === 12 && second.month === 1) startYear--;
  if (!second.year && first.month === 12 && second.month === 1) endYear++;
  const start = render(first, startYear), end = render(second, endYear);
  if (!start || !end) return null;
  const result = { ...(start.at ? { startAt: start.at } : { startDate: start.date }),
    ...(end.at ? { endAt: end.at } : { endDate: end.date }) };
  const startMs = Date.parse(start.at ?? start.date.replaceAll('.', '-') + 'T00:00:00+08:00');
  const endMs = Date.parse(end.at ?? end.date.replaceAll('.', '-') + 'T23:59:59+08:00');
  if (startMs > endMs || endMs - startMs > 370 * 86400000) return null;
  return result;
}

export function parseActivityTime(value, options = {}) {
  const text = activityText(value);
  const heading = /(?:活动结束时间|活动截止时间|活动时间|活动开放时间|活动日期|活动期限|投稿时间|投稿阶段|投稿期|报名投稿(?:期|阶段)?|参与时间|参与阶段|征集时间|征集阶段|征集期)[：:〓】\s]*/g;
  const candidates = [];
  let relative;
  for (const match of text.matchAll(heading)) {
    if (/奖励领取|奖励发放|统计|公示|评选/.test(text.slice(Math.max(0, match.index - 12), match.index).split('\n').at(-1))) continue;
    // A short section terminates before the next unrelated semantic heading.
    const tail = text.slice(match.index + match[0].length, match.index + match[0].length + 650);
    const boundary = tail.search(/(?:参与方式|参与条件|活动规则|活动奖励|奖励领取|奖励发放|统计(?:时间|范围|周期)|公示(?:时间|阶段)|评选(?:时间|阶段)|注意事项|〓[^〓]+〓)/);
    const section = boundary >= 0 ? tail.slice(0, boundary) : tail;
    const participationSection = section.split(/(?:作品|奇域)?评审期|(?:结果|获奖)?公示(?:时间|期)/)[0];
    const opening = participationSection.trim().split('\n')[0];
    const versionPeriod = /^(\d+\.\d+)版本期间(?:\s|$)/.exec(opening)?.[1];
    const versionStart = /^(\d+\.\d+)(?:版本)?(?:更新|版更|上线|开启)后\s*(?:至|到|[-—–~～])/.exec(opening)?.[1];
    const version = versionPeriod ? { versionPeriod: `v${versionPeriod}` }
      : versionStart ? { versionStart: `v${versionStart}` } : {};
    if (versionPeriod || versionStart) relative ??= version;
    const range = interval(participationSection, referenceYear(options), /结束|截止/.test(match[0]));
    if (range) candidates.push({ ...range, ...version, section, name: /投稿|征集/.test(match[0]) ? '投稿' : '活动' });
  }
  if (!candidates.length) return { ...relative, reason: /(?:版本|永久|长期)/.test(text) ? 'No explicit calendar activity window' : 'No unambiguous activity time section' };
  const main = candidates.find(candidate => candidate.name === '投稿') ?? candidates[0];
  const { name, section, ...range } = main;
  const timeStages = [];
  // Clearly named periods inside the selected activity-time section are auxiliary.
  const year = Number((range.startAt ?? range.startDate ?? range.endAt ?? range.endDate)?.slice(0, 4)) || referenceYear(options);
  for (const match of section.matchAll(/((?:第?[一二三四1-4]阶段|[一二三四1-4]期|阶段[一二三四1-4]))(?:活动期间)?[：:\s]*([^\n]{0,180})/g)) {
    const stage = interval(match[2], year);
    // Stages are clocks only in the event schema; do not invent midnight for a date.
    if (stage?.startAt && stage?.endAt) timeStages.push({ name: match[1], startAt: stage.startAt, endAt: stage.endAt });
  }
  if (name === '投稿') {
    for (const match of section.matchAll(/(?:作品|奇域)?评审期[：:]\s*([^\n]{0,180})/g)) {
      const stage = interval(match[1], year);
      if (stage?.startAt && stage?.endAt) timeStages.push({ name: '评审', startAt: stage.startAt, endAt: stage.endAt });
    }
  }
  return { ...range, ...(timeStages.length ? { timeStages } : {}) };
}
