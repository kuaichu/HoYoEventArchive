const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function decodeBase64(value) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

const ADMIN_AUTH_CONFIG = Object.freeze({
  username: 'admin',
  iterations: 150_000,
  salt: decodeBase64('9td0Uu8wEXvaRhcg239IEQ=='),
  verifier: decodeBase64('ancaPmp2kBYd48NwP4R+GW0y5U2Ue5O53YQiLAWgpyg=')
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

async function derivePasswordVerifier(password, config) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: config.salt,
      iterations: config.iterations
    },
    key,
    256
  );
  return new Uint8Array(bits);
}

export async function verifyBasicAuthorization(value, config = ADMIN_AUTH_CONFIG) {
  const credentials = parseBasicAuthorization(value);
  if (!credentials || credentials.username !== config.username || credentials.password.length === 0) {
    return false;
  }
  const verifier = await derivePasswordVerifier(credentials.password, config);
  return timingSafeEqual(verifier, config.verifier);
}

function isAdminPath(pathname) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return normalized === '/admin' || normalized === '/admin.html';
}

function unauthorizedResponse() {
  return new Response('Admin authentication required.', {
    status: 401,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'text/plain; charset=UTF-8',
      'Referrer-Policy': 'no-referrer',
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
  if (!isAdminPath(pathname)) return context.next();

  const authorized = await verifyBasicAuthorization(
    context.request.headers.get('Authorization'),
    config
  );
  if (!authorized) return unauthorizedResponse();

  return privateAdminResponse(await context.next());
}

export function onRequest(context) {
  return handleAdminRequest(context);
}
