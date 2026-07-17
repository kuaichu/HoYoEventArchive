import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const eventsPath = path.join(__dirname, '..', 'src', 'events.json');
const outputDir = path.join(__dirname, '..', 'public', 'images', 'screenshots');
const dryRun = process.argv.includes('--dry-run');

const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
const parsedLimit = limitArg ? Number.parseInt(limitArg.split('=')[1], 10) : Number.POSITIVE_INFINITY;
const captureLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
  ? parsedLimit
  : Number.POSITIVE_INFINITY;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function selectMissingScreenshotEvents(
  events,
  hasScreenshot,
  limit = Number.POSITIVE_INFINITY
) {
  return events
    .filter(event => event.status !== '已失效')
    .filter(event => !hasScreenshot(event))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

export async function captureScreenshots() {
  console.log('Starting screenshot capture process...');

  // Load events and capture only thumbnails that are actually missing.
  const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
  console.log(`Loaded ${events.length} events from database.`);

  const missingEvents = selectMissingScreenshotEvents(
    events,
    event => fs.existsSync(path.join(outputDir, `${event.id}.png`)),
    captureLimit
  );

  console.log(`Found ${missingEvents.length} missing screenshot(s) eligible for capture.`);

  if (missingEvents.length === 0 || dryRun) {
    if (dryRun) {
      missingEvents.forEach(event => console.log(`- ${event.id}: ${event.title}`));
    }
    return;
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log('Created screenshots directory:', outputDir);
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    for (let i = 0; i < missingEvents.length; i++) {
      const event = missingEvents[i];
      const outputPath = path.join(outputDir, `${event.id}.png`);
      let page;

      console.log(`\n[${i + 1}/${missingEvents.length}] Processing: ${event.title}`);

      try {
        page = await browser.newPage();
        await page.setViewport({ width: 1024, height: 576, deviceScaleFactor: 1 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        page.setDefaultNavigationTimeout(45000);
        page.setDefaultTimeout(45000);

      console.log(`-> Navigating to: ${event.url}`);

      // Many event pages keep analytics and game resources connected forever, so
      // waiting for networkidle is unreliable. DOM readiness plus a short settle
      // window produces a stable thumbnail without stalling the whole workflow.
      const response = await page.goto(event.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      
      if (response && response.status() >= 400) {
        console.log(`-> URL returned HTTP ${response.status()}. Skipping.`);
        continue;
      }

      await Promise.race([
        page.evaluate(() => document.fonts?.ready),
        sleep(3000)
      ]);
      await sleep(5000);

      await page.screenshot({ path: outputPath, type: 'png' });
      console.log(`-> Saved screenshot to: ${outputPath}`);

      } catch (error) {
        console.error(`-> Error capturing screenshot for ${event.title}:`, error.message);
      } finally {
        await page?.close().catch(error => {
          console.warn(`-> Failed to close page for ${event.title}:`, error.message);
        });
      }
    }
  } finally {
    await browser?.close();
  }

  console.log('\nScreenshot capture process completed successfully!');
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  captureScreenshots().catch(err => {
    console.error('Fatal error in capture script:', err);
    process.exitCode = 1;
  });
}
