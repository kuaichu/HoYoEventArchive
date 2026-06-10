import { argv } from 'process';

const BOT_TOKEN = '8262701427:AAHVx8MmIzA1weUjxeOWn4--9fMeGQjOgTo';
const CHAT_ID = '-1003962096060';

// Format time in Asia/Shanghai timezone
function getFormattedTime() {
  const options = {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  };
  const formatter = new Intl.DateTimeFormat('zh-CN', options);
  const parts = formatter.formatToParts(new Date());
  const dateObj = {};
  parts.forEach(p => {
    dateObj[p.type] = p.value;
  });
  
  // Format as YYYY/M/D HH:mm
  const year = dateObj.year;
  const month = parseInt(dateObj.month, 10);
  const day = parseInt(dateObj.day, 10);
  const hour = String(dateObj.hour).padStart(2, '0');
  const minute = String(dateObj.minute).padStart(2, '0');
  
  return `${year}/${month}/${day} ${hour}:${minute}`;
}

async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  });
  const json = await res.json();
  if (!json.ok) {
    throw new Error(`Telegram API Error: ${json.description}`);
  }
}

async function main() {
  const type = argv[2]; // 'started' | 'finished'
  const timeStr = getFormattedTime();
  const runId = process.env.GITHUB_RUN_ID || '0';
  const repository = process.env.GITHUB_REPOSITORY || 'kuaichu/HoYoEventArchive';
  const runUrl = `https://github.com/${repository}/actions/runs/${runId}`;
  
  let text = '';
  
  if (type === 'started') {
    const trigger = argv[3] === 'schedule' ? 'schedule' : 'manual';
    text = `[${timeStr}] Notification robot: HoYo Event Archive sync started
Project: hoyo-event-archive
Status: running
Trigger: ${trigger}
Run: #${runId} (${runUrl})`;
  } else if (type === 'finished') {
    const status = argv[3] || 'success';
    const dataChanged = argv[4] === 'true';
    const trigger = argv[5] === 'schedule' ? 'schedule' : 'manual';
    const durationSeconds = parseInt(argv[6], 10) || 0;
    
    // Format duration
    const min = Math.floor(durationSeconds / 60);
    const sec = durationSeconds % 60;
    const durationStr = min > 0 ? `${min}m ${sec}s` : `${sec}s`;
    
    const dataStr = dataChanged ? 'changed and committed' : 'no changes';
    
    text = `[${timeStr}] Notification robot: HoYo Event Archive sync finished
Project: hoyo-event-archive
Status: ${status}
Data: ${dataStr}
Trigger: ${trigger}
Duration: ${durationStr}
Run: #${runId} (${runUrl})`;
  } else {
    console.error('Invalid notification type');
    process.exit(1);
  }
  
  console.log('Sending TG message:\n', text);
  try {
    await sendTelegramMessage(text);
    console.log('TG message sent successfully!');
  } catch (err) {
    console.error('Failed to send TG message:', err.message);
  }
}

main();
