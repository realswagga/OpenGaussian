FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY packages/ui/package.json packages/ui/tsconfig.json ./packages/ui/
COPY packages/viewer-core/package.json packages/viewer-core/tsconfig.json ./packages/viewer-core/
COPY apps/admin-web/package.json apps/admin-web/tsconfig.json ./apps/admin-web/

RUN pnpm install --no-frozen-lockfile

COPY packages/shared/src ./packages/shared/src
COPY packages/ui/src ./packages/ui/src
COPY packages/viewer-core/src ./packages/viewer-core/src
COPY apps/admin-web/src ./apps/admin-web/src
COPY apps/admin-web/index.html apps/admin-web/vite.config.ts ./apps/admin-web/

RUN pnpm run --filter @gsplat/shared build
RUN pnpm run --filter @gsplat/ui build
RUN pnpm run --filter @gsplat/viewer-core build
RUN pnpm run --filter @gsplat/admin-web build

FROM nginx:alpine AS runner

COPY --from=builder /app/apps/admin-web/dist /usr/share/nginx/html/admin

COPY apps/admin-web/nginx-default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
