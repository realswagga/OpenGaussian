# Admin Interface Overhaul — Detailed Implementation Plan

> **Status: Planning** — Created 2026-05-26
> Parent: plan.md section 18 (Admin web application) + section 12 (Worker pipeline)

---

## 1. Current State Assessment

### What Exists (Working)

| Area | Status | Notes |
|------|--------|-------|
| Admin login | ✅ | JWT + cookie auth, Fastify `/api/auth/*` |
| Splat CRUD | ✅ | Create/edit/delete via admin API + basic forms |
| Upload + Process | ✅ | Multipart upload → MinIO → BullMQ job queue |
| Worker pipeline | ⚠️ | validate/extractMetadata/convert work; LOD generation is stub; poster generates from PLY only |
| Publish/Unpublish | ✅ | Status transitions enforced (needs READY version) |
| Annotation CRUD | ✅ | REST API for create/update/delete |
| 3D Annotation Editor | ⚠️ | Raw Three.js scene, ground-plane placement, no gizmos, no pretransform |
| Dashboard | ⚠️ | 3 stat cards computed from full splat list fetch |
| Splats table | ⚠️ | Basic `<table>` with inline actions |
| Upload page | ⚠️ | Basic `<input type="file">` form |
| UI Components | ✅ | Button, Card, Badge, Modal, Spinner, Tabs, Input in `@gsplat/ui` |
| Navigation | ⚠️ | Simple top bar with links, no sidebar, no breadcrumbs |

### What's Missing

| Feature | Priority |
|---------|----------|
| Pretransform (position/rotation/scale baking) | **HIGH** |
| True LOD generation in worker | **HIGH** |
| Polished dashboard with real stats endpoint | **HIGH** |
| Drag-and-drop upload with progress | **HIGH** |
| Transform gizmos in 3D annotation editor | **HIGH** |
| Proper use of shared UI components | MEDIUM |
| Sidebar navigation + breadcrumbs | MEDIUM |
| Splat detail page with tabs (metadata, versions, preview) | MEDIUM |
| Color/icon pickers for annotations | MEDIUM |
| Job status live polling / SSE in UI | MEDIUM |
| Toast notifications | LOW |
| Keyboard shortcuts | LOW |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Admin Web App (React)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │Dashboard │  │ Splats   │  │ Upload   │  │ 3D Editor  │ │
│  │Page      │  │Page      │  │Page      │  │Page        │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘ │
│       │              │              │              │         │
│  ┌────┴──────────────┴──────────────┴──────────────┴────┐  │
│  │              Shared UI Components (@gsplat/ui)         │  │
│  │  Button | Card | Badge | Modal | Spinner | Tabs       │  │
│  │  Input  | Select | ProgressBar | Tooltip | Toast      │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              API Client Layer (typed fetch wrappers)   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    API Server (Fastify)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │/admin/   │  │/admin/   │  │/admin/   │  │/admin/     │ │
│  │splats    │  │upload    │  │annotations│ │jobs        │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘ │
│  ┌──────────┐  ┌──────────────────────────────────────┐   │
│  │/admin/   │  │              NEW ENDPOINTS            │   │
│  │stats     │  │ GET /admin/stats                      │   │
│  └──────────┘  │ PATCH /admin/splats/:id/transform     │   │
│                │ GET  /admin/splats/:id/versions       │   │
│                └──────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Worker (BullMQ)                            │
│  splat.validate → splat.extractMetadata → splat.convert     │
│  → splat.generateLod → splat.generatePreview                 │
│  → splat.applyPretransform (NEW)                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Step-by-Step Implementation Plan

### STEP 1 — Database Schema: Add Pretransform Fields

**File:** [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma)

Add to the `Splat` model:

```prisma
model Splat {
  // ... existing fields ...

  // Pretransform — applied before serving to the viewer
  pretransformJson    Json?     // { position: [x,y,z], rotation: [x,y,z], scale: [x,y,z] }
}
```

**Migration:** Generate a new Prisma migration.

```
npx prisma migrate dev --name add_pretransform_to_splat
```

**Seed update:** No seed change needed (pretransform defaults to null).

---

### STEP 2 — Shared Types & Schemas: Add Pretransform + Stats Types

**File:** [`packages/shared/src/types.ts`](packages/shared/src/types.ts)

