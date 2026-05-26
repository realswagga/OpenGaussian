# Diploma Project Execution Plan

> **Status: In Progress** — M0-M3 complete, M4-M6 substantial, M7-M9 near complete.
> Last updated: 2026-05-25

## Project title

**Web-hosted Gaussian Splat Viewer Platform**

A Dockerized web platform for uploading, converting, streaming, viewing, annotating, and embedding Gaussian Splat scenes. The platform supports a full public viewer, a lightweight embeddable widget, an admin backend, adaptive LOD streaming, WebGPU where supported, and VR/WebXR support.

---

## 1. Product goal

Build a locally deployable, open-source, lightweight but powerful Gaussian Splat platform with these parts:

1. **Public web application**
   - Shows a list of available Gaussian Splat scenes.
   - Opens a dedicated full-page viewer.
   - Lets users fly/orbit/walk around scenes.
   - Displays interactive 3D information markers.
   - Supports quality presets, mobile performance mode, WebGPU, and VR.

2. **Embeddable web widget**
   - Loads one predetermined scene chosen by developers/admins.
   - Can be embedded into external pages.
   - Has minimal UI.
   - Supports marker interaction, optional VR, and locked navigation modes.

3. **Backend API**
   - Manages scene metadata, annotations, users, versions, and processing jobs.
   - Returns manifests and asset URLs.
   - Does not stream heavy splat binaries directly through the API.

4. **Static asset streaming layer**
   - Serves converted splat assets, LOD chunks, manifests, posters, and previews.
   - Uses HTTP range/chunk-friendly delivery.
   - Uses immutable cache headers for versioned assets.

5. **Admin interface**
   - Lets admins upload pretrained `.ply`, `.spz`, `.sog`, `.compressed.ply`, or other accepted formats.
   - Converts uploaded splats into production-ready optimized format.
   - Generates LOD data and preview images.
   - Lets admins add/edit/delete 3D markers with information.
   - Lets admins publish/unpublish scenes.

6. **Worker pipeline**
   - Runs conversion, validation, LOD generation, preview generation, metadata extraction, and cleanup jobs.

7. **Dockerized local deployment**
   - Every service must run locally in Docker containers using Docker Compose.
   - Local development must not require cloud-only services.
   - Local storage must use MinIO or an equivalent S3-compatible container.

---

## 2. Core technical decision

Use **PlayCanvas Engine + SuperSplat Viewer concepts/tooling** as the foundation for rendering and viewing Gaussian Splats.

Rationale:

- Open-source ecosystem.
- Existing Gaussian Splat rendering support.
- WebGPU support where available.
- WebXR/VR support path.
- Existing SuperSplat-compatible formats and viewer architecture.
- Static viewer deployment model fits CDN/object-storage streaming.
- Avoids building a Gaussian Splat renderer from scratch.

The project should wrap this ecosystem in a custom application architecture rather than depending on a hosted third-party platform.

---

## 3. Main technology stack

### Frontend

- **TypeScript** everywhere.
- **React** for public app and admin app.
- **Vite** recommended for simplicity and fast builds.
- **PlayCanvas Engine** inside `viewer-core`.
- **Web Component** for the embeddable widget.
- **Tailwind CSS** or a minimal CSS system for UI.
- **Framer Motion** optional for subtle fade/slide animations.

### Backend

- **Node.js + TypeScript**.
- **Fastify** preferred for lightweight API server.
- **Prisma** ORM.
- **PostgreSQL** for metadata.
- **Redis + BullMQ** for background jobs.
- **MinIO** for local S3-compatible object storage.
- **Nginx or Caddy** for reverse proxy and static asset serving.

### Processing

- Worker container based on Node.js.
- CLI tools/scripts for:
  - input validation,
  - conversion to production splat format,
  - LOD generation,
  - preview/poster generation,
  - metadata extraction.

### Deployment

- Docker Compose for local development and demo.
- Optional production path:
  - PostgreSQL managed DB,
  - Redis managed service,
  - S3 or Cloudflare R2,
  - CDN in front of splat assets,
  - API and frontend containers deployed to VPS/cloud.

Local Docker deployment remains mandatory.

---

## 4. Repository structure

```txt
repo-root/
  apps/
    public-web/
      src/
      Dockerfile
      package.json
    admin-web/
      src/
      Dockerfile
      package.json
    api/
      src/
      prisma/
      Dockerfile
      package.json
    worker/
      src/
      Dockerfile
      package.json

  packages/
    viewer-core/
      src/
      package.json
    viewer-widget/
      src/
      package.json
    shared/
      src/
      package.json
    ui/
      src/
      package.json

  infra/
    nginx/
      nginx.conf
    minio/
      README.md
    postgres/
      init.sql

  docker-compose.yml
  docker-compose.dev.yml
  .env.example
  package.json
  pnpm-workspace.yaml
  README.md
  plan.md
  rules.md
```

