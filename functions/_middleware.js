const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function decodeBase64(value) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

const ADMIN_AUTH_CONFIG = Object.freeze({
  username: 'admin',
  salt: decodeBase64('9td0Uu8wEXvaRhcg239IEQ=='),
  verifier: decodeBase64('OF+L15008HcVTc4YWhTakFyzPXt3qcIP7TrSMmp6T2g=')
});

function parseBasicAuthorization(value) {
  if (typeof value !== 'string' || !value.startsWith('Basic ')) return null;
  try {
    const decoded = textDecoder.decode(decodeBase64(value.slice(6).trim()));
    const separator = decoded.indexOf(':');
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1)
    };
  } catch {
    return null;
  }
}

function timingSafeEqual(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array)) return false;
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function deriveCredentialVerifier(username, password, config) {
  const credentials = textEncoder.encode(`${username}:${password}`);
  const material = new Uint8Array(config.salt.length + 1 + credentials.length);
  material.set(config.salt, 0);
  material.set(credentials, config.salt.length + 1);
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', material));
}

export async function verifyBasicAuthorization(value, config = ADMIN_AUTH_CONFIG) {
  const credentials = parseBasicAuthorization(value);
  if (!credentials || credentials.username !== config.username || credentials.password.length === 0) {
    return false;
  }
  const verifier = await deriveCredentialVerifier(credentials.username, credentials.password, config);
  return timingSafeEqual(verifier, config.verifier);
}

function classifyAdminPath(pathname) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (normalized === '/admin' || normalized === '/admin.html') {
    return { canonical: true };
  }
  if (normalized.startsWith('/admin/') || normalized.startsWith('/admin.html/')) {
    return { canonical: false };
  }
  return null;
}

function unauthorizedResponse() {
  return new Response('Admin authentication required.', {
    status: 401,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'text/plain; charset=UTF-8',
      'Referrer-Policy': 'no-referrer',
      'Vary': 'Authorization',
      'WWW-Authenticate': 'Basic realm="HoYo Event Archive Admin", charset="UTF-8"',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function privateAdminResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  const vary = new Set(
    String(headers.get('Vary') || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  );
  vary.add('Authorization');
  headers.set('Vary', [...vary].join(', '));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export async function handleAdminRequest(context, config = ADMIN_AUTH_CONFIG) {
  const pathname = new URL(context.request.url).pathname;
  const adminRoute = classifyAdminPath(pathname);
  if (!adminRoute) return context.next();

  const authorized = await verifyBasicAuthorization(
    context.request.headers.get('Authorization'),
    config
  );
  if (!authorized) return unauthorizedResponse();

  if (!adminRoute.canonical) {
    return privateAdminResponse(new Response('Admin route not found.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=UTF-8' }
    }));
  }

  let nextRequest;
  if (pathname !== '/admin') {
    const canonicalUrl = new URL(context.request.url);
    canonicalUrl.pathname = '/admin';
    nextRequest = new Request(canonicalUrl, {
      method: context.request.method,
      headers: context.request.headers
    });
  }
  return privateAdminResponse(await context.next(nextRequest));
}

export function onRequest(context) {
  return handleAdminRequest(context);
}
