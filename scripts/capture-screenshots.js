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
const fallbackArg = process.argv.find(arg => arg.startsWith('--fallback='));
const fallbackScreenshotIds = new Set(
  (fallbackArg ? fallbackArg.split('=')[1] : '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);
const fallbackOnFailure = process.argv.includes('--fallback-on-failure');
const requestedScreenshotIds = new Set([...forcedScreenshotIds, ...fallbackScreenshotIds]);

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

export function classifyGenericPageQuality({ visibleText = '', hasVisibleLoading = false }) {
  const normalizedText = String(visibleText || '').replace(/\s+/g, ' ').trim();
  if (
    /auth\s*key.*解析失败|您没有登录|当前暂未登录|请选择登录方式|分享链接有误|活动已下线|资源加载失败/i.test(
      normalizedText
    )
  ) {
    return 'fatal-error';
  }
  if (hasVisibleLoading || /(?:正在)?加载中|loading\.{0,3}|请稍候/i.test(normalizedText)) {
    return 'waiting';
  }
  return 'ready';
}

export function isScreenshotBufferUsable(buffer) {
  return Boolean(buffer && buffer.length >= 10_000);
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

async function readGenericPageQuality(page) {
  return page.evaluate(() => {
    const isVisible = element => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 10 && rect.height > 10;
    };
    const loadingSelectors = [
      '[role="progressbar"]',
      '[class*="loading"]',
      '[class*="spinner"]',
      '[class*="progress"]'
    ];
    const hasVisibleLoading = loadingSelectors.some(selector =>
      [...document.querySelectorAll(selector)].some(element => {
        if (!isVisible(element)) return false;
        const style = getComputedStyle(element);
        const text = String(element.textContent || '');
        return style.animationName !== 'none' || /加载|loading/i.test(text) || element.getAttribute('role') === 'progressbar';
      })
    );
    return {
      visibleText: String(document.body?.innerText || '').slice(0, 12000),
      hasVisibleLoading
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
      const genericQuality = await readGenericPageQuality(page);
      const genericState = classifyGenericPageQuality(genericQuality);
      if (genericState === 'fatal-error') {
        throw new Error(`Generic event page failed quality checks: ${genericQuality.visibleText.slice(0, 160)}`);
      }
      if (genericState === 'ready') {
        await sleep(1000);
        return 'generic';
      }
    }

    await sleep(pollIntervalMs);
  }

  throw new Error('Timed out waiting for the event main UI to become ready.');
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function renderFallbackScreenshot(page, event, outputPath) {
  const palettes = {
    ys: ['#17314f', '#d8a64f'],
    sr: ['#1f244d', '#9b7ad6'],
    zzz: ['#17191f', '#f2c84b'],
    bh3: ['#243d5c', '#63c7df']
  };
  const [background, accent] = palettes[event.gameKey] || ['#20263a', '#7f8cff'];
  const time = event.startDate && event.endDate
    ? `${event.startDate} — ${event.endDate}`
    : `公告日期 ${event.date || '未识别'}`;
  await page.setContent(`<!doctype html>
    <html lang="zh-CN"><head><meta charset="utf-8"><style>
      *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}
      body{font-family:"Microsoft YaHei","Noto Sans CJK SC",Arial,sans-serif;color:#fff;
        background:radial-gradient(circle at 78% 18%,${accent}55,transparent 34%),linear-gradient(135deg,${background},#090b13 78%)}
      .frame{height:100%;padding:58px 70px;display:flex;flex-direction:column;justify-content:space-between;position:relative}
      .frame:after{content:"";position:absolute;inset:22px;border:1px solid ${accent}66;border-radius:24px;pointer-events:none}
      .game{font-size:25px;color:${accent};font-weight:700;letter-spacing:.12em}
      h1{font-size:58px;line-height:1.15;margin:20px 0;max-width:850px;text-wrap:balance}
      .meta{font-size:24px;color:#d8dbea;display:flex;gap:18px;flex-wrap:wrap}
      .tag{padding:8px 15px;border:1px solid ${accent}88;border-radius:999px;background:#0005}
      .note{font-size:20px;color:#aeb5c8}.accent{width:105px;height:7px;background:${accent};border-radius:9px;margin-bottom:18px}
    </style></head><body><div class="frame">
      <div><div class="game">${escapeHtml(event.game || event.gameKey)}</div><div class="accent"></div>
        <h1>${escapeHtml(event.title)}</h1><div class="meta">
          <span class="tag">${escapeHtml(event.version || '通用')}</span>
          <span class="tag">${escapeHtml(event.type || '网页活动')}</span>
          <span class="tag">${escapeHtml(time)}</span>
        </div></div>
      <div class="note">活动页面暂无法生成可靠封面 · HoYo Event Archive</div>
    </div></body></html>`, { waitUntil: 'domcontentloaded' });
  const buffer = await page.screenshot({ type: 'png' });
  if (!isScreenshotBufferUsable(buffer)) throw new Error('Generated fallback screenshot is unexpectedly small.');
  fs.writeFileSync(outputPath, buffer);
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
    requestedScreenshotIds
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
  let fallbackCount = 0;
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

      if (fallbackScreenshotIds.has(event.id)) {
        await renderFallbackScreenshot(page, event, outputPath);
        fallbackCount++;
        console.log(`-> Saved curated fallback cover to: ${outputPath}`);
        continue;
      }

      const navigationUrl = screenshotNavigationUrl(event.url);
      console.log(`-> Navigating to: ${navigationUrl}`);

      // Many event pages keep analytics and game resources connected forever, so
      // waiting for networkidle is unreliable. DOM readiness plus a short settle
      // window produces a stable thumbnail without stalling the whole workflow.
      const response = await navigateWithRetries(page, navigationUrl);
      
      if (response && response.status() >= 400) {
        throw new Error(`URL returned HTTP ${response.status()}.`);
      }

      const readinessMode = await waitForEventPageReady(page);
      console.log(`-> Page readiness confirmed (${readinessMode}).`);

      const screenshotBuffer = await page.screenshot({ type: 'png' });
      if (!isScreenshotBufferUsable(screenshotBuffer)) {
        throw new Error(`Screenshot buffer is too small (${screenshotBuffer.length} bytes).`);
      }
      fs.writeFileSync(outputPath, screenshotBuffer);
      console.log(`-> Saved screenshot to: ${outputPath}`);

      } catch (error) {
        console.error(`-> Error capturing screenshot for ${event.title}:`, error.message);
        if (fallbackOnFailure && page) {
          try {
            await renderFallbackScreenshot(page, event, outputPath);
            fallbackCount++;
            console.log(`-> Saved fallback cover after capture failure: ${outputPath}`);
          } catch (fallbackError) {
            failureCount++;
            console.error(`-> Error rendering fallback for ${event.title}:`, fallbackError.message);
          }
        } else {
          failureCount++;
        }
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

  console.log(`\nScreenshot capture process completed successfully (${fallbackCount} fallback cover(s)).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  captureScreenshots().catch(err => {
    console.error('Fatal error in capture script:', err);
    process.exitCode = 1;
  });
}
