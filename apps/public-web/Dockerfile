FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY packages/viewer-core/package.json packages/viewer-core/tsconfig.json ./packages/viewer-core/
COPY packages/viewer-widget/package.json packages/viewer-widget/tsconfig.json ./packages/viewer-widget/
COPY apps/public-web/package.json apps/public-web/tsconfig.json ./apps/public-web/

RUN pnpm install --frozen-lockfile

COPY packages/shared/src ./packages/shared/src
COPY packages/viewer-core/src ./packages/viewer-core/src
COPY packages/viewer-widget/src ./packages/viewer-widget/src
COPY packages/viewer-widget/vite.config.ts ./packages/viewer-widget/
COPY tokens.css ./tokens.css
COPY apps/public-web/src ./apps/public-web/src
COPY apps/public-web/index.html apps/public-web/vite.config.ts ./apps/public-web/

RUN pnpm run --filter @gsplat/shared build
RUN pnpm run --filter @gsplat/viewer-core build
RUN pnpm run --filter @gsplat/viewer-widget build
RUN pnpm run --filter @gsplat/public-web build

FROM nginx:alpine AS runner

COPY --from=builder /app/apps/public-web/dist /usr/share/nginx/html

# Copy widget JS into the public web root so /widget/gs-viewer.js resolves
RUN mkdir -p /usr/share/nginx/html/widget
COPY --from=builder /app/packages/viewer-widget/dist/gs-viewer.js /usr/share/nginx/html/widget/

# Copy widget demo page
COPY apps/public-web/widget-demo.html /usr/share/nginx/html/widget/demo.html

COPY apps/public-web/nginx-default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
