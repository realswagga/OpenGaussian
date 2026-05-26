import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export function errorHandler(
  error: FastifyError | ZodError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.errors,
      },
    });
  }

  const fastifyError = error as FastifyError;

  if (fastifyError.statusCode === 429) {
    return reply.status(429).send({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests',
      },
    });
  }

  if (fastifyError.statusCode === 401 || fastifyError.statusCode === 403) {
    return reply.code(fastifyError.statusCode).send({
      error: {
        code: 'UNAUTHORIZED',
        message: fastifyError.message || 'Unauthorized',
      },
    });
  }

  request.log.error(error);

  return reply.status(fastifyError.statusCode || 500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    },
  });
}