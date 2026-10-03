import { promises as fs } from 'node:fs';
import path from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';

export const DEFAULT_COVER_DIR = fileURLToPath(new URL('../public/images/covers/', import.meta.url));
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const OFFICIAL_HOSTS = ['mihoyo.com', 'miyoushe.com', 'hoyoverse.com', 'hoyolab.com', 'hoyolab.cn'];

function responseSizeError() {
  const error = new Error('Response exceeds size limit');
  error.code = 'COVER_RESPONSE_TOO_LARGE';
  return error;
}

function isPrivateAddress(address) {
  const host = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127)
      || (a === 198 && (b === 18 || b === 19));
  }
  if (isIP(host) === 6) {
    // Permit global unicast IPv6 only; mapped IPv4 and local ranges are excluded.
    return !/^[23][0-9a-f]{3}:/.test(host);
  }
  return false;
}

export function normalizeCoverSourceUrl(value, baseUrl) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = baseUrl ? new URL(value.trim(), baseUrl) : new URL(value.trim());
    const host = url.hostname.toLowerCase();
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
      || !host || host === 'localhost' || host.endsWith('.localhost')
      || host.endsWith('.local') || !host.includes('.') && !isIP(host.replace(/^\[|\]$/g, ''))
      || isPrivateAddress(host)) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function imageUrl(value) {
  return normalizeCoverSourceUrl(typeof value === 'string' ? value : value?.url ?? value?.image_url);
}

