import { argv } from 'node:process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

const BOT_TOKEN = process.env.TG_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT_ID = '-1003962096060';

export function resolveTelegramTargets(env = process.env) {
  const statusTargets = env.TG_CHAT_ID || env.TELEGRAM_CHAT_ID || DEFAULT_CHAT_ID;
  const eventTargets = env.TG_CHANNEL_CHAT_ID || env.TELEGRAM_CHANNEL_CHAT_ID || statusTargets;
  return { statusTargets, eventTargets };
}

const { statusTargets: CHAT_ID, eventTargets: CHANNEL_CHAT_ID } = resolveTelegramTargets();
const DRY_RUN = process.env.TG_NOTIFY_DRY_RUN === '1';
const TRANSIENT_DELETE_AFTER_SECONDS = Number.parseInt(
  process.env.TG_TRANSIENT_DELETE_AFTER_SECONDS ||
    process.env.TELEGRAM_TRANSIENT_DELETE_AFTER_SECONDS ||
    '90',
  10
);

function sleep(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

function chatIds(value) {
  return String(value || '')
    .split(/[;,]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function htmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function formatTrigger(value) {
  if (value === 'schedule') return 'schedule';
  if (value === 'workflow_dispatch') return 'manual';
  return value || 'manual';
}

function formatDuration(totalSeconds) {
  const seconds = Number.parseInt(totalSeconds, 10);
  if (!Number.isFinite(seconds) || seconds < 0) return 'unknown';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${String(rest).padStart(2, '0')}s` : `${rest}s`;
}

async function telegram(method, body) {
  if (!BOT_TOKEN) {
    throw new Error('TG_BOT_TOKEN/TELEGRAM_BOT_TOKEN is not defined');
  }

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    const migrateTo = json.parameters?.migrate_to_chat_id;
    if (method === 'sendMessage' && migrateTo) {
      return telegram(method, { ...body, chat_id: migrateTo });
    }
    throw new Error(json.description || `Telegram API ${method} failed`);
  }
  return json.result;
}

async function sendMessage(text, target) {
  if (DRY_RUN) {
    console.log(`[dry-run] sendMessage to ${target}:\n${text}`);
    return { chat: { id: target }, message_id: 1 };
  }

  return telegram('sendMessage', {
    chat_id: target,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  });
}

async function sendPhoto(caption, target, photoPath) {
  if (DRY_RUN) {
    console.log(`[dry-run] sendPhoto to ${target} with ${photoPath}:\n${caption}`);
    return { chat: { id: target }, message_id: 0 };
  }

  if (!BOT_TOKEN) {
    throw new Error('TG_BOT_TOKEN/TELEGRAM_BOT_TOKEN is not defined');
  }

  const form = new FormData();
  const bytes = await readFile(photoPath);
  form.append('chat_id', target);
  form.append('caption', caption);
  form.append('parse_mode', 'HTML');
  form.append('disable_web_page_preview', 'true');
  form.append('photo', new Blob([bytes], { type: 'image/png' }), path.basename(photoPath));

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    body: form
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    const migrateTo = json.parameters?.migrate_to_chat_id;
    if (migrateTo) {
      return sendPhoto(caption, migrateTo, photoPath);
    }
    throw new Error(json.description || 'Telegram API sendPhoto failed');
  }
  return json.result;
}

async function deleteMessage(target, messageId) {
  await telegram('deleteMessage', {
    chat_id: target,
    message_id: messageId
  });
  console.log(`Deleted Telegram message ${messageId} from ${target}.`);
}

function parseEventUpdates() {
  const encoded = process.env.EVENT_UPDATE_JSON_B64 || '';
  if (!encoded) return [];

  try {
    const json = Buffer.from(encoded, 'base64').toString('utf8');
    const events = JSON.parse(json);
    return Array.isArray(events) ? events : [];
  } catch (err) {
    console.warn(`Failed to parse EVENT_UPDATE_JSON_B64: ${err.message}`);
    return [];
  }
}

export function formatVersion(version) {
  if (!version) return '待确认';
  if (/^v/i.test(version)) return `Ver.${version.slice(1)}`;
  return version;
}

function formatDate(date) {
  return String(date || '未识别').replaceAll('.', '/');
}

function cleanHashTag(value) {
  const text = String(value || '')
    .replace(/^#+/, '')
    .replace(/\s+/g, '')
    .replace(/[^\p{Script=Han}\p{Letter}\p{Number}_]/gu, '');
  return text ? `#${text}` : '';
}

export function eventHashTags(event) {
  const versionTag = /^v\d+\.\d+$/i.test(event.version || '')
    ? cleanHashTag(`Ver${event.version.replace(/^v/i, '').replace(/\./g, '')}`)
    : ['公测前', '待确认'].includes(event.version)
      ? cleanHashTag(event.version)
      : '';
  const tags = [
    cleanHashTag(event.game),
    versionTag,
    ...(event.tags || []).map(cleanHashTag),
    cleanHashTag('外链活动')
  ];
  return [...new Set(tags.filter(Boolean))].slice(0, 8).join(' ');
}

function truncateField(text, maxLength) {
  const value = String(text || '');
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function truncateCaption(text, maxLength = 1000) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function eventCaption(event) {
  const reward = truncateField(event.reward || event.rewards || '未识别', 240);
  const time = event.startDate && event.endDate
    ? `${formatDate(event.startDate)} - ${formatDate(event.endDate)}`
    : `${event.dateType === 'announcement' ? '公告：' : ''}${formatDate(event.date)}`;

  return truncateCaption(`<b>游戏活动</b>

🎮 游戏：${htmlEscape(event.game || event.gameKey || '未知')}
📦 版本：${htmlEscape(formatVersion(event.version))}

📌 活动：${htmlEscape(truncateField(event.title || '未命名活动', 120))}

🔗 链接：
${htmlEscape(truncateField(event.url || '', 360))}

📅 时间：
${htmlEscape(time)}

🎁 奖励：
${htmlEscape(reward)}

📊 状态：
${cleanHashTag(event.status || '未知')}

🏷 标签：
${htmlEscape(eventHashTags(event))}`);
}

export function summarizeDeliveries(results) {
  const attempted = results.length;
  const sentCount = results.filter(result => result.ok).length;
  const failedCount = attempted - sentCount;
  return {
    attempted,
    sentCount,
    failedCount,
    ok: attempted > 0 && failedCount === 0
  };
}

export async function deleteDeliveredMessages(
  results,
  deleteAfterSeconds,
  {
    sleepFn = sleep,
    deleteFn = deleteMessage,
    dryRun = DRY_RUN,
    label = 'notification'
  } = {}
) {
  if (deleteAfterSeconds <= 0) return 0;

  const successful = results.filter(result => result.ok);
  if (successful.length === 0) {
    throw new Error(`Cannot delete Telegram ${label}: no successful deliveries were recorded.`);
  }

  const messages = successful.map(result => {
    const chatId = result.message?.chat?.id;
    const messageId = result.message?.message_id;
    if (chatId === undefined || chatId === null || messageId === undefined || messageId === null) {
      throw new Error(`Cannot delete Telegram ${label}: missing Telegram message identifiers.`);
    }
    return { chatId, messageId };
  });

  console.log(`Telegram ${label} will be deleted in ${deleteAfterSeconds}s.`);
  if (dryRun) return messages.length;

  await sleepFn(deleteAfterSeconds);
  await Promise.all(messages.map(item => deleteFn(item.chatId, item.messageId)));
  return messages.length;
}

function targetsExcluding(targets, excludedTargets) {
  const excluded = new Set(chatIds(excludedTargets));
  return chatIds(targets).filter(target => !excluded.has(target)).join(',');
}

export function buildFinishedNotificationPlan({
  status,
  dataChanged,
  trigger,
  duration,
  updateSummary,
  eventUpdates,
  project,
  runId,
  runUrl,
  statusTargets,
  eventTargets,
  transientDeleteAfterSeconds,
  notificationTest = false,
  forceEventCards = false
}) {
  const title = notificationTest
    ? 'HoYo Event Archive notification test'
    : status === 'success'
      ? 'HoYo Event Archive sync finished'
      : 'HoYo Event Archive sync failed';
  const dataStr = notificationTest
    ? 'simulated change (not committed)'
    : dataChanged
      ? 'changed and committed'
      : 'no changes';
  const eventCardsEnabled = status === 'success' && (dataChanged || forceEventCards) && eventUpdates.length > 0;
  const summaryTargets = eventCardsEnabled
    ? targetsExcluding(statusTargets, eventTargets)
    : statusTargets;
  const silentNoChange = status === 'success' && !dataChanged && !notificationTest && !forceEventCards;
  const summaryEnabled = !notificationTest && !silentNoChange && (!eventCardsEnabled || Boolean(summaryTargets));
  let text = `${title}
Project: ${htmlEscape(project)}
Status: ${htmlEscape(status)}
Data: ${htmlEscape(dataStr)}
Trigger: ${htmlEscape(trigger)}
Duration: ${htmlEscape(duration)}`;

  if (updateSummary) {
    text += `
Updates:
${htmlEscape(updateSummary)}`;
  } else if (dataChanged) {
    text += `
Updates: changed, but no newly added event summary was generated`;
  }

  text += `
Run: <a href="${runUrl}">#${runId}</a>`;

  return {
    eventCards: {
      enabled: eventCardsEnabled,
      targets: eventTargets,
      deleteAfterSeconds: notificationTest ? transientDeleteAfterSeconds : 0
    },
    summary: {
      enabled: summaryEnabled,
      text,
      targets: summaryTargets || statusTargets,
      deleteAfterSeconds: 0
    }
  };
}

async function sendEventCards(events, targets, deleteAfterSeconds = 0) {
  const results = [];

  for (const event of events) {
    const caption = eventCaption(event);
    const screenshotPath = path.join('public', 'images', 'screenshots', `${event.id}.png`);

    for (const target of chatIds(targets)) {
      try {
        let message;
        if (existsSync(screenshotPath)) {
          message = await sendPhoto(caption, target, screenshotPath);
        } else {
          message = await sendMessage(caption, target);
        }
        results.push({ ok: true, target, eventId: event.id, message });
      } catch (err) {
        results.push({ ok: false, target, eventId: event.id, error: err.message });
        console.warn(`Failed to send event card for ${event.id || event.title} to ${target}: ${err.message}`);
      }
    }
  }

  const summary = summarizeDeliveries(results);
  if (deleteAfterSeconds > 0 && summary.sentCount > 0) {
    await deleteDeliveredMessages(results, deleteAfterSeconds, { label: 'event card' });
  }
  return summary;
}

async function sendToTargets(label, text, targets, deleteAfterSeconds = 0) {
  const results = [];
  for (const target of chatIds(targets)) {
    try {
      const message = await sendMessage(text, target);
      results.push({ ok: true, target, message });
    } catch (err) {
      results.push({ ok: false, target, error: err.message });
      console.warn(`Failed to send Telegram ${label} notification to ${target}: ${err.message}`);
    }
  }

  const summary = summarizeDeliveries(results);
  if (deleteAfterSeconds > 0 && summary.sentCount > 0) {
    await deleteDeliveredMessages(results, deleteAfterSeconds, { label });
  }
  if (!summary.ok) {
    throw new Error(
      `Telegram ${label} delivery incomplete: ${summary.sentCount}/${summary.attempted} target(s) succeeded.`
    );
  }

  return summary;
}

export async function main() {
  const type = argv[2]; // 'started' | 'finished'
  const runId = process.env.GITHUB_RUN_ID || '0';
  const repository = process.env.GITHUB_REPOSITORY || 'kuaichu/HoYoEventArchive';
  const project = repository.split('/').pop() || 'HoYoEventArchive';
  const runUrl = `https://github.com/${repository}/actions/runs/${runId}`;

  if (type === 'started') {
    const trigger = formatTrigger(argv[3]);
    if (trigger === 'schedule') {
      console.log('Skip scheduled running notification; final result will decide whether to persist.');
      return;
    }

    const text = `HoYo Event Archive sync started
Project: ${htmlEscape(project)}
Status: running
Trigger: ${htmlEscape(trigger)}
Run: <a href="${runUrl}">#${runId}</a>`;
    await sendToTargets('start', text, CHAT_ID || CHANNEL_CHAT_ID, TRANSIENT_DELETE_AFTER_SECONDS);
    return;
  }

  if (type !== 'finished') {
    throw new Error('Invalid notification type');
  }

  const status = argv[3] || 'success';
  const dataChanged = argv[4] === 'true';
  const trigger = formatTrigger(argv[5]);
  const duration = formatDuration(argv[6]);
  const updateSummary = (process.env.EVENT_UPDATE_SUMMARY || '').trim();
  const eventUpdates = parseEventUpdates();
  const persistentTargets = CHANNEL_CHAT_ID || CHAT_ID;
  const transientTargets = CHAT_ID || CHANNEL_CHAT_ID;
  const plan = buildFinishedNotificationPlan({
    status,
    dataChanged,
    trigger,
    duration,
    updateSummary,
    eventUpdates,
    project,
    runId,
    runUrl,
    statusTargets: transientTargets,
    eventTargets: persistentTargets,
    transientDeleteAfterSeconds: TRANSIENT_DELETE_AFTER_SECONDS,
    notificationTest: process.env.TG_NOTIFICATION_TEST === '1',
    forceEventCards: process.env.TG_FORCE_EVENT_CARDS === '1'
  });
  const notificationTest = process.env.TG_NOTIFICATION_TEST === '1';
  let cardDeliveryError;

  if (plan.eventCards.enabled) {
    const cardDelivery = await sendEventCards(
      eventUpdates,
      plan.eventCards.targets,
      plan.eventCards.deleteAfterSeconds
    );
    if (cardDelivery.ok) {
      console.log(`Sent ${cardDelivery.sentCount} event card notification(s).`);
    } else if (cardDelivery.sentCount > 0) {
      cardDeliveryError = new Error(
        `Event card delivery incomplete: ${cardDelivery.sentCount}/${cardDelivery.attempted} succeeded.`
      );
    } else {
      console.warn('No event card notification was sent; the status summary will still be delivered.');
      cardDeliveryError = new Error('Event card delivery failed for every target.');
    }
  }

  if (notificationTest && !plan.eventCards.enabled) {
    throw new Error('Telegram notification test requires at least one synthetic event card.');
  }

  if (plan.summary.enabled || (cardDeliveryError && !notificationTest)) {
    await sendToTargets(
      'result',
      plan.summary.text,
      plan.summary.targets,
      plan.summary.deleteAfterSeconds
    );
  } else if (!plan.eventCards.enabled) {
    console.log('No repository changes detected; skipping Telegram notification.');
  }

  if (cardDeliveryError) throw cardDeliveryError;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch(err => {
    console.error(`Failed to send TG notification: ${err.message}`);
    process.exitCode = 1;
  });
}
