import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const OWNER_PIN_COOKIE = 'owner_pin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

function sessionSecret() {
  const secret = process.env.OWNER_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('Owner session secret is not configured.');
  return secret;
}

export function hashPin(pin: string) {
  const salt = randomBytes(16);
  const derived = scryptSync(pin, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifyPin(pin: string, stored: string) {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(pin, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createSessionToken() {
  const expires = Date.now() + SESSION_TTL_MS;
  const signature = createHmac('sha256', sessionSecret()).update(String(expires)).digest('base64url');
  return `${expires}.${signature}`;
}

export function verifySessionToken(token: string | undefined | null) {
  if (!token) return false;
  const [expires, signature] = token.split('.');
  if (!expires || !signature) return false;
  const expected = createHmac('sha256', sessionSecret()).update(expires).digest('base64url');
  const actual = Buffer.from(signature);
  const required = Buffer.from(expected);
  if (actual.length !== required.length || !timingSafeEqual(actual, required)) return false;
  const expiry = Number(expires);
  return Number.isFinite(expiry) && expiry > Date.now();
}

export function isLocked(lockedUntil: string | null | undefined) {
  return Boolean(lockedUntil && new Date(lockedUntil).getTime() > Date.now());
}

export function nextLock(attempts: number) {
  return attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MS).toISOString() : null;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  };
}
