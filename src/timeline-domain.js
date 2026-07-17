function dateParts(event) {
  const match = String(event?.date || '').match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  return match
    ? { year: match[1], month: match[2], day: match[3] }
    : { year: '其他', month: '其他', day: String(event?.date || '') };
}

function descendingPeriod(a, b) {
  if (a === '其他') return 1;
  if (b === '其他') return -1;
  return b.localeCompare(a, 'zh-CN', { numeric: true });
}

export function groupTimelineEvents(events) {
  const groups = new Map();
  const sorted = [...events].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  for (const event of sorted) {
    const { year, month } = dateParts(event);
    if (!groups.has(year)) groups.set(year, new Map());
    const months = groups.get(year);
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(event);
  }

  return [...groups.entries()]
    .sort(([yearA], [yearB]) => descendingPeriod(yearA, yearB))
    .map(([year, months]) => ({
      year,
      months: [...months.entries()]
        .sort(([monthA], [monthB]) => descendingPeriod(monthA, monthB))
        .map(([month, monthEvents]) => ({
          month,
          label: month === '其他' ? '日期未注明' : `${Number(month)}月`,
          events: monthEvents
        }))
    }));
}

export function timelineDayLabel(event) {
  const { day } = dateParts(event);
  const label = /^\d{2}$/.test(day) ? `${Number(day)}日` : day;
  return event?.dateType === 'announcement' ? `公告 ${label}` : label;
}