Add:

```ts
export interface PretransformData {
  position: [number, number, number];
  rotation: [number, number, number];  // Euler angles in degrees
  scale: [number, number, number];
}

export interface AdminDashboardStats {
  totalSplats: number;
  publishedSplats: number;
  draftSplats: number;
  processingSplats: number;
  failedSplats: number;
  readySplats: number;
  archivedSplats: number;
  totalAnnotations: number;
  activeJobs: number;
  storageBytesEstimate: number;
  recentJobs: {
    id: string;
    splatId: string;
    splatTitle: string;
    status: string;
    createdAt: string;
  }[];
}
```

**File:** [`packages/shared/src/schemas.ts`](packages/shared/src/schemas.ts)

Add:

```ts
export const pretransformSchema = z.object({
  position: z.tuple([z.number(), z.number(), z.number()]).optional(),
  rotation: z.tuple([z.number(), z.number(), z.number()]).optional(),
  scale: z.tuple([z.number(), z.number(), z.number()]).optional(),
});
```

Export `PretransformData` through index.ts.

---

### STEP 3 — API: Dashboard Stats Endpoint

**New route:** GET `/api/admin/stats`

**File:** New file [`apps/api/src/routes/admin/stats.ts`](apps/api/src/routes/admin/stats.ts)

Implementation:
```ts
app.get('/stats', async () => {
  const [
    totalSplats, publishedSplats, draftSplats, processingSplats,
    failedSplats, readySplats, archivedSplats, totalAnnotations,
    activeJobs
  ] = await Promise.all([
    prisma.splat.count(),
    prisma.splat.count({ where: { status: 'PUBLISHED' } }),
    prisma.splat.count({ where: { status: 'DRAFT' } }),
    prisma.splat.count({ where: { status: 'PROCESSING' } }),
    prisma.splat.count({ where: { status: 'FAILED' } }),
    prisma.splat.count({ where: { status: 'READY' } }),
    prisma.splat.count({ where: { status: 'ARCHIVED' } }),
    prisma.annotation.count(),
    prisma.splatVersion.count({ where: { processingStatus: 'RUNNING' } }),
  ]);

  // Recent jobs (last 10 versions)
  const recentVersions = await prisma.splatVersion.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 10,
    include: { splat: { select: { title: true } } },
  });

  const recentJobs = recentVersions.map(v => ({
    id: v.id,
    splatId: v.splatId,
    splatTitle: v.splat.title,
    status: v.processingStatus,
    createdAt: v.createdAt.toISOString(),
  }));

  return {
    totalSplats, publishedSplats, draftSplats, processingSplats,
    failedSplats, readySplats, archivedSplats, totalAnnotations,
    activeJobs, storageBytesEstimate: 0, // future: sum from S3
    recentJobs,
  };
});
```

**Registration:** Add to [`apps/api/src/server.ts`](apps/api/src/server.ts):

```ts
import { adminStatsRoutes } from './routes/admin/stats.js';
await app.register(adminStatsRoutes, { prefix: '/api/admin' });
```

---

### STEP 4 — API: Pretransform Endpoints

**New routes in** [`apps/api/src/routes/admin/splats.ts`](apps/api/src/routes/admin/splats.ts):

```ts
// GET /api/admin/splats/:id/transform
app.get('/splats/:id/transform', async (request, reply) => {
  const { id } = request.params as { id: string };
  const splat = await prisma.splat.findUnique({ where: { id }, select: { pretransformJson: true } });
  if (!splat) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Splat not found' } });
  return { pretransform: splat.pretransformJson || null };
});

// PATCH /api/admin/splats/:id/transform
app.patch('/splats/:id/transform', async (request, reply) => {
  const { id } = request.params as { id: string };
  const data = pretransformSchema.parse(request.body);
  const updated = await prisma.splat.update({
    where: { id },
    data: { pretransformJson: data },
    select: { pretransformJson: true },
  });
  return { pretransform: updated.pretransformJson };
});
```

---

### STEP 5 — API: Improve Upload/Process Flow

**File:** [`apps/api/src/routes/admin/upload.ts`](apps/api/src/routes/admin/upload.ts)