---

## 5. Application architecture

```txt
Browser
  │
  ├── Public Web App
  │     ├── scene list
  │     ├── full viewer
  │     └── marker info panels
  │
  ├── Widget
  │     └── predetermined scene viewer
  │
  └── Admin Web App
        ├── upload scenes
        ├── edit metadata
        ├── edit markers
        └── publish scenes

Nginx/Caddy
  │
  ├── routes / to public-web
  ├── routes /admin to admin-web
  ├── routes /api to api
  └── routes /assets to MinIO/static object proxy

API Server
  │
  ├── PostgreSQL for metadata
  ├── Redis for jobs
  └── MinIO for object storage

Worker
  │
  ├── consumes Redis jobs
  ├── reads original uploads from MinIO
  ├── writes converted assets to MinIO
  └── updates PostgreSQL processing status
```

---

## 6. Local Docker-first deployment requirements

The complete project must start locally with:

```bash
cp .env.example .env
docker compose up --build
```

The local deployment must expose:

```txt
http://localhost:8080              public app
http://localhost:8080/admin        admin app
http://localhost:8080/api/health   API health check
http://localhost:9001              MinIO console
localhost:5432                     PostgreSQL
localhost:6379                     Redis
```

No feature required for the diploma demo may depend on paid cloud services.

---

## 7. Docker Compose target layout

```yaml
services:
  nginx:
    image: nginx:alpine
    depends_on:
      - public-web
      - admin-web
      - api
      - minio
    ports:
      - "8080:80"
    volumes:
      - ./infra/nginx/nginx.conf:/etc/nginx/nginx.conf:ro

  public-web:
    build:
      context: .
      dockerfile: apps/public-web/Dockerfile
    environment:
      - VITE_API_BASE_URL=/api
      - VITE_ASSET_BASE_URL=/assets

  admin-web:
    build:
      context: .
      dockerfile: apps/admin-web/Dockerfile
    environment:
      - VITE_API_BASE_URL=/api

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/gsplat
      - REDIS_URL=redis://redis:6379
      - S3_ENDPOINT=http://minio:9000
      - S3_ACCESS_KEY=minioadmin
      - S3_SECRET_KEY=minioadmin
      - S3_BUCKET=gsplat-assets
      - JWT_SECRET=local-dev-secret-change-me
    depends_on:
      - postgres
      - redis
      - minio

  worker:
    build:
      context: .
      dockerfile: apps/worker/Dockerfile
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/gsplat
      - REDIS_URL=redis://redis:6379
      - S3_ENDPOINT=http://minio:9000
      - S3_ACCESS_KEY=minioadmin
      - S3_SECRET_KEY=minioadmin
      - S3_BUCKET=gsplat-assets
    depends_on:
      - api
      - postgres
      - redis
      - minio

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=gsplat
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
    volumes:
      - postgres-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      - MINIO_ROOT_USER=minioadmin
      - MINIO_ROOT_PASSWORD=minioadmin
    volumes:
      - minio-data:/data
    ports:
      - "9000:9000"
      - "9001:9001"

volumes:
  postgres-data:
  minio-data:
```

This is a target shape. The final implementation may adjust details, but the same local services must exist.

---

## 8. Environment variables

`.env.example` must include:

```bash
NODE_ENV=development
APP_PUBLIC_URL=http://localhost:8080
API_PUBLIC_URL=http://localhost:8080/api
ASSET_PUBLIC_URL=http://localhost:8080/assets

DATABASE_URL=postgresql://postgres:postgres@postgres:5432/gsplat
REDIS_URL=redis://redis:6379

S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=http://localhost:8080/assets
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=gsplat-assets
S3_FORCE_PATH_STYLE=true

JWT_SECRET=local-dev-secret-change-me
ADMIN_SEED_EMAIL=admin@example.com
ADMIN_SEED_PASSWORD=admin12345

MAX_UPLOAD_MB=2048
DEFAULT_LOD_BUDGET=1500000
DEFAULT_MOBILE_LOD_BUDGET=500000
DEFAULT_VR_LOD_BUDGET=700000
```

---

## 9. Database schema

Use PostgreSQL with Prisma.

### User

```prisma
model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  role         UserRole @default(VIEWER)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

enum UserRole {
  ADMIN
  EDITOR
  VIEWER
}
```

### Splat

