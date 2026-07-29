import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeStoredEventUrl } from '../src/event-url.js';

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
  hasBuildLoading = false,
  loadingProgress,
  isShowLoading,
  currentScene,
  isGameLoading
}) {
  if (coverText) {
    return /硬件加速/.test(coverText) ? 'dismiss-gpu-warning' : 'fatal-error';
  }
  if (hasBuildLoading) return 'waiting';
  if (!engineDetected) return 'generic';

  const loadingComplete = loadingProgress === undefined || loadingProgress === 100;
  const loadingHidden = isShowLoading === undefined || isShowLoading === false;
  const mainScene = currentScene === undefined || currentScene === 'scene_main';
  const gameReady = isGameLoading === undefined || isGameLoading === false;
  return homeVisible && loadingComplete && loadingHidden && mainScene && gameReady
    ? 'ready'
    : 'waiting';
}

export function classifyGenericPageQuality({
  visibleText = '',
  hasVisibleLoading = false,
  hasBuildLoading = false
}) {
  const normalizedText = String(visibleText || '').replace(/\s+/g, ' ').trim();
  if (
    /auth\s*key.*解析失败|您没有登录|当前暂未登录|请选择登录方式|分享链接有误|活动已下线|资源加载失败/i.test(
      normalizedText
    )
  ) {
    return 'fatal-error';
  }
  if (hasBuildLoading || hasVisibleLoading || /(?:正在)?加载中|loading\.{0,3}|请稍候/i.test(normalizedText)) {
    return 'waiting';
  }
  return 'ready';
}

export function isScreenshotBufferUsable(buffer) {
  return Boolean(buffer && buffer.length >= 10_000);
}

