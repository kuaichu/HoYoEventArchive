import { argv } from 'node:process';

const BOT_TOKEN = process.env.TG_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TG_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '-1003962096060';
const CHANNEL_CHAT_ID = process.env.TG_CHANNEL_CHAT_ID || process.env.TELEGRAM_CHANNEL_CHAT_ID;
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
  const json = await res.json();
  if (!json.ok) {
    const migrateTo = json.parameters?.migrate_to_chat_id;
    if (method === 'sendMessage' && migrateTo) {
      return telegram(method, { ...body, chat_id: migrateTo });
    }
    throw new Error(json.description || `Telegram API ${method} failed`);
  }
  return json.result;
}

async function sendMessage(text, target) {
  return telegram('sendMessage', {
    chat_id: target,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  });
}

async function deleteMessage(target, messageId) {
  try {
    await telegram('deleteMessage', {
      chat_id: target,
      message_id: messageId
    });
  } catch (err) {
    console.warn(`Failed to delete Telegram message ${messageId}: ${err.message}`);
  }
}

async function sendToTargets(label, text, targets, deleteAfterSeconds = 0) {
  const sent = [];
  for (const target of chatIds(targets)) {
    try {
      const result = await sendMessage(text, target);
      if (result?.chat?.id && result?.message_id) {
        sent.push({ chatId: result.chat.id, messageId: result.message_id });
      }
    } catch (err) {
      console.warn(`Failed to send Telegram ${label} notification to ${target}: ${err.message}`);
    }
  }

  if (sent.length === 0) {
    console.warn(`No Telegram ${label} notification was sent.`);
    return;
  }

  if (deleteAfterSeconds > 0) {
    console.log(`Telegram ${label} notification will be deleted in ${deleteAfterSeconds}s.`);
    await sleep(deleteAfterSeconds);
    await Promise.all(sent.map(item => deleteMessage(item.chatId, item.messageId)));
  }
}

async function main() {
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
    console.error('Invalid notification type');
    process.exit(1);
  }

  const status = argv[3] || 'success';
  const dataChanged = argv[4] === 'true';
  const trigger = formatTrigger(argv[5]);
  const duration = formatDuration(argv[6]);
  const updateSummary = (process.env.EVENT_UPDATE_SUMMARY || '').trim();
  const dataStr = dataChanged ? 'changed and committed' : 'no changes';
  const title = status === 'success' ? 'HoYo Event Archive sync finished' : 'HoYo Event Archive sync failed';

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
Updates: changed, but no new event summary was generated`;
  }

  text += `
Run: <a href="${runUrl}">#${runId}</a>`;

  const persistentTargets = CHANNEL_CHAT_ID || CHAT_ID;
  const transientTargets = CHAT_ID || CHANNEL_CHAT_ID;
  const shouldDelete = status === 'success' && !updateSummary;
  if (shouldDelete) {
    text += `
Note: no event updates detected; this temporary notice will be deleted.`;
  }

  await sendToTargets(
    'result',
    text,
    shouldDelete || status !== 'success' ? transientTargets : persistentTargets,
    shouldDelete ? TRANSIENT_DELETE_AFTER_SECONDS : 0
  );
}

main().catch(err => {
  console.error(`Failed to send TG notification: ${err.message}`);
  process.exit(0);
});