```prisma
model Splat {
  id                  String      @id @default(uuid())
  slug                String      @unique
  title               String
  description         String?
  status              SplatStatus @default(DRAFT)

  sourceFormat        String?
  sourceObjectKey     String?
  productionFormat    String?
  productionObjectKey String?
  lodManifestKey      String?
  posterKey           String?
  collisionKey        String?

  splatCount          Int?
  sizeBytes           BigInt?
  boundingBoxJson     Json?
  defaultCameraJson   Json?
  globalSettingsJson  Json?

  versions            SplatVersion[]
  annotations         Annotation[]

  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  publishedAt         DateTime?
}

enum SplatStatus {
  DRAFT
  PROCESSING
  READY
  PUBLISHED
  FAILED
  ARCHIVED
}
```

### SplatVersion

```prisma
model SplatVersion {
  id               String          @id @default(uuid())
  splatId          String
  splat            Splat           @relation(fields: [splatId], references: [id], onDelete: Cascade)
  version          Int

  sourceKey        String
  convertedKey     String?
  lodKey           String?
  posterKey        String?

  processingStatus ProcessingStatus @default(PENDING)
  processingLog    String?
  metricsJson      Json?

  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

enum ProcessingStatus {
  PENDING
  RUNNING
  READY
  FAILED
}
```

### Annotation

```prisma
model Annotation {
  id                  String   @id @default(uuid())
  splatId             String
  splat               Splat    @relation(fields: [splatId], references: [id], onDelete: Cascade)

  title               String
  body                String?
  kind                String   @default("info")

  positionX           Float
  positionY           Float
  positionZ           Float
  rotationX           Float   @default(0)
  rotationY           Float   @default(0)
  rotationZ           Float   @default(0)
  scale               Float   @default(1)

  icon                String?
  color               String?
  visibilityRulesJson Json?
  mediaJson           Json?

  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}
```

### ViewerPreset

```prisma
model ViewerPreset {
  id                 String @id @default(uuid())
  splatId            String
  name               String

  cameraMode         String @default("orbit")
  lodBudget          Int    @default(1500000)
  mobileLodBudget    Int    @default(500000)
  vrLodBudget        Int    @default(700000)

  enableVr           Boolean @default(true)
  enableWebGpu       Boolean @default(true)
  enableMarkers      Boolean @default(true)
  lockScene          Boolean @default(false)
  allowFly           Boolean @default(true)
  allowOrbit         Boolean @default(true)

  settingsJson       Json?

  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}
```

---

## 10. Object storage layout

Use versioned immutable paths.

```txt
gsplat-assets/
  splats/
    {splatId}/
      originals/
        {version}/source.ply
        {version}/source.spz
      versions/
        {version}/
          scene.sog
          scene.compressed.ply
          scene.lod-meta.json
          scene.meta.json
          poster.webp
          preview-small.webp
          chunks/
            chunk-000.bin
            chunk-001.bin
            ...
      admin-temp/
        ...
```

Rules:

- Original uploads are never overwritten.
- Published assets are immutable.
- New upload creates a new version.
- Public URLs should reference versioned asset paths.
- API can mark the current published version in the database.

---

## 11. API design

### Health

```http
GET /api/health
```

Response:

```json
{
  "ok": true,
  "service": "gsplat-api",
  "time": "2026-05-25T00:00:00.000Z"
}
```

### Public splat list

```http
GET /api/splats
```

Returns only published splats.

```json
{
  "items": [
    {
      "id": "...",
      "slug": "modern-apartment",
      "title": "Modern Apartment",
      "description": "Interior scan",
      "posterUrl": "/assets/splats/.../poster.webp",
      "splatCount": 1800000,
      "publishedAt": "..."
    }
  ]
}
```

### Public splat detail

```http
GET /api/splats/:slug
```

Returns metadata, default camera, settings, and annotation summary.

### Viewer manifest

```http
GET /api/splats/:slug/manifest
```

Response:

```json
{
  "id": "...",
  "slug": "modern-apartment",
  "title": "Modern Apartment",
  "assets": {
    "format": "sog",
    "sceneUrl": "/assets/splats/{id}/versions/3/scene.sog",
    "lodManifestUrl": "/assets/splats/{id}/versions/3/scene.lod-meta.json",
    "metaUrl": "/assets/splats/{id}/versions/3/scene.meta.json",
    "posterUrl": "/assets/splats/{id}/versions/3/poster.webp"
  },
  "viewer": {
    "defaultCamera": {},
    "enableVr": true,
    "enableWebGpu": true,
    "quality": "auto",
    "budgets": {
      "desktop": 1500000,
      "mobile": 500000,
      "vr": 700000
    }
  }
}
```