export function screenshotNavigationUrl(rawUrl) {
  return normalizeStoredEventUrl(rawUrl);
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
    const buildLoading = document.getElementById('build-loading-mask');
    const vue = window.player?.vue;
    const aniStore = vue?.$parent?.aniStore || vue?.aniStore || window.aniStore;

    return {
      engineDetected: Boolean(vue || home),
      homeVisible: isVisible(home),
      coverText: isVisible(cover) ? String(cover.textContent || '').trim() : '',
      hasBuildLoading: isVisible(buildLoading) || typeof window.__removeBuildLoading === 'function',
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
      hasVisibleLoading,
      hasBuildLoading:
        isVisible(document.getElementById('build-loading-mask')) ||
        typeof window.__removeBuildLoading === 'function'
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

export function buildFallbackScreenshotHtml(event) {
  const themes = {
    ys: {
      background: '#102b45',
      panel: '#174d69',
      accent: '#f0bd53',
      accent2: '#75d4e6',
      monogram: '原'
    },
    sr: {
      background: '#17183f',
      panel: '#39285f',
      accent: '#c6a6ff',
      accent2: '#f6a75b',
      monogram: '轨'
    },
    zzz: {
      background: '#17191d',
      panel: '#393b2d',
      accent: '#ffd84a',
      accent2: '#8ce6d1',
      monogram: 'Z'
    },
    bh3: {
      background: '#102b43',
      panel: '#16536b',
      accent: '#69dbff',
      accent2: '#ff8ab9',
      monogram: '崩'
    }
  };
  const theme = themes[event.gameKey] || {
    background: '#20263a',
    panel: '#38415f',
    accent: '#9ca9ff',
    accent2: '#77e2d0',
    monogram: '档'
  };
  const time = event.startDate && event.endDate
    ? `${event.startDate} — ${event.endDate}`
    : `公告日期 ${event.date || '未识别'}`;
  const titleLength = Array.from(String(event.title || '')).length;
  const titleSize = titleLength > 34 ? 43 : titleLength > 24 ? 49 : titleLength > 15 ? 56 : 66;
  return `<!doctype html>
    <html lang="zh-CN"><head><meta charset="utf-8"><style>
      *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}
      body{font-family:"Microsoft YaHei","Noto Sans CJK SC",Arial,sans-serif;color:#fff;background:${theme.background}}
      .cover{position:relative;width:100%;height:100%;overflow:hidden;
        background:
          radial-gradient(circle at 82% 20%,${theme.accent}55 0,transparent 24%),
          radial-gradient(circle at 72% 88%,${theme.accent2}44 0,transparent 25%),
          linear-gradient(118deg,${theme.background} 0%,${theme.panel} 58%,#090b13 100%)}
      .cover:before{content:"";position:absolute;inset:-35%;opacity:.32;transform:rotate(-14deg);
        background:repeating-linear-gradient(90deg,transparent 0 72px,${theme.accent}33 73px 75px)}
      .cover:after{content:"";position:absolute;inset:22px;border:2px solid ${theme.accent}77;
        clip-path:polygon(0 0,100% 0,100% 72%,92% 100%,0 100%);pointer-events:none}
      .slice{position:absolute;right:-120px;top:-145px;width:590px;height:810px;transform:rotate(22deg);
        border:46px solid ${theme.accent}36;border-left-color:${theme.accent2}66;border-radius:48%}
      .slice.two{right:40px;top:105px;width:310px;height:430px;border-width:18px;opacity:.72}
      .dots{position:absolute;right:54px;bottom:46px;width:230px;height:92px;opacity:.55;
        background-image:radial-gradient(${theme.accent} 2.4px,transparent 2.4px);background-size:18px 18px}
      .monogram{position:absolute;right:60px;top:86px;font-family:Impact,"Arial Black",sans-serif;
        font-size:286px;line-height:1;color:${theme.accent};opacity:.16;transform:rotate(-7deg);
        -webkit-text-stroke:3px #fff;text-shadow:0 0 55px ${theme.accent}}
      .serial{position:absolute;right:58px;top:46px;font:700 17px/1 Arial,sans-serif;letter-spacing:.22em;
        color:${theme.accent};text-transform:uppercase}
      .content{position:absolute;left:70px;right:260px;top:118px;bottom:58px;display:flex;flex-direction:column}
      .game{display:flex;align-items:center;gap:13px;font-size:25px;color:${theme.accent};font-weight:800;letter-spacing:.13em}
      .game:before{content:"";width:58px;height:8px;background:${theme.accent};box-shadow:18px 0 ${theme.accent2};transform:skewX(-22deg)}
      h1{font-size:${titleSize}px;line-height:1.08;margin:24px 0 22px;max-width:720px;text-wrap:balance;
        text-shadow:0 5px 24px #050712cc;font-weight:900;letter-spacing:-.025em}
      .rule{width:170px;height:5px;margin-bottom:20px;background:linear-gradient(90deg,${theme.accent},${theme.accent2},transparent)}
      .meta{margin-top:auto;font-size:21px;color:#f3f5ff;display:flex;gap:12px;flex-wrap:wrap}
      .tag{padding:7px 14px;border:1px solid ${theme.accent}99;border-radius:6px;background:#090b13aa;
        box-shadow:inset 0 0 18px ${theme.accent}14}
      .archive{position:absolute;left:70px;bottom:25px;font:700 14px/1 Arial,sans-serif;letter-spacing:.2em;
        color:#dce2f0aa;text-transform:uppercase}
    </style></head><body><div class="cover">
      <div class="slice"></div><div class="slice two"></div><div class="dots"></div>
      <div class="monogram">${escapeHtml(theme.monogram)}</div>
      <div class="serial">${escapeHtml(event.gameKey || 'event')} / archive</div>
      <div class="content"><div class="game">${escapeHtml(event.game || event.gameKey)}</div>
        <h1>${escapeHtml(event.title)}</h1><div class="rule"></div><div class="meta">
          <span class="tag">${escapeHtml(event.version || '待确认')}</span>
          <span class="tag">${escapeHtml(event.type || '网页活动')}</span>
          <span class="tag">${escapeHtml(time)}</span>
        </div></div>
      <div class="archive">HoYo Event Archive · Curated Cover</div>
    </div></body></html>`;
}

async function renderFallbackScreenshot(page, event, outputPath) {
  await page.setContent(buildFallbackScreenshotHtml(event), { waitUntil: 'domcontentloaded' });
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
