import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalizeEventUrl } from './crawler-rules.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const eventsPath = path.join(__dirname, '..', 'src', 'events.json');
const outputDir = path.join(__dirname, '..', 'public', 'images', 'screenshots');
const dryRun = process.argv.includes('--dry-run');
const forceArg = process.argv.find(arg => arg.startsWith('--force='));
const forcedScreenshotIds = new Set(
  (forceArg ? forceArg.split('=')[1] : '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);

const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
const parsedLimit = limitArg ? Number.parseInt(limitArg.split('=')[1], 10) : Number.POSITIVE_INFINITY;
const captureLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
  ? parsedLimit
  : Number.POSITIVE_INFINITY;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function selectMissingScreenshotEvents(
  events,
  hasScreenshot,
  limit = Number.POSITIVE_INFINITY,
  forceIds = new Set()
) {
  return events
    .filter(event => event.status !== '已失效')
    .filter(event => forceIds.has(event.id) || !hasScreenshot(event))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

export function classifyEventPageState({
  engineDetected = false,
  homeVisible = false,
  coverText = '',
  loadingProgress,
  isShowLoading,
  currentScene,
  isGameLoading
}) {
  if (coverText) {
    return /硬件加速/.test(coverText) ? 'dismiss-gpu-warning' : 'fatal-error';
  }
  if (!engineDetected) return 'generic';

  const loadingComplete = loadingProgress === undefined || loadingProgress === 100;
  const loadingHidden = isShowLoading === undefined || isShowLoading === false;
  const mainScene = currentScene === undefined || currentScene === 'scene_main';
  const gameReady = isGameLoading === undefined || isGameLoading === false;
  return homeVisible && loadingComplete && loadingHidden && mainScene && gameReady
    ? 'ready'
    : 'waiting';
}

export function screenshotNavigationUrl(rawUrl) {
  return canonicalizeEventUrl(rawUrl);
}

export async function navigateWithRetries(
  page,
  url,
  { attempts = 3, timeoutMs = 45000, sleepFn = sleep } = {}
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      console.warn(`-> Navigation attempt ${attempt}/${attempts} failed: ${error.message}. Retrying.`);
      await sleepFn(attempt * 1500);
    }
  }
  throw lastError;
}

async function readEventPageState(page) {
  return page.evaluate(() => {
    const isVisible = element => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };

    const cover = document.querySelector('.me-err-cover');
    const home = document.querySelector('.home_page');
    const vue = window.player?.vue;
    const aniStore = vue?.$parent?.aniStore || vue?.aniStore || window.aniStore;

    return {
      engineDetected: Boolean(vue || home),
      homeVisible: isVisible(home),
      coverText: isVisible(cover) ? String(cover.textContent || '').trim() : '',
      loadingProgress: Number.isFinite(Number(vue?.loadingProgress))
        ? Number(vue.loadingProgress)
        : undefined,
      isShowLoading: typeof vue?.isShowLoading === 'boolean' ? vue.isShowLoading : undefined,
      currentScene: typeof vue?.currentScene === 'string' ? vue.currentScene : undefined,
      isGameLoading: typeof aniStore?.isGameLoading === 'boolean' ? aniStore.isGameLoading : undefined
    };
  });
}

export async function waitForEventPageReady(
  page,
  { timeoutMs = 30000, genericSettleMs = 5000, pollIntervalMs = 250 } = {}
) {
  await Promise.race([
    page.evaluate(() => document.fonts?.ready),
    sleep(3000)
  ]);

  const startedAt = Date.now();
  let sawEventEngine = false;

  while (Date.now() - startedAt < timeoutMs) {
    const pageState = await readEventPageState(page);
    sawEventEngine ||= pageState.engineDetected;
    const state = classifyEventPageState(pageState);

    if (state === 'dismiss-gpu-warning') {
      const dismissed = await page.evaluate(() => {
        const button = document.querySelector('.me-err-btn__confirm');
        if (!button) return false;
        button.click();
        return true;
      });
      if (!dismissed) throw new Error('Hardware acceleration warning has no confirmation button.');
      await page.waitForFunction(
        () => !document.querySelector('.me-err-cover'),
        { timeout: 5000 }
      );
      continue;
    }

    if (state === 'fatal-error') {
      throw new Error(`Event page reported an error: ${pageState.coverText}`);
    }
    if (state === 'ready') {
      await sleep(1000);
      return 'event-ui';
    }
    if (!sawEventEngine && Date.now() - startedAt >= genericSettleMs) {
      return 'generic';
    }

    await sleep(pollIntervalMs);
  }

  throw new Error('Timed out waiting for the event main UI to become ready.');
}

export async function captureScreenshots() {
  console.log('Starting screenshot capture process...');

  // Load events and capture only thumbnails that are actually missing.
  const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
  console.log(`Loaded ${events.length} events from database.`);

  const missingEvents = selectMissingScreenshotEvents(
    events,
    event => fs.existsSync(path.join(outputDir, `${event.id}.png`)),
    captureLimit,
    forcedScreenshotIds
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
  let failureCount = 0;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
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

      const navigationUrl = screenshotNavigationUrl(event.url);
      console.log(`-> Navigating to: ${navigationUrl}`);

      // Many event pages keep analytics and game resources connected forever, so
      // waiting for networkidle is unreliable. DOM readiness plus a short settle
      // window produces a stable thumbnail without stalling the whole workflow.
      const response = await navigateWithRetries(page, navigationUrl);
      
      if (response && response.status() >= 400) {
        console.log(`-> URL returned HTTP ${response.status()}. Skipping.`);
        continue;
      }

      const readinessMode = await waitForEventPageReady(page);
      console.log(`-> Page readiness confirmed (${readinessMode}).`);

      await page.screenshot({ path: outputPath, type: 'png' });
      console.log(`-> Saved screenshot to: ${outputPath}`);

      } catch (error) {
        failureCount++;
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

  if (failureCount > 0) {
    throw new Error(`${failureCount} screenshot capture(s) failed.`);
  }

  console.log('\nScreenshot capture process completed successfully!');
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  captureScreenshots().catch(err => {
    console.error('Fatal error in capture script:', err);
    process.exitCode = 1;
  });
}