### Annotations

```http
GET /api/splats/:slug/annotations
```

Response:

```json
{
  "items": [
    {
      "id": "...",
      "title": "Living room",
      "body": "Bright living room with large windows.",
      "kind": "info",
      "position": [1.2, 0.8, -2.1],
      "rotation": [0, 0, 0],
      "scale": 1,
      "icon": "dot",
      "color": "#ffffff"
    }
  ]
}
```

### Widget config

```http
GET /api/widget/:slug/config
```

Response:

```json
{
  "scene": {
    "slug": "modern-apartment",
    "manifestUrl": "/api/splats/modern-apartment/manifest",
    "annotationsUrl": "/api/splats/modern-apartment/annotations"
  },
  "widget": {
    "locked": true,
    "showMarkers": true,
    "showUi": false,
    "enableVr": true,
    "quality": "auto"
  }
}
```

### Admin auth

```http
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

Use secure HTTP-only cookies or bearer tokens. For local demo, bearer JWT is acceptable. Prefer HTTP-only cookie for production-like flow.

### Admin splat management

```http
GET    /api/admin/splats
POST   /api/admin/splats
GET    /api/admin/splats/:id
PATCH  /api/admin/splats/:id
DELETE /api/admin/splats/:id
```

### Admin upload

```http
POST /api/admin/splats/:id/upload
```

Accept multipart upload.

Rules:

- Validate extension and MIME type.
- Enforce `MAX_UPLOAD_MB`.
- Store original file immediately in MinIO.
- Create `SplatVersion` with `PENDING` status.
- Return version ID and job ID.

### Admin processing

```http
POST /api/admin/splats/:id/process
GET  /api/admin/jobs/:jobId
GET  /api/admin/jobs/:jobId/events
```

Use Server-Sent Events for progress updates.

### Admin annotations

```http
POST   /api/admin/splats/:id/annotations
PATCH  /api/admin/annotations/:id
DELETE /api/admin/annotations/:id
```

### Publish flow

```http
POST /api/admin/splats/:id/publish
POST /api/admin/splats/:id/unpublish
```

Publishing should only be allowed when the current version is `READY`.

---

## 12. Worker processing pipeline

### Job types

```txt
splat.validate
splat.convert
splat.generateLod
splat.generatePreview
splat.extractMetadata
splat.publishPrepare
splat.cleanup
```

### Upload processing sequence

```txt
1. Admin uploads source file.
2. API stores original in MinIO.
3. API creates SplatVersion row.
4. API enqueues processing job.
5. Worker downloads source file to container temp directory.
6. Worker validates file.
7. Worker extracts metadata:
   - format,
   - file size,
   - approximate splat count,
   - bounding box,
   - coordinate scale.
8. Worker converts source to production format.
9. Worker generates LOD manifest and chunks where possible.
10. Worker generates preview/poster image.
11. Worker uploads generated assets to MinIO.
12. Worker updates SplatVersion as READY or FAILED.
13. Admin reviews the result.
14. Admin publishes.
```

### Failure handling

- Every failed job must store a readable error message.
- Failed versions must not be public.
- Temporary files must be cleaned even after failure.
- Worker logs must include job ID and splat ID.

### Processing implementation note

Start with the smallest reliable implementation:

1. Accept `.sog` and load directly.
2. Accept `.ply` and store original.
3. Add conversion to optimized format.
4. Add LOD generation.
5. Add poster generation.

Do not block the first working demo on a perfect conversion pipeline.

---

## 13. Viewer-core package

`packages/viewer-core` owns all 3D scene logic.

### Responsibilities

- Create and destroy PlayCanvas application.
- Load Gaussian Splat asset from manifest.
- Configure renderer mode.
- Configure LOD budget.
- Configure camera controls.
- Render markers.
- Handle marker picking.
- Enter/exit VR mode.
- Emit viewer events to React/widget shells.

### Public API

```ts
export type RendererMode = "auto" | "webgl2" | "webgpu";
export type CameraMode = "orbit" | "fly" | "walk" | "locked";
export type QualityPreset = "auto" | "low" | "medium" | "high" | "ultra";

export interface ViewerManifest {
  id: string;
  slug: string;
  title: string;
  assets: {
    format: "sog" | "ply" | "compressed-ply" | "spz";
    sceneUrl: string;
    lodManifestUrl?: string;
    metaUrl?: string;
    posterUrl?: string;
  };
  viewer: {
    defaultCamera?: unknown;
    enableVr: boolean;
    enableWebGpu: boolean;
    quality: QualityPreset;
    budgets: {
      desktop: number;
      mobile: number;
      vr: number;
    };
  };
}

