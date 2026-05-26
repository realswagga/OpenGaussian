import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { loginRequestSchema } from '@gsplat/shared';
import { requireAuth, createToken, type AuthRequest } from '../middleware/auth.js';
import type { PrismaClient, User } from '@prisma/client';

export async function authRoutes(app: FastifyInstance) {
  const prisma: PrismaClient = (app as any).prisma;

  app.post('/login', async (request, reply) => {
    const { email, password } = loginRequestSchema.parse(request.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' },
      });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' },
      });
    }

    const token = createToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    reply.setCookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24,
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  });

  app.post('/logout', async (_request, reply) => {
    reply.clearCookie('token', { path: '/' });
    return { ok: true };
  });

  app.get('/me', { preHandler: [requireAuth] }, async (request) => {
    const auth = request as AuthRequest;
    const user = await prisma.user.findUnique({
      where: { id: auth.user!.id },
      select: { id: true, email: true, role: true },
    });
    return { user };
  });
}