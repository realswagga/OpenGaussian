# Gaussian Splat Viewer Platform

A Dockerized web platform for viewing, streaming, annotating, and embedding Gaussian Splat scenes. Supports WebGPU where available, WebXR/VR, adaptive LOD/quality, and a framework-independent embeddable widget.

## Architecture

```
Browser
  ├── Public Web App (React + viewer-core)   → /splats, /splats/:slug
  ├── Admin Web App (React)                   → /admin/*
  └── Widget (Web Component)                  → /widget/demo

Nginx (reverse proxy + static serving)
  ├── /        → public-web
  ├── /admin   → admin-web
  ├── /api     → api (Fastify)
  ├── /widget  → public-web (static widget JS + demo)
  └── /assets  → MinIO (S3-compatible object storage)

API Server (Fastify + Prisma)
  ├── PostgreSQL  → metadata, users, annotations, jobs
  ├── Redis       → BullMQ job queue
  └── MinIO       → splat binaries, LOD chunks, posters

Worker (BullMQ)
  ├── validates uploaded files
  ├── extracts metadata
  ├── passes through PlayCanvas-compatible production assets
  ├── accepts existing SOG metadata and LOD manifests
  └── generates PNG poster/preview images
```

## Quick Start

### Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose
- Optional: Node.js 20+ and pnpm for non-container development

### Local Deployment

```bash
git clone <repo-url>
cd <repo>

cp .env.example .env
docker compose up --build
```

Once all services are healthy, open:

| URL | Description |
|-----|-------------|
| `http://localhost:8080` | Public app (scene list + viewer) |
| `http://localhost:8080/admin` | Admin panel |
| `http://localhost:8080/api/health` | API health check |
| `http://localhost:8080/widget/demo` | Widget demo page |
| `http://localhost:9001` | MinIO console |

### Default Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@example.com` | `admin12345` |

Change these via `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD` in `.env`.

## Demo Scene

The seed script generates a **300,000-point Gaussian Splat PLY** of a modern living room with:
- Floor, walls, ceiling
- Sofa, coffee table, TV unit
- Rug, plant, floor lamp

It also creates **6 markers** (Sofa, TV Unit, Coffee Table, Dining Area, Plant Corner, Floor Lamp) with descriptions.

Visit `http://localhost:8080/splats/demo-scene` to explore.

## Upload Your Own Splat

1. Log into admin: `http://localhost:8080/admin`
2. Go to **Splats** → **New Splat**
3. Fill in title and slug, save
4. Click **Upload** on the splat row
5. Select a `.ply`, `.compressed.ply`, `.sog`, `.meta.json`, `.lod-meta.json`, or `.spz` file (max 2GB by default)
6. The worker will validate, extract metadata, pass through the production asset, and generate a PNG poster when possible
7. Once the version shows **READY**, click **Publish**
8. The scene appears on the public list

**Accepted formats**: `.ply`, `.compressed.ply`, `.sog`, `.meta.json`, `.lod-meta.json`, `.spz`

For production use, prefer SOG assets exported by SuperSplat or PlayCanvas-compatible tooling. If you need LOD streaming, upload a valid PlayCanvas `lod-meta.json` package; worker-side SOG conversion and true LOD generation are intentionally not claimed in worker v1.

## Adding Markers

### Via Admin 3D Editor
1. Go to a splat -> **3D Editor**
2. Click the point cloud to place a marker
3. Fill in title, body, kind in the right panel
4. Click **Create**
5. Click existing markers (spheres) to select and edit
6. Use the XYZ gizmo or numeric inputs for precise positioning

### Via API
```bash
curl -X POST http://localhost:8080/api/admin/splats/{id}/markers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"title":"Window","body":"Large window with city view","kind":"info","positionX":2.5,"positionY":1.0,"positionZ":-3.0}'
```

## Embedding the Widget

```html
<script src="http://localhost:8080/widget/gs-viewer.js"></script>

<gs-viewer
  scene="demo-scene"
  height="520"
  quality="auto"
  show-markers="true"
  vr="true"
  locked="false"
  ui="full">
</gs-viewer>
```

### Widget Attributes

| Attribute | Values | Default | Description |
|-----------|--------|---------|-------------|
| `scene` | slug | *required* | Scene to display |
| `height` | CSS value | `480px` | Widget height |
| `quality` | auto, low, medium, high, ultra | `auto` | Rendering quality |
| `show-markers` | true, false | `true` | Show markers |
| `vr` | true, false | `true` | Enable VR button |
| `locked` | true, false | `false` | Lock camera controls |
| `ui` | minimal, hidden, full | `minimal` | Control bar visibility |
| `renderer` | auto, webgl2, webgpu | `auto` | Renderer backend preference |

## Quality Profiles

| Profile | Splat Budget | Pixel Ratio | Post-FX | Target |
|---------|-------------|-------------|---------|--------|
| phoneLow | 400K | 1.0 | Off | Low-end mobile |
| phoneHigh | 800K | 1.25 | Off | High-end mobile |
| desktopMedium | 1.5M | 1.5 | On | Desktop (default) |
| desktopHigh | 3M | 2.0 | On | High-end desktop |
| vrQuest | 700K | 1.0 | Off | VR headset |

**Auto mode** starts conservative and adjusts based on measured FPS.