Improvements:
1. After upload + enqueue, return a `jobId` that the frontend can poll
2. Add `GET /api/admin/splats/:id/versions` endpoint to list all versions with status

**File:** [`apps/api/src/routes/admin/jobs.ts`](apps/api/src/routes/admin/jobs.ts)

Improvements:
1. The SSE endpoint should poll the database for status changes rather than closing immediately — use a simple interval-based polling with `setInterval` that checks `processingStatus` every 2s and sends updates, closing after READY/FAILED or timeout.

---

### STEP 6 — Worker: True LOD Generation

**File:** [`apps/worker/src/index.ts`](apps/worker/src/index.ts) — `splat.generateLod` case

Replace the stub with a real implementation:

```
Algorithm for PLY files:
1. Download source PLY
2. Parse vertex count and positions from header
3. Build spatial octree (depth 4-5, targeting ~64 cells)
4. For each octree cell:
   a. Subsample points: random selection at rates 100%, 25%, 6%, 1.5%
   b. Write each LOD level as a separate PLY (same header, fewer vertices)
5. Upload LOD chunks to MinIO at:
   splats/{splatId}/versions/{versionId}/chunks/lod-{level}-{cell}.ply
6. Generate lod-meta.json manifest describing chunk structure
7. Upload lod-meta.json
8. Update version record

For non-PLY formats (SPZ, SOG): pass-through only (no LOD generation possible without specialized tooling)
```

**Important:** This is computationally intensive. For the diploma demo, limit to scenes < 500k points. Log clearly when LOD generation is skipped for unsupported formats.

---

### STEP 7 — Worker: Improved Poster Generation

**File:** [`apps/worker/src/index.ts`](apps/worker/src/index.ts) — `splat.generatePreview` case

Current implementation only works for binary PLY. Improvements:

1. Handle ASCII PLY (parse text header)
2. For non-PLY formats (SPZ, SOG), generate a placeholder poster or skip with clear log message
3. Generate both `poster.png` (256×256) and `preview-small.png` (128×128) — actual resize, not same buffer
4. Store keys in version record and splat record

---

### STEP 8 — Worker: Pretransform Baking

**New job type:** `splat.applyPretransform`

**File:** [`apps/worker/src/index.ts`](apps/worker/src/index.ts)

```
Algorithm for PLY:
1. Download converted PLY
2. Read pretransform data from Splat record
3. Apply position offset to all vertex positions
4. Apply rotation (Euler → rotation matrix) to all vertex positions
5. Apply scale to all vertex positions
6. For scalar rotation (SH-based), rotate normal/SH coefficients:
   - Apply inverse rotation to SH DC color (simplified)
7. Write transformed PLY
8. Upload as new version asset
9. Update splat productionObjectKey

For non-PLY: skip with clear log

Trigger: After conversion succeeds, check if pretransform is set. If yes, enqueue this job automatically.
```

---

### STEP 9 — Admin-Web: Redesigned DashboardPage

**File:** [`apps/admin-web/src/pages/DashboardPage.tsx`](apps/admin-web/src/pages/DashboardPage.tsx)

