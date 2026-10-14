import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual, createHmac } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { users } from './store.js';

const isCompiledProductionBundle = path.basename(fileURLToPath(import.meta.url)).startsWith('server.js');
const isNpmStart = process.env.npm_lifecycle_event === 'start';
const isExplicitProd = process.env.NODE_ENV === 'production';
const isTestEnv = process.env.NODE_ENV === 'test';
export const IS_PRODUCTION = (isExplicitProd || isNpmStart || isCompiledProductionBundle) && !isTestEnv;

export const JWT_SECRET: string = (() => {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  if (IS_PRODUCTION) {
    throw new Error('JWT_SECRET environment variable (min 32 characters) is required in production.');
  }
  return 'dev-only-insecure-jwt-secret-do-not-use-in-production';
})();

export function signToken(payload: { id: string; role: string; email: string; sessionVersion?: number }, expiresInMs = 7 * 24 * 3600 * 1000): string {
  const data = JSON.stringify({ ...payload, exp: Date.now() + expiresInMs });
  const base64Data = Buffer.from(data).toString('base64url');
  const signature = createHmac('sha256', JWT_SECRET).update(base64Data).digest('base64url');
  return `${base64Data}.${signature}`;
}

export function verifyToken(token: string): { id: string; role: string; email: string; sessionVersion?: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [base64Data, signature] = parts;
    const expectedSig = createHmac('sha256', JWT_SECRET).update(base64Data).digest('base64url');
    
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(base64Data, 'base64url').toString('utf-8'));
    if (payload.exp && payload.exp < Date.now()) {
      return null;
    }

    const dbUser = users.find(u => u.id === payload.id);
    if (dbUser) {
      if (payload.sessionVersion !== undefined) {
        if (!dbUser.sessionVersion || dbUser.sessionVersion < payload.sessionVersion) {
          dbUser.sessionVersion = payload.sessionVersion;
        } else if (dbUser.sessionVersion && payload.sessionVersion !== dbUser.sessionVersion) {
          return null; // Session invalidated by password reset or explicit logout
        }
      }
    }

    return payload;
  } catch {
    return null;
  }
}

// Global Authentication Middleware: verifies cryptographic signed JWT/session and populates req.user
export function verifyAuthTokenMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const payload = verifyToken(token);
    if (payload) {
      const dbUser = users.find(u => u.id === payload.id);
      if (dbUser) {
        (req as any).user = {
          id: dbUser.id,
          role: dbUser.role,
          status: dbUser.status,
          email: dbUser.email
        };
        (req as any).authenticatedUserId = dbUser.id;
        (req as any).authenticatedUser = dbUser;
        return next();
      }
    }
  }

  // Without a valid cryptographic session token, the request is strictly unauthenticated
  (req as any).user = null;
  (req as any).authenticatedUserId = null;
  (req as any).authenticatedUser = null;
  next();
}

// Resolve authenticated user identity strictly from verified session (NEVER from client-supplied IDs)
export function resolveAuthenticatedUserId(req: Request): string | null {
  const authUser = (req as any).user?.id || (req as any).authenticatedUserId;
  if (authUser && typeof authUser === 'string' && authUser.trim()) {
    return authUser.trim();
  }
  return null;
}

export const resolveUserId = resolveAuthenticatedUserId;

export function safeUser(user: any) {
  if (!user) return null;
  const { password, knownDevices, sessionVersion, ...safe } = user;
  return safe;
}

export function orderParticipantSafeUser(user: any) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    avatar: user.avatar,
    title: user.title,
    rating: user.rating,
    reviewsCount: user.reviewsCount,
    hourlyRate: user.hourlyRate,
    skills: user.skills,
    verified: user.verified,
    status: user.status
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authUserId = resolveAuthenticatedUserId(req);
  if (!authUserId) {
    return res.status(401).json({ error: 'Authentication required. Please provide a valid session token.' });
  }
  const u = users.find(user => user.id === authUserId);
  if (!u) {
    return res.status(401).json({ error: 'User account not found.' });
  }
  if (u.status !== 'active') {
    return res.status(403).json({ error: 'Forbidden: Account is suspended, restricted, or deactivated.' });
  }
  (req as any).authenticatedUserId = u.id;
  (req as any).authenticatedUser = u;
  next();
}

export function adminActor(req: Request): string {
  const authUserId = resolveAuthenticatedUserId(req);
  const u = authUserId ? users.find(user => user.id === authUserId) : null;
  if (u) return `${u.name} (${u.role || 'admin'})`;
  return 'Administrator';
}

export function requireRole(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authUserId = resolveAuthenticatedUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const u = users.find(user => user.id === authUserId);
    if (!u) {
      return res.status(401).json({ error: 'User not found.' });
    }
    if (!allowedRoles.includes(u.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient privileges.' });
    }
    (req as any).authenticatedUserId = u.id;
    (req as any).authenticatedUser = u;
    next();
  };
}

// Admin guard: strictly requires valid administrator session
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const authUserId = resolveAuthenticatedUserId(req);
  if (!authUserId) {
    return res.status(401).json({ error: 'Authentication required. Valid admin session missing.' });
  }
  const u = users.find(user => user.id === authUserId);
  if (!u || (u.role !== 'super_admin' && u.role !== 'admin')) {
    return res.status(403).json({ error: 'Forbidden: Administrator privileges required.' });
  }
  (req as any).authenticatedUserId = u.id;
  (req as any).authenticatedUser = u;
  next();
}

// Minimal in-memory rate limiter for money-moving user endpoints.
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
export function rateLimit(max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = (req as any).authenticatedUserId || req.ip;
    const now = Date.now();
    const record = rateBuckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + windowMs;
    }
    record.count++;
    rateBuckets.set(key, record);
    if (record.count > max) {
      return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }
    next();
  };
}

export interface VerificationRecord {
  code: string;
  expiresAt: number;
  lastResendAt: number;
  attempts: number;
}

export const emailVerificationCodes = new Map<string, VerificationRecord>();
export const smsVerificationCodes = new Map<string, VerificationRecord>();
export const forgotPasswordCodes = new Map<string, VerificationRecord>();
export const withdrawalVerificationCodes = new Map<string, VerificationRecord>();

export function generate6DigitCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