## WebGPU

WebGPU is used automatically when available. The viewer falls back to WebGL2 gracefully if:
- WebGPU is not supported by the browser
- VR session is active (WebGL2 is more stable for VR)
- The WebGPU renderer initialization fails

Check `chrome://gpu` (Chrome) or `about:support` (Firefox) to verify WebGPU availability.

## Rendering Pipeline

The public viewer and widget use PlayCanvas Engine GSplat rendering through `viewer-core`. Assets are loaded as PlayCanvas `gsplat` assets with unified rendering enabled, so `.ply`, `.sog`, `.meta.json`, and `lod-meta.json` follow the same runtime path as SuperSplat-compatible scenes.

Manifest asset selection prefers `lodManifestUrl` for normal viewing, then SOG `metaUrl`, then the source `sceneUrl`. WebGL2 remains the reliable fallback; WebGPU is selected only when requested or available in auto mode and device creation succeeds. VR uses WebGL2 until WebGPU XR has been verified.

## VR / WebXR

VR support requires a WebXR-compatible browser and headset:
- **Meta Quest** with Oculus Browser or Wolvic
- **HTC Vive / Valve Index** with a WebXR-enabled browser
- VR always uses WebGL2 for stability (even if WebGPU is available)
- Controller ray selection for markers is supported
- VR uses a reduced splat budget (700K) for stable frame rates

## Project Structure

```
├── apps/
│   ├── public-web/     # Public-facing React app (scene list + viewer)
│   ├── admin-web/      # Admin React app (upload, CRUD, annotation editor)
│   ├── api/            # Fastify API server + Prisma schema
│   └── worker/         # BullMQ background job processor
├── packages/
│   ├── viewer-core/    # PlayCanvas GSplat renderer facade
│   ├── viewer-widget/  # Framework-independent Web Component
│   ├── shared/         # Shared types, schemas, constants
│   └── ui/             # Reusable React UI components
├── infra/
│   ├── nginx/          # Reverse proxy configuration
│   └── postgres/       # Database initialization
├── docker-compose.yml  # Local Docker deployment
├── plan.md             # Detailed project plan
└── README.md           # This file
```

## API Endpoints

### Public
```
GET  /api/health
GET  /api/splats
GET  /api/splats/:slug
GET  /api/splats/:slug/manifest
GET  /api/splats/:slug/markers
GET  /api/splats/:slug/annotations
GET  /api/widget/:slug/config
```

### Auth
```
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

### Admin (requires authentication)
```
GET    /api/admin/splats
POST   /api/admin/splats
GET    /api/admin/splats/:id
PATCH  /api/admin/splats/:id
DELETE /api/admin/splats/:id
POST   /api/admin/splats/:id/upload
POST   /api/admin/splats/:id/process
POST   /api/admin/splats/:id/publish
POST   /api/admin/splats/:id/unpublish
GET    /api/admin/splats/:id/markers
POST   /api/admin/splats/:id/markers
PATCH  /api/admin/markers/:id
DELETE /api/admin/markers/:id
GET    /api/admin/splats/:id/annotations
POST   /api/admin/splats/:id/annotations
PATCH  /api/admin/annotations/:id
DELETE /api/admin/annotations/:id
GET    /api/admin/jobs/:id
GET    /api/admin/jobs/:id/events
```

## Environment Variables

See `.env.example` for all configuration options. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://...` | PostgreSQL connection |
| `REDIS_URL` | `redis://redis:6379` | Redis for job queue |
| `S3_ENDPOINT` | `http://minio:9000` | MinIO/S3 endpoint |
| `S3_BUCKET` | `gsplat-assets` | Object storage bucket |
| `JWT_SECRET` | `local-dev-...` | JWT signing secret |
| `MAX_UPLOAD_MB` | `2048` | Max upload size in MB |
| `ADMIN_SEED_EMAIL` | `admin@example.com` | Default admin email |
| `ADMIN_SEED_PASSWORD` | `admin12345` | Default admin password |

## Troubleshooting

### Scene fails to load splats
The viewer reports an error when it cannot fetch or parse the selected render asset. Check:
1. MinIO bucket `gsplat-assets` exists and has `public-read` policy
2. The seed script ran successfully (check API container logs)
3. The manifest `sceneUrl`, `metaUrl`, or `lodManifestUrl` is accessible via `/assets/...`
4. Open browser DevTools → Network tab → look for failed requests to `/assets/`

### Docker build fails
```bash
docker compose down -v   # Remove volumes
docker compose up --build --force-recreate
```

### MinIO console not loading
MinIO console is at `http://localhost:9001` (separate port from the S3 API at 9000).

### VR button not showing
VR requires WebXR support. Most desktop browsers don't support immersive VR — use a VR headset browser (Oculus Browser, Wolvic) or Chrome with flags enabled.

## Known Limitations

- Conversion pipeline is pass-through and expects already prepared PLY/SPZ/SOG/SOG metadata/LOD assets
- Worker-side SOG conversion and PlayCanvas `lod-meta.json` generation are not implemented yet
- WebGPU GSplat rendering depends on PlayCanvas device support and falls back to WebGL2
- Marker placement raycasts the point cloud first and falls back to the ground plane only when no point is hit
- VR tests require physical headset hardware

## License

MIT