export interface AnnotationPoint {
  id: string;
  title: string;
  body?: string;
  kind: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  icon?: string;
  color?: string;
}

export interface ViewerOptions {
  canvas: HTMLCanvasElement;
  manifest: ViewerManifest;
  annotations?: AnnotationPoint[];
  rendererMode?: RendererMode;
  cameraMode?: CameraMode;
  quality?: QualityPreset;
  locked?: boolean;
  showMarkers?: boolean;
  onMarkerSelect?: (marker: AnnotationPoint) => void;
  onReady?: () => void;
  onError?: (error: Error) => void;
  onStats?: (stats: ViewerStats) => void;
}

export interface ViewerStats {
  fps: number;
  rendererMode: "webgl2" | "webgpu";
  quality: QualityPreset;
  splatBudget: number;
  approximateLoadedSplats?: number;
}

export class GsplatViewer {
  constructor(options: ViewerOptions);
  start(): Promise<void>;
  destroy(): void;
  setQuality(quality: QualityPreset): void;
  setCameraMode(mode: CameraMode): void;
  setAnnotations(points: AnnotationPoint[]): void;
  enterVr(): Promise<void>;
  exitVr(): Promise<void>;
}
```

---

## 14. Renderer mode strategy

Implement renderer selection conservatively.

```ts
function chooseRendererMode(input: {
  requested: "auto" | "webgl2" | "webgpu";
  isVrRequested: boolean;
  webgpuSupported: boolean;
}): "webgl2" | "webgpu" {
  if (input.isVrRequested) {
    return "webgl2";
  }

  if (input.requested === "webgpu" && input.webgpuSupported) {
    return "webgpu";
  }

  if (input.requested === "auto" && input.webgpuSupported) {
    return "webgpu";
  }

  return "webgl2";
}
```

Rules:

- WebGPU support is important but must not be required.
- VR support is important and should use the most stable renderer path.
- Always provide WebGL2 fallback.
- Show a UI hint when WebGPU is not available.

---

## 15. Quality and LOD strategy

### Quality profiles

```ts
export const qualityProfiles = {
  phoneLow: {
    splatBudget: 400_000,
    maxDevicePixelRatio: 1,
    enablePostFx: false,
    markerDistanceLimit: 20,
  },
  phoneHigh: {
    splatBudget: 800_000,
    maxDevicePixelRatio: 1.25,
    enablePostFx: false,
    markerDistanceLimit: 30,
  },
  desktopMedium: {
    splatBudget: 1_500_000,
    maxDevicePixelRatio: 1.5,
    enablePostFx: true,
    markerDistanceLimit: 60,
  },
  desktopHigh: {
    splatBudget: 3_000_000,
    maxDevicePixelRatio: 2,
    enablePostFx: true,
    markerDistanceLimit: 100,
  },
  vrQuest: {
    splatBudget: 700_000,
    maxDevicePixelRatio: 1,
    enablePostFx: false,
    markerDistanceLimit: 40,
  },
};
```

### Auto quality detection

Detect:

- mobile user agent,
- viewport size,
- device pixel ratio,
- `navigator.deviceMemory` when available,
- `navigator.hardwareConcurrency` when available,
- initial FPS after warmup.

Flow:

```txt
1. Start conservative.
2. Measure FPS over several seconds.
3. Increase budget if FPS is stable.
4. Decrease budget if FPS drops.
5. Persist decision in localStorage.
6. Allow user override.
```

---

## 16. Public web application

### Routes

```txt
/                  landing or redirect to /splats
/splats            list published splats
/splats/:slug      full-page viewer
/embed/:slug       optional preview of widget mode
```

### Splat list page

Features:

- Minimal black background.
- Search input.
- Cards/list with poster, title, short description, size/splat count.
- Status badges:
  - VR supported,
  - WebGPU supported by browser,
  - Mobile friendly.

### Full viewer page

UI elements:

- Full-screen canvas.
- Top-left title and back button.
- Bottom-left controls:
  - Orbit/Fly/Walk mode,
  - Quality selector,
  - WebGPU indicator,
  - VR button.
- Right-side annotation panel on desktop.
- Bottom sheet annotation panel on mobile.
- Optional FPS/debug overlay in development/admin mode.

### Loading behavior

- Show poster image first.
- Fade in scene after first frame is ready.
- Show progress indicator if available.
- Animate splat appearance subtly.
- Never block page shell while heavy asset loads.

---

## 17. Embeddable widget

### Build output

`packages/viewer-widget` must build to:

```txt
dist/gs-viewer.js
dist/gs-viewer.css
```

### Embed snippet

```html
<script src="http://localhost:8080/widget/gs-viewer.js"></script>

