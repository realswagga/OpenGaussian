import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import type { AuthUser } from '@gsplat/shared';

const JWT_SECRET = process.env.JWT_SECRET || 'local-dev-secret-change-me';

export interface AuthRequest extends FastifyRequest {
  user?: AuthUser;
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const token = extractToken(request);
  if (!token) {
    return reply.status(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    (request as AuthRequest).user = payload;
  } catch {
    return reply.status(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' },
    });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  const user = (request as AuthRequest).user;
  if (!user || (user.role !== 'ADMIN' && user.role !== 'EDITOR')) {
    return reply.status(403).send({
      error: { code: 'FORBIDDEN', message: 'Admin or editor role required' },
    });
  }
}

export function createToken(user: AuthUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '24h' });
}

function extractToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // Also check cookies
  const cookies = request.cookies;
  if (cookies?.token) {
    return cookies.token;
  }
  return null;
}