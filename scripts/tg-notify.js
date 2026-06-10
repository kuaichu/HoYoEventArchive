import { argv } from 'process';

const BOT_TOKEN = process.env.TG_BOT_TOKEN;
const CHAT_ID = process.env.TG_CHAT_ID || '-1003962096060';

async function sendTelegramMessage(text) {
  if (!BOT_TOKEN) {
    throw new Error('TG_BOT_TOKEN is not defined in environment variables');
  }
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
  const runId = process.env.GITHUB_RUN_ID || '0';
  const repository = process.env.GITHUB_REPOSITORY || 'kuaichu/HoYoEventArchive';
  const runUrl = `https://github.com/${repository}/actions/runs/${runId}`;
  
  let text = '';
  
  if (type === 'started') {
    const trigger = argv[3] === 'schedule' ? 'schedule' : 'manual';
    text = `HoYo Event Archive sync started
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
    
    text = `HoYo Event Archive sync finished
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