<gs-viewer
  scene="modern-apartment"
  height="520"
  quality="auto"
  show-markers="true"
  vr="true"
  locked="true">
</gs-viewer>
```

### Attributes

```txt
scene             required scene slug
height            optional CSS height, default 480px
quality           auto | low | medium | high | ultra
show-markers      true | false
vr                true | false
locked            true | false
ui                minimal | hidden | full
```

### Widget rules

- Widget must not include the public scene list.
- Widget must not expose admin-only data.
- Widget must only load published scenes.
- Widget should work without React on the host page.
- Widget must cleanly destroy viewer resources when removed from DOM.
- Widget must use Shadow DOM if practical to avoid CSS conflicts.

---

## 18. Admin web application

### Routes

```txt
/admin/login
/admin
/admin/splats
/admin/splats/new
/admin/splats/:id
/admin/splats/:id/upload
/admin/splats/:id/annotations
/admin/splats/:id/preview
/admin/jobs/:id
```

### Admin dashboard

Show:

- Total splats.
- Published splats.
- Processing jobs.
- Failed jobs.
- Storage usage estimate.

### Splat table

Columns:

- poster,
- title,
- slug,
- status,
- format,
- size,
- splat count,
- updated date,
- actions.

### Upload page

Flow:

1. Create or select splat.
2. Upload file.
3. Show upload progress.
4. Enqueue processing.
5. Show job progress/log.
6. Preview result.
7. Publish.

### Annotation editor

Features:

- Full viewer scene.
- Add marker button.
- Click surface/reticle to place marker.
- Select marker in scene or side list.
- Edit title/body/type/icon/color.
- Drag marker position.
- Save changes.
- Preview public behavior.

Implementation shortcut:

- If true scene raycast is difficult against splats, implement placement by camera reticle and depth estimate first.
- Later add optional proxy collision mesh.

---

## 19. Marker system

### Rendering

Markers should be:

- billboards facing the camera,
- constant screen size,
- distance faded,
- optionally occlusion-aware,
- clickable/tappable,
- selectable in VR using controller ray.

### Marker states

```txt
idle
hovered
selected
panel-open
hidden-by-distance
```

### Marker info panel

Desktop:

- Right-side panel.

Mobile:

- Bottom sheet.

VR:

- World-space floating panel near marker or attached to controller ray target.

### Real estate marker examples

```txt
Room name
Area
Material
Appliance details
Price notes
Maintenance info
Gallery link
Contact CTA
```

---

## 20. VR/WebXR implementation

VR is a first-class requirement.

### Requirements

- Add VR button when WebXR immersive VR is available.
- Fall back gracefully if VR is unavailable.
- Support headset orientation and controller ray selection.
- Use simplified UI in VR.
- Use lower LOD budget in VR by default.
- Prefer stable WebGL2 renderer for VR unless WebGPU+WebXR is verified on the target browser/device.

### VR acceptance criteria

- On a compatible headset/browser, pressing VR enters immersive session.
- User can look around the splat scene.
- User can select visible markers.
- User can exit VR.
- Frame rate remains acceptable using VR quality budget.

---

## 21. UI and visual design rules

### Visual direction

Ultra-minimalistic, function-first, black/gray/white interface inspired by modern AI tools and Apple-like smoothness.

### Colors

```css
:root {
  --bg: #050505;
  --bg-elevated: #0d0d0d;
  --panel: #111111;
  --panel-soft: #171717;
  --border: #2a2a2a;
  --text: #f5f5f5;
  --text-muted: #a3a3a3;
  --text-dim: #737373;
  --focus: #ffffff;
  --danger: #ef4444;
  --success: #22c55e;
}
```

### Design rules

- Predominantly black background.
- Subtle gray grid/floor where helpful.
- White text.
- Minimal borders.
- No colorful dashboards unless status requires it.
- Use fades, soft slides, and subtle scale animations.
- Avoid decorative clutter.
- Viewer canvas is always the hero.
- Admin UI prioritizes function over decoration.

### Motion

- Page transition: fade 120-200ms.
- Panel open: fade + small translate 160-240ms.
- Marker appear: opacity + scale.
- Splat appear: fade or progressive reveal.
- Respect `prefers-reduced-motion`.

---

## 22. Security requirements

### Authentication

- Admin routes require login.
- API admin routes require admin/editor role.
- Public routes only expose published splats.

### Upload security

- Validate file extension.
- Validate file size.
- Store uploads outside public path until processed.
- Never execute uploaded files.
- Do not trust metadata from uploaded file.
- Sanitize annotation body before rendering.

### Object storage security

- Original uploads are private.
- Published converted assets may be public.
- Asset paths must be versioned and unguessable enough for local demo.
- In production, use signed URLs or CDN rules if needed.

### API security

- Use request validation schemas.
- Rate-limit auth and upload endpoints.
- Use CORS only where necessary.
- Do not leak stack traces in production.

---

## 23. Performance requirements

### Frontend

- Avoid loading admin code in public app.
- Avoid loading public app shell in widget.
- Lazy-load viewer engine only on viewer routes.
- Dispose PlayCanvas resources on route changes.
- Use compressed, optimized splat format for public delivery.
- Use LOD and budget controls.

### Backend

- Do not stream heavy splat files through the API server.
- Serve splat assets through Nginx/MinIO/static layer.
- Use immutable cache headers for versioned assets.
- API returns JSON metadata only.
- Worker handles CPU-heavy tasks asynchronously.

### Static asset headers

For versioned public assets:

```http
Cache-Control: public, max-age=31536000, immutable
Accept-Ranges: bytes
ETag: enabled
```

For API responses:

```http
Cache-Control: no-store
```

or short cache for public lists if desired.

---

## 24. Testing strategy

### Unit tests

Use Vitest for:

- shared schema validation,
- API service functions,
- permission checks,
- renderer mode selection,
- quality profile selection,
- manifest parsing.

### Integration tests

Test with Docker services:

- API health.
- Auth login.
- Create splat.
- Upload mock file.
- Enqueue job.
- Worker updates job status.
- Public list only shows published splats.
- Annotation CRUD.

### E2E tests

Use Playwright:

- Public list loads.
- Viewer page opens.
- Marker panel opens.
- Admin login works.
- Admin creates splat metadata.
- Admin adds annotation.
- Widget loads in test HTML page.

### Manual demo tests

- Desktop Chrome.
- Desktop Firefox or Safari if available.
- Mobile browser.
- VR headset/browser if available.
- Low-end quality mode.

---

## 25. Development milestones

### Milestone 0 — Repository and Docker foundation

Deliverables:

- Monorepo created.
- Docker Compose created.
- Public app, admin app, API, worker containers build.
- PostgreSQL, Redis, MinIO run locally.
- `/api/health` works.
- Nginx routes work.

Acceptance:

```bash
docker compose up --build
curl http://localhost:8080/api/health
```

returns success.

---

### Milestone 1 — Minimal viewer proof

Deliverables:

- `viewer-core` package.
- Public viewer route.
- Load one static demo splat from assets.
- Orbit/fly camera.
- Basic marker JSON.
- Marker click opens panel.
- Quality selector stub.

Acceptance:

- Scene opens in browser.
- User can navigate.
- User can click marker and see info.

---

### Milestone 2 — Public API and database

Deliverables:

- Prisma schema.
- Seed admin user.
- Seed demo splat.
- Public splat list API.
- Public manifest API.
- Public annotations API.
- Public app reads from API instead of static JSON.

Acceptance:

- `/splats` shows DB-backed scene list.
- `/splats/:slug` loads scene using manifest from API.

---

### Milestone 3 — Admin authentication and splat CRUD

Deliverables:

- Login page.
- JWT/session auth.
- Admin splat table.
- Create/edit/delete splat metadata.
- Publish/unpublish state.

Acceptance:

- Public users see only published splats.
- Admin can manage draft splats.

---

### Milestone 4 — Upload and worker pipeline

Deliverables:

- Multipart upload endpoint.
- Store original in MinIO.
- Create version row.
- Enqueue BullMQ job.
- Worker validates file and marks status.
- Add conversion step if tooling is ready.
- Add generated asset upload.

Acceptance:

- Admin uploads a splat.
- Job status changes from pending to running to ready/failed.
- Ready version can be previewed.

---

### Milestone 5 — LOD and adaptive quality

Deliverables:

- LOD manifest support in viewer manifest.
- Quality profiles.
- Device auto-detection.
- FPS-based budget adjustment.
- Mobile profile.
- VR profile.

Acceptance:

- Desktop can use higher budget.
- Mobile uses lower budget automatically.
- User can manually override quality.

---

### Milestone 6 — Annotation editor

Deliverables:

- Admin annotation list.
- Add/edit/delete annotation API.
- Admin scene editor.
- Place marker in 3D.
- Save marker position and content.
- Preview public marker behavior.

Acceptance:

- Admin places real-estate style information points.
- Public viewer displays those points.

---

### Milestone 7 — WebGPU and VR

Deliverables:

- WebGPU detection.
- WebGPU renderer path where available.
- WebGL2 fallback.
- VR button.
- VR session start/exit.
- VR marker selection.

Acceptance:

- Browser with WebGPU can use WebGPU mode.
- Browser without WebGPU still works.
- Compatible headset can enter VR.

---

### Milestone 8 — Widget

Deliverables:

- `viewer-widget` package.
- Web Component build.
- `<gs-viewer>` embed API.
- Widget config endpoint.
- Demo embed page.

Acceptance:

- External static HTML file can embed a scene using one script and one custom element.

---

### Milestone 9 — Polish and diploma demo

Deliverables:

- Minimal black/gray/white UI polish.
- Smooth fades and loading transitions.
- Poster loading.
- Error states.
- README with local Docker instructions.
- Demo dataset.
- Screenshots/video optional.

Acceptance:

- Clean local demo from fresh clone.
- Admin can upload/manage scene.
- Public can view scene.
- Widget can embed scene.
- Docker deployment works.

---

## 26. Definition of done

The diploma project is complete when:

1. `docker compose up --build` starts all local services.
2. Public app lists published Gaussian Splat scenes.
3. Full viewer loads a scene and supports navigation.
4. Markers appear in 3D and show additional information.
5. Admin can log in.
6. Admin can upload a splat source file.
7. Worker processes uploaded file or clearly reports failure.
8. Admin can add/edit/delete 3D markers.
9. Admin can publish/unpublish scenes.
10. Widget can embed a predetermined scene.
11. LOD/quality settings exist and affect viewer behavior.
12. WebGPU support exists where browser/device supports it.
13. VR support exists where browser/device supports WebXR immersive VR.
14. README explains local Docker deployment.
15. No required demo feature depends on external paid services.

---

## 27. Agent execution order

Coding agents should implement in this order:

```txt
1. Create monorepo workspace.
2. Add Docker Compose skeleton.
3. Add API health endpoint.
4. Add public/admin placeholder apps.
5. Add database schema and migrations.
6. Add MinIO bucket initialization.
7. Add public splat list/manifest APIs.
8. Add viewer-core minimal static scene load.
9. Connect viewer to API manifest.
10. Add annotations API and marker display.
11. Add admin auth.
12. Add admin splat CRUD.
13. Add upload endpoint.
14. Add worker job queue.
15. Add processing pipeline steps.
16. Add LOD/quality profiles.
17. Add WebGPU detection/toggle.
18. Add VR button/session flow.
19. Add admin annotation editor.
20. Add widget package.
21. Add tests.
22. Polish UI and README.
```

Agents must not skip Docker integration. Every milestone should be runnable locally through Docker Compose.

---

## 28. Non-goals

Do NOT do these unless all core requirements are complete or explicitly ruled by user:

- Build a custom Gaussian Splat renderer from scratch.
- Create a complex CMS.
- Add payments.
- Add multi-tenant organizations.
- Add realtime multi-user collaboration.
- Add analytics dashboards.
- Add cloud-only deployment.
- Store binary splat data in PostgreSQL.
- Require CUDA/GPU processing for the normal local demo.

---

## 29. Known risks and mitigations

### Risk: WebGPU + VR compatibility

Mitigation:

- Use WebGL2 fallback.
- Prefer WebGL2 for VR until verified.
- Keep WebGPU as optional enhancement.

### Risk: Splat conversion tooling instability

Mitigation:

- Accept already optimized `.sog` or compatible files first.
- Keep original upload.
- Make processing pipeline modular.
- Allow manual replacement of generated asset during development if needed.

### Risk: Heavy files in local development

Mitigation:

- Use small demo scenes.
- Use MinIO volume.
- Use upload size config.
- Add cleanup command.

### Risk: Raycasting against splats

Mitigation:

- Start with camera-reticle placement.
- Add optional proxy mesh or manual coordinate editing.
- Later implement more accurate depth picking.

### Risk: Low-end phone performance

Mitigation:

- Start with conservative mobile budget.
- Cap device pixel ratio.
- Disable post-processing.
- Add manual low-quality override.

---

## 30. README requirements

The final README must include:

```txt
Project overview
Architecture diagram
Prerequisites
Local Docker setup
Default admin credentials
How to upload a splat
How to publish a splat
How to add markers
How to embed widget
Supported file formats
VR/WebGPU notes
Troubleshooting
Known limitations
```

Minimum local setup docs:

```bash
git clone <repo>
cd <repo>
cp .env.example .env
docker compose up --build
```

Then open:

```txt
Public app: http://localhost:8080
Admin app:  http://localhost:8080/admin
MinIO:      http://localhost:9001
```

