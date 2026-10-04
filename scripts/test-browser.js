import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { formatEventTimeRange } from '../src/event-time.js';

const options = { baseUrl: 'http://127.0.0.1:5174', timeoutMs: 60000 };
for (const argument of process.argv.slice(2)) {
  if (argument.startsWith('--url=')) options.baseUrl = argument.slice(6);
  else if (argument.startsWith('--chrome=')) options.chrome = argument.slice(9);
  else if (argument.startsWith('--screenshots=')) options.screenshots = path.resolve(argument.slice(14));
  else throw new Error(`Unknown option: ${argument}`);
}
const target = new URL(options.baseUrl);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) throw new Error('Browser checks require a local test server');
const events = JSON.parse(await fs.readFile(fileURLToPath(new URL('../src/events.json', import.meta.url)), 'utf8'));
const byId = new Map(events.map(event => [event.id, event]));
const retiredIds = new Set(['sr-34', 'sr-35', 'sr-36', 'sr-37', 'zzz-10']);
const visibleCount = events.filter(event => !retiredIds.has(event.id)).length;
const errors = [];
const checks = [];
let browser;
let page;
const watchdog = setTimeout(() => {
  console.error('Browser interaction deadline exceeded');
  browser?.process()?.kill();
  process.exitCode = 1;
}, options.timeoutMs);

async function check(label, work) {
  await work();
  checks.push(label);
  console.log(`PASS ${label}`);
}