Complete rewrite using shared UI components:

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  Dashboard                                    GSplat Admin │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐    │
│  │ Total   │ │Published│ │Processing│ │ Failed   │    │
│  │ Splats  │ │         │ │         │ │          │    │
│  │   12    │ │    8    │ │    2    │ │    1     │    │
│  └─────────┘ └─────────┘ └─────────┘ └──────────┘    │
│                                                         │
│  ┌──────────────────────────┐  ┌────────────────────┐  │
│  │  Status Distribution     │  │  Recent Jobs        │  │
│  │  DRAFT       ██ 3       │  │  ✓ convert         │  │
│  │  PROCESSING  ██ 2       │  │  ✓ validate        │  │
│  │  READY       ████ 4     │  │  ✗ generateLod     │  │
│  │  PUBLISHED   ██████ 8   │  │  ⏳ extractMetadata│  │
│  │  FAILED      █ 1        │  │  ✓ convert         │  │
│  └──────────────────────────┘  └────────────────────┘  │
│                                                         │
│  Quick Actions: [New Splat] [View All Splats] [MinIO]  │
└─────────────────────────────────────────────────────────┘
```

Implementation details:
- Fetch from `GET /api/admin/stats`
- Use `Card` component from `@gsplat/ui` for stat cards
- Use `Badge` component for status indicators
- Status distribution as a simple bar chart using div bars (no chart library needed)
- Recent jobs list with status badges and links to splat
- Quick action buttons using `Button` component

---

### STEP 10 — Admin-Web: Redesigned SplatsPage

**File:** [`apps/admin-web/src/pages/SplatsPage.tsx`](apps/admin-web/src/pages/SplatsPage.tsx)

Complete rewrite:

**Features:**
- Search input to filter splats by title/slug
- Status filter tabs (All | Draft | Processing | Ready | Published | Failed | Archived)
- Card grid view (default) with poster thumbnails + table toggle option
- Each card shows: poster, title, slug, status badge, splat count, format, updated date
- Action buttons per card: Edit | Upload | Annotations | Publish/Unpublish | Delete
- Batch selection for bulk publish/unpublish/delete
- Empty state with helpful message

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  Splats                              [+ New Splat]       │
│  [🔍 Search...]  [All▼] [Sort by: Updated▼]            │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐    │
│  │ [poster]     │ │ [poster]     │ │ [poster]     │    │
│  │ Demo Scene   │ │ Living Room  │ │ Office       │    │
│  │ demo-scene   │ │ living-room  │ │ office       │    │
│  │ PUBLISHED ✓  │ │ PROCESSING ⏳│ │ FAILED ✗     │    │
│  │ 300k splats  │ │ 500k splats  │ │ —            │    │
│  │ .ply · 45MB  │ │ .ply · 72MB  │ │              │    │
│  │ [Edit][Annot]│ │ [View Job]   │ │ [Edit][Retry]│    │
│  └──────────────┘ └──────────────┘ └──────────────┘    │
└─────────────────────────────────────────────────────────┘
```

Implementation:
- Use `Card`, `Badge`, `Button`, `Spinner` from `@gsplat/ui`
- Add `Input` for search
- Status filter using `Tabs` component
- Wire existing publish/unpublish/delete handlers
- Add confirmation `Modal` for delete

---

### STEP 11 — Admin-Web: Redesigned Splat Detail/Edit Page

**File:** [`apps/admin-web/src/pages/SplatEditPage.tsx`](apps/admin-web/src/pages/SplatEditPage.tsx)

Transform from simple form into a tabbed detail page:

**Tabs:**
1. **Metadata** — title, slug, description form (existing)
2. **Versions** — version history table with status, format, size, job log
3. **Pretransform** — position/rotation/scale inputs with apply button
4. **Preview** — embedded viewer if scene is published

**Version history table:**
| Version | Status | Format | Size | Splats | Actions |
|---------|--------|--------|------|--------|---------|
| 3 | READY | ply | 45MB | 300k | [View Job] |
| 2 | FAILED | — | — | — | [View Log] |
| 1 | READY | ply | 42MB | 280k | [View Job] |

**Pretransform panel:**
```
┌────────────────────────────────────────┐
│  Pretransform                           │
│  Adjust scene position/rotation/scale   │
│  before serving to viewers.             │
│                                         │
│  Position                               │
│  X: [  0.00  ] Y: [  0.00  ] Z: [ 0.00]│
│                                         │
│  Rotation (degrees)                     │
│  X: [  0.00  ] Y: [  0.00  ] Z: [ 0.00]│
│                                         │
│  Scale                                  │
│  X: [  1.00  ] Y: [  1.00  ] Z: [ 1.00]│
│                                         │
│  [Apply Pretransform]  [Reset]          │
└────────────────────────────────────────┘
```

---

### STEP 12 — Admin-Web: Redesigned Upload Page

**File:** [`apps/admin-web/src/pages/UploadPage.tsx`](apps/admin-web/src/pages/UploadPage.tsx)

Complete rewrite:

