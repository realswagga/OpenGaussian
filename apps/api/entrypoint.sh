#!/bin/sh
set -e

echo "[entrypoint] Waiting for PostgreSQL..."

# Retry prisma db push until PostgreSQL is available
until npx prisma db push --schema=apps/api/prisma/schema.prisma --skip-generate 2>/dev/null; do
  echo "[entrypoint] PostgreSQL not ready yet, retrying in 2s..."
  sleep 2
done

echo "[entrypoint] Prisma schema pushed. Generating Prisma client..."
npx prisma generate --schema=apps/api/prisma/schema.prisma

echo "[entrypoint] Seeding database..."
npx tsx apps/api/prisma/seed.ts

echo "[entrypoint] Starting API server..."
exec node apps/api/dist/server.js