try {
  browser = await puppeteer.launch({ headless: true, timeout: 15000,
    executablePath: options.chrome || process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--disable-extensions', '--disable-background-networking', '--no-first-run'] });
  page = await browser.newPage();
  page.setDefaultTimeout(7000);
  page.setDefaultNavigationTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.isInterceptResolutionHandled()) return;
    const url = request.url();
    if (url.startsWith(`${target.origin}/`) || /^(?:data:|blob:|about:)/.test(url)) request.continue();
    else request.abort();
  });
  const visit = async route => {
    await page.goto(new URL(route, target).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#eventsContainer')?.children.length > 0
      || document.querySelector('#detailModal.active'));
  };
  const waitPath = pathname => page.waitForFunction(expected => location.pathname === expected, {}, pathname);
  const text = selector => page.$eval(selector, element => element.textContent.trim());
  const open = async id => {
    await page.waitForFunction(() => innerWidth > 1024
      || document.querySelector('.sidebar-panel').getBoundingClientRect().right <= 0.5);
    await page.click(`#eventsContainer > [data-id="${id}"] a[data-route-link]`);
    await waitPath(`/events/${id}`);
    await page.waitForSelector('#detailModal.active');
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#detailModal')).opacity) >= 0.99);
  };
  const close = async () => {
    await page.click('#modalCloseBtn');
    await page.waitForFunction(() => !document.querySelector('#detailModal.active'));
  };
  const assertDetail = async id => {
    const event = byId.get(id);
    assert.equal(await text('#modalTitle'), event.title);
    assert.equal(await text('#modalTimeRange'), formatEventTimeRange(event));
    assert.equal(await text('#modalVersion'), event.version);
    const stages = await page.$$eval('#modalTimeStages p', rows => rows.map(row => row.textContent.trim()));
    assert.deepEqual(stages, (event.timeStages ?? []).map(stage => `${stage.name}：${formatEventTimeRange(stage)}`));
  };
  const assertBounds = async selector => {
    const result = await page.$$eval(selector, elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { id: element.id || element.className, left: rect.left, right: rect.right, width: rect.width, viewport: innerWidth };
    }).filter(rect => rect.width > 0 && (rect.left < -1 || rect.right > rect.viewport + 1)));
    assert.deepEqual(result, [], `Clipped elements: ${JSON.stringify(result)}`);
  };
  const withClock = async (value, work) => {
    const script = await page.evaluateOnNewDocument(milliseconds => {
      // Temporal checks simulate an available campaign even after the archive's
      // stored status has been marked ended by a later daily synchronization.
      localStorage.setItem('hoyo_archive_custom_events', JSON.stringify({ version: 2,
        overrides: { 'ys-58': { status: '可访问' }, 'sr-58': { status: '可访问' } }, additions: [], deletedIds: [] }));
      const RealDate = Date;
      globalThis.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [milliseconds])); }
        static now() { return milliseconds; }
      };
    }, Date.parse(value));
    try { await work(); } finally {
      await page.removeScriptToEvaluateOnNewDocument(script.identifier);
      await page.evaluate(() => localStorage.removeItem('hoyo_archive_custom_events'));
    }
  };

  await page.setViewport({ width: 1366, height: 900 });
  await check('desktop archive loads without runtime errors', async () => {
    await visit('/events');
    assert.equal(await page.$$eval('#eventsContainer > [data-id]', elements => elements.length), visibleCount);
  });
  await check('card details display exact participation times and both campaign stages', async () => {
    await open('ys-58');
    await assertDetail('ys-58');
    await assertBounds('#modalTimeRange, #modalTimeStages, #modalTimeStages p');
    if (options.screenshots) {
      await fs.mkdir(options.screenshots, { recursive: true });
      await page.screenshot({ path: path.join(options.screenshots, 'desktop-time-details.png') });
    }
    await close();
    await waitPath('/events');
  });
  await check('list details distinguish submission cutoff from the overall activity period', async () => {
    await page.click('#viewList');
    await page.waitForFunction(() => new URLSearchParams(location.search).get('layout') === 'list');
    await open('ys-51');
    await assertDetail('ys-51');
    assert.notEqual(byId.get('ys-51').endAt, byId.get('ys-51').timeStages[0].endAt);
    await close();
    assert.equal(new URL(page.url()).searchParams.get('layout'), 'list');
  });
  await check('game and version filters update the URL and visible activity set', async () => {
    await page.click('#gameFilters button[data-value="ys"]');
    await page.waitForFunction(() => !document.querySelector('#versionFilter').disabled);
    await page.select('#versionFilter', 'v7.1');
    await page.waitForFunction(() => new URLSearchParams(location.search).get('version') === 'v7.1');
    const ids = await page.$$eval('#eventsContainer > [data-id]', nodes => nodes.map(node => node.dataset.id));
    assert.ok(ids.length > 0);
    assert.ok(ids.every(id => byId.get(id).gameKey === 'ys' && byId.get(id).version === 'v7.1'));
  });
  await check('upcoming filter and clear filters retain valid navigation', async () => {
    await page.click('#statusFilters button[data-value="未开始"]');
    await page.waitForFunction(() => new URLSearchParams(location.search).get('status') === 'upcoming');
    await page.click('#clearFiltersBtn');
    await page.waitForFunction(() => !new URLSearchParams(location.search).has('status'));
    assert.equal(await page.$$eval('#eventsContainer > [data-id]', nodes => nodes.length), visibleCount);
  });
  await check('favorites persist after reload and can be removed through the detail dialog', async () => {
    await open('ys-58');
    await page.click('#modalFavoriteBtn');
    await close();
    await page.click('a.control-tab[href="/favorites"]');
    await waitPath('/favorites');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#eventsContainer > [data-id="ys-58"]');
    assert.equal(await page.$$eval('#eventsContainer > [data-id]', nodes => nodes.length), 1);
    await open('ys-58');
    await page.click('#modalFavoriteBtn');
    await close();
    assert.equal(await page.$$eval('#eventsContainer > [data-id]', nodes => nodes.length), 0);
  });
  await check('home search opens a result and Escape restores the searched route', async () => {
    await page.click('a.nav-item[href="/"]');
    await waitPath('/');
    await page.type('#heroSearchInput', '绮星盛会');
    await page.click('#heroSearchBtn');
    await page.waitForFunction(() => new URLSearchParams(location.search).get('q') === '绮星盛会');
    await open('ys-58');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#detailModal.active'));
    assert.equal(new URL(page.url()).searchParams.get('q'), '绮星盛会');
  });
  await check('deep-link reload retains a day-only start and a precise deadline', async () => {
    await visit('/events/sr-58');
    await assertDetail('sr-58');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#detailModal.active');
    await assertDetail('sr-58');
  });
  await check('missing activities clear times and stages from the previous detail', async () => {
    await visit('/events/unknown-browser-check');
    assert.equal(await text('#modalTimeRange'), '—');
    assert.equal(await page.$$eval('#modalTimeStages p', nodes => nodes.length), 0);
  });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await check('mobile menu navigates to the archive and closes', async () => {
    await visit('/');
    await page.click('#mobileNavToggle');
    await page.waitForFunction(() => document.querySelector('.header-bar nav').classList.contains('open'));
    await page.click('.header-bar nav a[href="/events"]');
    await waitPath('/events');
    assert.equal(await page.$eval('.header-bar nav', element => element.classList.contains('open')), false);
  });
  await check('mobile filter drawer closes after selecting an upcoming status', async () => {
    await page.click('#mobileFilterBtn');
    await page.waitForFunction(() => {
      const panel = document.querySelector('.sidebar-panel');
      return panel.classList.contains('open') && panel.getBoundingClientRect().left >= -0.5;
    });
    await page.click('#statusFilters button[data-value="未开始"]');
    await page.waitForFunction(() => !document.querySelector('.sidebar-panel').classList.contains('open'));
    assert.equal(new URL(page.url()).searchParams.get('status'), 'upcoming');
    await visit('/events');
  });
  await check('mobile participation times and stages stay within the viewport', async () => {
    await open('ys-58');
    await assertDetail('ys-58');
    await assertBounds('#modalTimeRange, #modalTimeStages, #modalTimeStages p');
    if (options.screenshots) await page.screenshot({ path: path.join(options.screenshots, 'mobile-time-details.png') });
    await close();
  });
  await check('a future clock produces an actual upcoming activity and a working status filter', async () => {
    await withClock('2026-09-20T12:00:00+08:00', async () => {
      await visit('/events');
      await page.click('#mobileFilterBtn');
      await page.waitForFunction(() => document.querySelector('.sidebar-panel').getBoundingClientRect().left >= -0.5);
      await page.click('#statusFilters button[data-value="未开始"]');
      await open('ys-58');
      assert.equal(await text('#modalStatusBadge'), '未开始');
      await assertDetail('ys-58');
    });
  });
  await check('a second-precision deadline ends the activity at its stated instant', async () => {
    await withClock(byId.get('ys-58').endAt, async () => {
      await visit('/events/ys-58');
      assert.equal(await text('#modalStatusBadge'), '已结束');
    });
  });
  await check('a minute-precision deadline retains that minute and ends at the next minute', async () => {
    const end = Date.parse(byId.get('sr-58').endAt);
    for (const [offset, expected] of [[30000, '可访问'], [60000, '已结束']]) {
      await withClock(new Date(end + offset).toISOString(), async () => {
        await visit('/events/sr-58');
        assert.equal(await text('#modalStatusBadge'), expected);
      });
    }
  });
  await check('no uncaught browser JavaScript errors', async () => assert.deepEqual(errors, []));
  console.log(`Browser checks passed: ${checks.length}; desktop 1366px, mobile 390px.`);
} catch (error) {
  console.error(error.stack || error.message);
  if (page && !page.isClosed()) {
    try {
      console.error(JSON.stringify(await page.evaluate(() => ({ viewport: innerWidth, path: location.pathname,
        navigation: document.querySelector('.header-bar nav')?.className,
        sidebar: document.querySelector('.sidebar-panel')?.className,
        menuIcon: document.querySelector('#mobileNavToggle i')?.className,
        modal: document.querySelector('#detailModal')?.className }))));
      if (options.screenshots) await page.screenshot({ path: path.join(options.screenshots, 'failure.png') });
    } catch { /* Browser may already have reached its deadline. */ }
  }
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  if (browser) {
    const browserProcess = browser.process();
    const cleanupDeadline = setTimeout(() => browserProcess?.kill(), 5000);
    try { await browser.close(); } finally { clearTimeout(cleanupDeadline); }
  }
}