function isOfficialUrl(value) {
  const host = new URL(value).hostname;
  return OFFICIAL_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`));
}

export function extractPostCoverUrl(item) {
  const post = item?.post ?? item ?? {};
  for (const candidate of [post.cover, item?.cover, post.images?.[0]]) {
    const url = imageUrl(candidate);
    if (url) return url;
  }
  let content = post.structured_content ?? item?.structured_content;
  try { if (typeof content === 'string') content = JSON.parse(content); } catch { return null; }
  const operations = Array.isArray(content) ? content : content?.ops;
  if (!Array.isArray(operations)) return null;
  const images = operations.map(operation => imageUrl(operation?.insert?.image)).filter(Boolean);
  return images.find(isOfficialUrl) ?? images[0] ?? null;
}

function decodeEntities(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const name = entity.slice(1, -1).toLowerCase();
    const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
    if (named[name]) return named[name];
    const code = name.startsWith('#x') ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

export function extractShareCoverUrl(html, pageUrl) {
  if (typeof html !== 'string') return null;
  const candidates = [];
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = {};
    for (const match of tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4]);
    }
    const name = (attrs.property ?? attrs.name ?? '').toLowerCase();
    if (['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'].includes(name)) {
      const url = normalizeCoverSourceUrl(attrs.content, pageUrl);
      if (url) {
        const filename = new URL(url).pathname.split('/').at(-1);
        if (!/\.ico$/i.test(filename) && !/^favicon(?:[._-]|$)/i.test(filename)) candidates.push({ url, name });
      }
    }
  }
  return candidates.find(candidate => candidate.name.startsWith('og:'))?.url ?? candidates[0]?.url ?? null;
}

export function detectImageExtension(bytes) {
  if (bytes.length < 20) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.toString('ascii', 12, 16) === 'IHDR'
    && bytes.subarray(-8, -4).toString('ascii') === 'IEND') return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) return 'jpg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    && bytes.readUInt32LE(4) + 8 === bytes.length
    && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))) return 'webp';
  return null;
}

export async function hasValidLocalCover(event, options = {}) {
  const match = /^\/images\/covers\/([A-Za-z0-9_-]+)\.(png|jpg|webp)$/.exec(event?.coverUrl ?? '');
  if (!match) return false;
  try {
    const file = path.join(options.outputDir ?? DEFAULT_COVER_DIR, `${match[1]}.${match[2]}`);
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > (options.maxBytes ?? MAX_IMAGE_BYTES)) return false;
    return detectImageExtension(await fs.readFile(file)) === match[2];
  } catch { return false; }
}

// Manual redirects validate every destination before requesting it. DNS checks also
// reject public-looking hostnames that resolve to local/private addresses.
export async function readPublicResource(sourceUrl, options = {}) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 15000;
  const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  const work = async () => {
    let currentUrl = normalizeCoverSourceUrl(sourceUrl);
    if (!currentUrl) throw new Error('Unsafe or invalid source URL');
    for (let redirect = 0; redirect <= 4; redirect++) {
      const host = new URL(currentUrl).hostname.replace(/^\[|\]$/g, '');
      const addresses = isIP(host) ? [{ address: host }] : await (options.lookupImpl ?? lookup)(host, { all: true });
      if (!addresses.length || addresses.some(entry => isPrivateAddress(entry.address))) {
        throw new Error('Source resolves to a private network address');
      }
      const response = await (options.fetchImpl ?? fetch)(currentUrl, {
        redirect: 'manual', signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 HoYoEventArchive/1.0', Referer: 'https://www.miyoushe.com/' }
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const next = normalizeCoverSourceUrl(response.headers.get('location'), currentUrl);
        if (!next) throw new Error('Unsafe redirect URL');
        currentUrl = next;
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declaredLength = Number(response.headers.get('content-length'));
      if (declaredLength > maxBytes) { await response.body?.cancel(); throw responseSizeError(); }
      const chunks = [];
      let length = 0;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > maxBytes) { await reader.cancel(); throw responseSizeError(); }
            chunks.push(Buffer.from(value));
          }
        } finally { reader.releaseLock(); }
      } else {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > maxBytes) throw responseSizeError();
        chunks.push(bytes);
        length = bytes.length;
      }
      return { body: Buffer.concat(chunks, length), contentType: response.headers.get('content-type') ?? '', url: currentUrl };
    }
    throw new Error('Too many redirects');
  };
  try { return await Promise.race([work(), timeout]); } finally { clearTimeout(timer); controller.abort(); }
}

export async function archiveEventCover(event, sourceUrl, options = {}) {
  const source = normalizeCoverSourceUrl(sourceUrl);
  if (!source) throw new Error('Unsafe or invalid cover URL');
  if (!/^[A-Za-z0-9_-]+$/.test(String(event.id))) throw new Error('Invalid event id');
  if (!options.force && event.coverSourceUrl === source && await hasValidLocalCover(event, options)) return { ...event };
  let resource;
  try { resource = await readPublicResource(source, options); }
  catch (error) {
    if (error.code !== 'COVER_RESPONSE_TOO_LARGE' || new URL(source).hostname !== 'upload-bbs.miyoushe.com') throw error;
    // Official OSS can supply a smaller proportional JPEG for oversized artwork.
    // Keep the original URL as provenance and apply the same download size limit.
    const thumbnail = new URL(source);
    thumbnail.searchParams.set('x-oss-process', 'image/resize,w_1600/quality,q_85/format,jpg');
    if (thumbnail.href === source) throw error;
    resource = await readPublicResource(thumbnail.href, options);
  }
  const { body, contentType } = resource;
  const extension = detectImageExtension(body);
  const allowedType = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[extension];
  if (!extension || contentType.split(';')[0].trim().toLowerCase() !== allowedType) {
    throw new Error('Response is not a valid PNG, JPEG or WebP image');
  }
  const outputDir = options.outputDir ?? DEFAULT_COVER_DIR;
  await fs.mkdir(outputDir, { recursive: true });
  const target = path.join(outputDir, `${event.id}.${extension}`);
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, body, { flag: 'wx' });
    await fs.rename(temporary, target);
  } finally { await fs.rm(temporary, { force: true }); }
  return { ...event, coverUrl: `/images/covers/${event.id}.${extension}`, coverSourceUrl: source };
}
