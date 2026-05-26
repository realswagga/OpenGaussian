FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY apps/worker/package.json apps/worker/tsconfig.json ./apps/worker/
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/

RUN pnpm install --no-frozen-lockfile

COPY packages/shared/src ./packages/shared/src
COPY apps/worker/src ./apps/worker/src
COPY apps/api/prisma ./apps/api/prisma

RUN pnpm run --filter @gsplat/api generate:types
RUN pnpm run --filter @gsplat/shared build
RUN pnpm run --filter @gsplat/worker build

FROM node:20-slim AS runner

RUN apt-get update -y && apt-get install -y openssl libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy all built artifacts and node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=builder /app/apps/worker/node_modules ./apps/worker/node_modules

COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/src ./packages/shared/src
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY --from=builder /app/packages/shared/node_modules ./packages/shared/node_modules

ENV NODE_ENV=production

CMD ["node", "apps/worker/dist/index.js"]