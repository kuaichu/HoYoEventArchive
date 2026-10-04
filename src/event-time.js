const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})$/;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

// Explicit offsets avoid the browser's local timezone and Date's calendar rollover.
export function normalizeEventTimestamp(value) {
  if (typeof value !== 'string') return undefined;
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return undefined;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const [year, month, day, hour, minute, second] = [
    yearText, monthText, dayText, hourText, minuteText, secondText ?? '0'
  ].map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31
    || hour > 23 || minute > 59 || second > 59) return undefined;

  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, 0);
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1
    || local.getUTCDate() !== day) return undefined;
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return undefined;
    offsetMinutes = (zone[0] === '+' ? 1 : -1) * (offsetHour * 60 + offsetMinute);
  }
  const shanghai = new Date(local.getTime() - offsetMinutes * 60_000 + SHANGHAI_OFFSET_MS);
  if (shanghai.getUTCFullYear() < 1 || shanghai.getUTCFullYear() > 9999) return undefined;
  return `${shanghai.toISOString().slice(0, secondText === undefined ? 16 : 19)}+08:00`;
}

export function timestampDate(value) {
  return normalizeEventTimestamp(value)?.slice(0, 10).replaceAll('-', '.');
}

function displayEndpoint(timestamp, date) {
  const normalized = normalizeEventTimestamp(timestamp);
  if (normalized) return `${normalized.slice(0, 10).replaceAll('-', '.')} ${normalized.slice(11, -6)}`;
  if (typeof date !== 'string') return '未知';
  const match = /^(\d{4})[.-](\d{2})[.-](\d{2})$/.exec(date);
  if (!match || !normalizeEventTimestamp(`${match[1]}-${match[2]}-${match[3]}T00:00+08:00`)) return '未知';
  return `${match[1]}.${match[2]}.${match[3]}`;
}

export function formatEventTimeRange(event) {
  const start = displayEndpoint(event?.startAt, event?.startDate);
  const end = displayEndpoint(event?.endAt, event?.endDate);
  const timezone = normalizeEventTimestamp(event?.startAt) || normalizeEventTimestamp(event?.endAt)
    ? '（北京时间）' : '';
  return `${start} ～ ${end}${timezone}`;
}
