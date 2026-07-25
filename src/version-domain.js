const SPECIAL_VERSION_RANK = new Map([
  ['公测前', 1],
  ['通用', 2],
  ['待确认', 3]
]);

export function compareVersions(a, b) {
  const aRank = SPECIAL_VERSION_RANK.get(a) || 0;
  const bRank = SPECIAL_VERSION_RANK.get(b) || 0;
  if (aRank !== bRank) return aRank - bRank;
  if (aRank > 0) return 0;
  return b.localeCompare(a, 'zh-CN', { numeric: true });
}