**Features:**
- Large drag-and-drop zone with file type icons
- Click-to-browse fallback
- Accepted format list displayed
- File size limit indicator
- Upload progress bar (using XMLHttpRequest for progress events)
- After upload: processing status polling with visual steps
- Success/error states with clear feedback

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  Upload — Demo Scene                                    │
│  ← Back to splat                                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │                                                 │   │
│  │            ┌──────────┐                         │   │
│  │            │  📁  📤  │   Drop .ply file here   │   │
│  │            │   or click to browse               │   │
│  │            └──────────┘                         │   │
│  │                                                 │   │
│  │  Accepted: .ply  .spz  .sog  .compressed.ply    │   │
│  │  Max size: 2 GB                                  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  [After upload:]                                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Uploading...  ████████████░░░░░░  67%          │   │
│  │  30.2 MB / 45.0 MB                              │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  [After processing starts:]                             │
│  ┌─────────────────────────────────────────────────┐   │
│  │  ✓ Upload complete                              │   │
│  │  ⏳ Validating...                                │   │
│  │  ○ Extracting metadata                          │   │
│  │  ○ Converting                                   │   │
│  │  ○ Generating LOD                               │   │
│  │  ○ Generating preview                           │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

Implementation:
- Use `Card`, `Button`, `Spinner`, `Badge` from `@gsplat/ui`
- Need new `ProgressBar` component in `@gsplat/ui`
- XMLHttpRequest for upload progress (fetch API doesn't support progress events natively)
- Poll `GET /api/admin/jobs/:id` every 3s after upload to update processing status
- Parse `processingLog` to show step-by-step progress

---

### STEP 13 — Admin-Web: Enhanced 3D Annotation Editor

**File:** [`apps/admin-web/src/pages/Annotation3DEditorPage.tsx`](apps/admin-web/src/pages/Annotation3DEditorPage.tsx)

Major enhancements:

**A. Transform Gizmo Integration**

Use Three.js `TransformControls` from `three/examples/jsm/controls/TransformControls.js`:

```ts
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

// Add after OrbitControls setup
const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.addEventListener('dragging-changed', (event) => {
  controlsRef.current!.enabled = !event.value; // Disable orbit while dragging
});
transformControls.addEventListener('objectChange', () => {
  // Update edit form with new position from gizmo
  const obj = transformControls.object;
  if (obj) {
    setEditForm(prev => ({
      ...prev,
      positionX: Math.round(obj.position.x * 100) / 100,
      positionY: Math.round(obj.position.y * 100) / 100,
      positionZ: Math.round(obj.position.z * 100) / 100,
    }));
  }
});
scene.add(transformControls);
```

When a marker is selected, attach the transform controls to its sphere. Provide mode buttons: Translate | Rotate | Scale.

**B. Snap-to-Grid**

Add a snap setting (default 0.1 units). Apply to both gizmo and numeric inputs.

**C. Precision Mode**

Hold Shift while dragging to reduce sensitivity (multiply delta by 0.1).

**D. Viewport Helper Overlay**

Add a small overlay in the corner showing:
- Camera position
- Selected marker coordinates
- Grid snap toggle
- Gizmo mode toggle (translate/rotate/scale)

**E. Keyboard Shortcuts**
- `W` — translate mode
- `E` — rotate mode
- `R` — scale mode
- `G` — toggle grid snap
- `Delete` — delete selected marker
- `Escape` — deselect

---

### STEP 14 — Admin-Web: Enhanced Annotation Form

**File:** [`apps/admin-web/src/pages/Annotation3DEditorPage.tsx`](apps/admin-web/src/pages/Annotation3DEditorPage.tsx) (right panel portion)

Add to the edit form:
- **Color picker:** Simple preset swatches (white, red, green, blue, yellow, cyan, magenta) + hex input
- **Icon picker:** Dropdown or preset buttons for common icons (dot, info, warning, landmark, pin, star)
- **Rotation editing:** Add rotationX/Y/Z numeric inputs alongside position
- **Scale slider:** Range input for scale (0.1 to 10.0)
- **Preview button:** Opens a small modal showing how the marker will look in the public viewer

---

### STEP 15 — Admin-Web: Navigation Shell Redesign

**File:** [`apps/admin-web/src/App.tsx`](apps/admin-web/src/App.tsx)

Replace the top bar with a proper sidebar layout:

```
┌──────────┬────────────────────────────────────────────────┐
│ Sidebar  │  Main Content Area                             │
│          │                                                │
│ 🏠 Home  │  ┌──────────────────────────────────────────┐ │
│ 📦 Splats│  │  Breadcrumb: Home › Splats › Demo Scene  │ │
│ 📝 Jobs  │  └──────────────────────────────────────────┘ │
│ ⚙ Settings│                                               │
│          │  [Page Content]                                │
│ ──────── │                                                │
│ user@... │                                                │
│ [Logout] │                                                │
└──────────┴────────────────────────────────────────────────┘
```

**Sidebar items:**
- Dashboard (home icon)
- Splats (package icon)
- (Settings — future)

**Breadcrumbs component:**
Parse current path and render clickable breadcrumb segments.

**Nav item active state:**
Highlight current section based on URL path matching.

Implementation:
- Sidebar: fixed width 220px, dark background (`#0d0d0d`), border-right
- Nav items: full-width buttons with icons, hover highlight, active state with left border accent
- Breadcrumbs: at top of main content area, text-xs muted color except last segment
- User info: at bottom of sidebar, compact

---

### STEP 16 — UI Package: New Components

**Files to create in** [`packages/ui/src/`](packages/ui/src/):

**A. `ProgressBar.tsx`**
```tsx
interface ProgressBarProps {
  value: number;        // 0-100
  variant?: 'default' | 'success' | 'danger';
  size?: 'sm' | 'md';
  label?: string;
}
// Renders a horizontal progress bar with percentage
```

**B. `Select.tsx`**
```tsx
interface SelectProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}
// Styled <select> matching the dark theme
```

**C. `Tooltip.tsx`**
```tsx
interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}
// Simple CSS-based tooltip on hover
```

**D. `Toast.tsx` + `ToastContainer.tsx`**
```tsx
// Simple toast notification system
// useToast() hook returns { toast: (msg, type) => void }
// ToastContainer renders active toasts at bottom-right
```

**E. `IconButton.tsx`**
```tsx
// Button variant with icon-only, tooltip, compact size
```

**Update** [`packages/ui/src/index.ts`](packages/ui/src/index.ts) to export all new components.

---

### STEP 17 — Admin-Web: Pretransform Editor UI

**New component within** [`apps/admin-web/src/pages/SplatEditPage.tsx`](apps/admin-web/src/pages/SplatEditPage.tsx) (as a tab)

The pretransform tab includes:
1. Numeric inputs for position X/Y/Z, rotation X/Y/Z (Euler degrees), scale X/Y/Z
2. Default values: position [0,0,0], rotation [0,0,0], scale [1,1,1]
3. "Apply Pretransform" button — PATCHes to `/api/admin/splats/:id/transform`
4. "Preview Transform" toggle — if on, the embedded viewer (from the Preview tab) applies the transform locally for visual feedback before saving
5. "Reset" button — resets all fields to defaults
6. Info text explaining that the pretransform is applied server-side to the production asset before serving

---

### STEP 18 — Integration: Wire Pretransform into Manifest

**File:** [`apps/api/src/routes/public/splats.ts`](apps/api/src/routes/public/splats.ts)

In the manifest endpoint (`GET /api/splats/:slug/manifest`), add the pretransform data to the response:

```ts
viewer: {
  // ... existing fields ...
  pretransform: splat.pretransformJson || null,
}
```

**File:** [`packages/shared/src/types.ts`](packages/shared/src/types.ts)

Add `pretransform?: PretransformData` to `ViewerManifest.viewer`.

**File:** [`packages/viewer-core/src/types.ts`](packages/viewer-core/src/types.ts)

Add `pretransform` to `ViewerManifest.viewer`.

**File:** [`packages/viewer-core/src/GsplatViewer.ts`](packages/viewer-core/src/GsplatViewer.ts)

In the scene load/start logic, if `manifest.viewer.pretransform` is present, apply the position offset, rotation matrix, and scale to the root scene node (or the splat container) before rendering.

The Three.js application:
```ts
if (manifest.viewer.pretransform) {
  const { position, rotation, scale } = manifest.viewer.pretransform;
  splatGroup.position.set(position[0], position[1], position[2]);
  splatGroup.rotation.set(
    THREE.MathUtils.degToRad(rotation[0]),
    THREE.MathUtils.degToRad(rotation[1]),
    THREE.MathUtils.degToRad(rotation[2]),
  );
  splatGroup.scale.set(scale[0], scale[1], scale[2]);
}
```

---

### STEP 19 — Testing

**A. API Tests (Vitest)**

New test file: [`packages/shared/src/__tests__/admin.test.ts`](packages/shared/src/__tests__/admin.test.ts) — or add to existing tests:

```ts
// Test pretransform schema validation
describe('pretransformSchema', () => {
  it('accepts valid pretransform data', () => { ... });
  it('rejects missing required fields', () => { ... });
  it('accepts partial pretransform (position only)', () => { ... });
});

// Test dashboard stats type shape
describe('AdminDashboardStats', () => { ... });
```

**B. E2E Tests (Playwright)**

Add to [`e2e/smoke.spec.ts`](e2e/smoke.spec.ts):

```ts
test('admin login and dashboard loads', async () => { ... });
test('admin can create splat', async () => { ... });
test('admin can set pretransform', async () => { ... });
test('admin 3D annotation editor loads', async () => { ... });
test('upload page shows drag-drop zone', async () => { ... });
```

---

### STEP 20 — Polish: Consistent Theme & UX

**Theme consolidation:**
All admin-web pages should use CSS custom properties matching the design tokens from `.clinerules`:

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

**Every page must handle four states:**
1. **Loading** — Spinner with contextual label
2. **Empty** — Helpful message with action CTA (e.g., "No splats yet. Create one.")
3. **Error** — Red-bordered card with error message and retry button
4. **Success** — Normal content

**Keyboard shortcuts (global):**
- `N` — New splat
- `Escape` — Close modal / deselect

**Transitions:**
- Page transitions: 150ms fade
- Modal open/close: 200ms fade + scale
- Toast appear/disappear: 250ms slide + fade

---

## 4. Execution Order & Dependencies

```
Step 1  (DB)      ──┐
Step 2  (Shared)  ──┤── Foundation (parallel)
Step 16 (UI Pkg)  ──┘
                      │
Step 3  (API Stats)  ─┤
Step 4  (API Pretransform) ─┤── API layer (sequential)
Step 5  (API Upload/Jobs) ──┘
                      │
Step 6  (Worker LOD) ─┐
Step 7  (Worker Poster) ─┤── Worker (parallel)
Step 8  (Worker Pretransform) ─┘
                      │
Step 9  (Dashboard)  ─┐
Step 10 (SplatsPage) ─┤
Step 11 (SplatEdit)  ─┤
Step 12 (UploadPage) ─┤── Frontend (mostly parallel)
Step 13 (3D Editor)  ─┤
Step 14 (Annotation) ─┤
Step 15 (Nav Shell)  ─┤
Step 17 (Pretransform UI) ─┘
                      │
Step 18 (Integration) ─┤── Wiring
                      │
Step 19 (Testing)    ──┤── Validation
Step 20 (Polish)     ──┘
```

**Recommended batching:**
- Batch A: Steps 1, 2, 16 (foundation)
- Batch B: Steps 3, 4, 5 (API)
- Batch C: Steps 6, 7, 8 (worker)
- Batch D: Steps 9-15, 17 (frontend)
- Batch E: Steps 18-20 (integration + polish)

---

## 5. Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| LOD generation too slow for large PLY | Worker timeout, failed job | Limit to < 500k splats; log clearly when skipping |
| TransformControls conflicts with OrbitControls | Broken 3D editor | Disable orbit while gizmo is active (standard pattern) |
| Pretransform breaks existing scenes | Published scenes shift | Only apply to new uploads; add preview before applying |
| Large number of UI changes breaks existing functionality | Regression | Implement one page at a time, test after each |

---

## 6. Definition of Done

After all steps are complete:

1. `docker compose up --build` succeeds
2. Dashboard shows real stats from dedicated endpoint
3. Splats list has search, filter, card view with posters
4. Splat detail has tabs (metadata, versions, pretransform, preview)
5. Upload page has drag-and-drop, progress bar, processing status
6. 3D annotation editor has transform gizmo (translate/rotate/scale)
7. Annotation form has color picker, icon picker, rotation inputs
8. Admin can set pretransform (position/rotation/scale) on a splat
9. Pretransform is reflected in the viewer manifest and applied in the viewer
10. Worker can generate LOD chunks from PLY files
11. All pages have loading/empty/error/success states
12. Navigation uses sidebar + breadcrumbs
13. UI components from @gsplat/ui are used consistently
