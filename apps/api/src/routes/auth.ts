import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { loginRequestSchema, signupRequestSchema } from '@gsplat/shared';
import { requireAuth, createToken, isMasterRole, type AuthRequest } from '../middleware/auth.js';
import { permissionsFromMembership } from './admin/permissions.js';
import type { PrismaClient, User } from '@prisma/client';

async function serializeUser(prisma: PrismaClient, user: User) {
  const memberships = await prisma.organizationMembership.findMany({
    where: { userId: user.id, status: 'ACTIVE' },
    include: {
      organization: {
        select: { id: true, slug: true, name: true },
      },
    },
    orderBy: [{ role: 'asc' }, { updatedAt: 'desc' }],
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    memberships: memberships.map((m) => ({
      id: m.id,
      organizationId: m.organizationId,
      organizationSlug: m.organization.slug,
      organizationName: m.organization.name,
      role: m.role,
      status: m.status,
      permissions: permissionsFromMembership(m),
    })),
    capabilities: {
      isMasterAdmin: isMasterRole(user.role),
      canAccessAdmin: isMasterRole(user.role) || memberships.length > 0,
    },
  };
}

export async function authRoutes(app: FastifyInstance) {
  const prisma: PrismaClient = (app as any).prisma;

  app.post('/signup', async (request, reply) => {
    const data = signupRequestSchema.parse(request.body);
    const email = data.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(409).send({
        error: { code: 'CONFLICT', message: 'An account with this email already exists' },
      });
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = await prisma.user.create({
      data: {
        email,
        name: data.name,
        passwordHash,
        role: 'CLIENT',
      },
    });

    const token = createToken({
      id: user.id,
      email: user.email,
      name: user.name,
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
      user: await serializeUser(prisma, user),
    };
  });

  app.post('/login', async (request, reply) => {
    const { email, password } = loginRequestSchema.parse(request.body);

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
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
      name: user.name,
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
      user: await serializeUser(prisma, user),
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
    });
    return { user: user ? await serializeUser(prisma, user) : null };
  });
}
