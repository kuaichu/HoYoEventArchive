import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { normalizeStoredEventUrl } from '../src/event-url.js';

test('stored event URLs remove ordinary-browser presentation and tracking parameters', () => {
  assert.equal(
    normalizeStoredEventUrl(
      'https://act.mihoyo.com/ys/event/e20260715ugc-4svbyl/index.html?game_biz=hk4e_cn&mhy_presentation_style=fullscreen&mhy_auth_required=true&mhy_landscape=true&mhy_hide_status_bar=true&utm_source=bbs&utm_medium=mys&utm_campaign=arti'
    ),
    'https://act.mihoyo.com/ys/event/e20260715ugc-4svbyl/index.html'
  );
  assert.equal(
    normalizeStoredEventUrl(
      'https://y.qq.com/forest/dWx0qP3Z130jnshg/index.html?&channelid=2005001153&ADTAG=nr_clnr_yx187'
    ),
    'https://y.qq.com/forest/dWx0qP3Z130jnshg/index.html'
  );
  assert.equal(
    normalizeStoredEventUrl(
      'https://m.kugou.com/ssr/musicip/ip?ssr_header_param=48&ssr_url_param=790663&isHideTitleBar=1&ip_id=113857'
    ),
    'https://m.kugou.com/ssr/musicip/ip?ip_id=113857'
  );
});

test('stored event URLs preserve parameters that identify shared event shells', () => {
  assert.equal(
    normalizeStoredEventUrl(
      'https://webstatic.mihoyo.com/bbs/event/bbs-event-ccl/index.html?bbs_presentation_style=fullscreen&bbs_auth_required=true&id=e123&game_biz=hk4e&utm_source=bbs'
    ),
    'https://webstatic.mihoyo.com/bbs/event/bbs-event-ccl/index.html?id=e123&game_biz=hk4e'
  );
  assert.equal(
    normalizeStoredEventUrl(
      'https://webstatic.mihoyo.com/bbs/event/live/index.html?act_id=ea123&mhy_presentation_style=fullscreen&game_biz=hk4e&utm_medium=mys'
    ),
    'https://webstatic.mihoyo.com/bbs/event/live/index.html?act_id=ea123'
  );
  assert.equal(
    normalizeStoredEventUrl(
      'https://webstatic.mihoyo.com/ys/event/e20210601blue_post/vert.html?page_sn=abc&bbs_presentation_style=fullscreen'
    ),
    'https://webstatic.mihoyo.com/ys/event/e20210601blue_post/vert.html?page_sn=abc'
  );
});

test('stored event URLs preserve language, unknown parameters, and SPA routes', () => {
  assert.equal(
    normalizeStoredEventUrl('https://hsr.hoyoverse.com/guidetopenacony?lang=zh-cn'),
    'https://hsr.hoyoverse.com/guidetopenacony?lang=zh-cn'
  );
  assert.equal(
    normalizeStoredEventUrl('https://example.com/event?future_switch=enabled&utm_source=bbs'),
    'https://example.com/event?future_switch=enabled'
  );
  assert.equal(
    normalizeStoredEventUrl(
      'https://act.mihoyo.com/bbs/event/doujin-collect/index.html?id=ea123&act_id=ea123&game_biz=hkrpg&mhy_presentation_style=fullscreen#/rpg/act?&utm_source=bbs&utm_medium=mys'
    ),
    'https://act.mihoyo.com/bbs/event/doujin-collect/index.html?id=ea123&act_id=ea123#/rpg/act'
  );
  assert.equal(
    normalizeStoredEventUrl(
      'https://act.mihoyo.com/app/mihoyo-zzz-game-record/m.html?mhy_presentation_style=fullscreen#/zzz/roles/0/detail&mhy_bg_style=dark&utm_source=media'
    ),
    'https://act.mihoyo.com/app/mihoyo-zzz-game-record/m.html#/zzz/roles/0/detail'
  );
});

test('stored event URL normalization is safe and idempotent', () => {
  const normalized = 'https://webstatic.mihoyo.com/event/index.html';
  assert.equal(normalizeStoredEventUrl(`${normalized}?`), normalized);
  assert.equal(normalizeStoredEventUrl(normalized), normalized);
  assert.equal(
    normalizeStoredEventUrl('https://webstatic.mihoyo.com/event/index.html?id=abc'),
    'https://webstatic.mihoyo.com/event/index.html?id=abc'
  );
  assert.equal(normalizeStoredEventUrl('javascript:alert(1)'), null);
  assert.equal(normalizeStoredEventUrl('https://user:pass@example.com/event'), null);
});

test('the event collection stores only normalized navigation URLs', () => {
  const events = JSON.parse(
    fs.readFileSync(new URL('../src/events.json', import.meta.url), 'utf8')
  );
  for (const event of events) {
    assert.equal(
      normalizeStoredEventUrl(event.url),
      event.url,
      `${event.id} should store its normalized event URL`
    );
  }
});
