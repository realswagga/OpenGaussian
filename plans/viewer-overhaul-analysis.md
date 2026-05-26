# Gaussian Splat Viewer Overhaul — Technical Analysis & Redesign Plan

## 1. Executive Summary

Our current [`GsplatViewer`](packages/viewer-core/src/GsplatViewer.ts) suffers from three root-cause categories of failure:

1. **Destructive CPU depth sorting** — full geometry reallocation every 6–30 frames
2. **Inefficient EWA rasterization** — unbounded `gl_PointSize` waste, no tile culling
3. **Missing GPU-accelerated pipeline** — no compute/transform-feedback sort, no dual-pass occlusion

The PlayCanvas [supersplat-viewer](https://github.com/playcanvas/supersplat-viewer) solves all three by moving the entire sorting and culling pipeline onto the GPU, using WebGL 2.0 transform feedback (or WebGPU compute shaders) for a **sort-once-per-frame, render-once** architecture with zero CPU geometry churn.

---

## 2. Current Architecture — Failure Analysis

### 2.1 Destructive CPU Depth Sort (THE PRIMARY PROBLEM)

Location: [`sortByDepth()`](packages/viewer-core/src/GsplatViewer.ts:775–843) called from [`renderLoop()`](packages/viewer-core/src/GsplatViewer.ts:948–957)

```
sortInterval = N > 200k ? 30 : N > 50k ? 12 : 6 frames
```

**What happens every sort cycle:**

```
1. Allocate depths:         new Float32Array(N)           ← O(N) GC pressure
2. Allocate indices:        new Uint32Array(N)            ← O(N) GC pressure
3. JS sort comparator:      O(N log N) with JS call overhead
4. Allocate newPos:         new Float32Array(N*3)         ← GC
5. Allocate newCol:         new Float32Array(N*3)         ← GC
6. Allocate newScl:         new Float32Array(N*3)         ← GC
7. Allocate newOp:          new Float32Array(N)           ← GC
8. Allocate newRot:         new Float32Array(N*4)         ← GC
9. Copy loop:               5 separate per-vertex copies  ← O(N) CPU
10. Assign to geometry:     .set() on 5 buffer attributes ← GPU reallocation
```

**For N=500,000 splats (typical scene):**
- ~24 MB of temporary Float32Arrays allocated and GC'd per sort
- ~500k JS function calls (the comparator)
- 5 × 500k = 2.5M scalar writes for the copy loop
- 5 `bufferSubData` or full buffer reallocations on GPU

Every 6 frames (at 60 fps), this happens once — causing a **visible frame hitch** as the JS GC kicks in and the GPU pipeline stalls on buffer uploads.

**Why it causes visible "shifting":**
Between sorts, the geometry buffer is stale. The previous sort order reflects the camera position from 6–30 frames ago. When the sort finally executes, all splats snap to new positions in the draw order, creating a visible "pop" or "shift." The splats aren't actually moving in world space — their draw order is jumping.

**Why the adaptive interval makes it worse:**
- Large datasets: sort every 30 frames = splats are up to 500ms stale
- Small datasets: sort every 6 frames = wastefully re-sorting when it might not be needed
- The threshold is binary and doesn't account for camera movement speed

### 2.2 Inefficient EWA Rasterization

Location: [`createGaussianMaterial()`](packages/viewer-core/src/GsplatViewer.ts:595–769)

**Vertex shader computes:**
1. Quaternion → 3×3 rotation matrix (27 multiplications)
2. World covariance Σ₃ via R·diag(s²)·Rᵀ (18 multiplications per upper triangle)
3. Jacobian of projective transform J(2×3) (4 multiplications)
4. Screen covariance Σ₂ = J·Σ₃·Jᵀ (12 multiplications)
5. Eigenvalue computation for gl_PointSize

**Total: ~60 float operations per splat per frame in the vertex shader**

For 500k splats: 30M vertex shader operations just for covariance projection. This is reasonable for the vertex stage but the real problem is downstream.

**Fragment shader per-pixel work:**
Every pixel inside the `gl_PointSize` square runs:
1. 2×2 matrix inverse (3 flops for det + 3 assignments)
2. Mahalanobis distance² (5 flops)
3. `exp(-0.5 * d²)` (expensive transcendental)
4. Alpha threshold comparison

**Fill rate catastrophe:**
A splat with `gl_PointSize = 200` (common for foreground Gaussians) covers π × 100² ≈ 31,416 pixels. At 500k splats with an average of even 20px radius: **500k × 1,256 ≈ 628M fragment shader invocations per frame**. Most produce alpha < 1/255 and are discarded, but only AFTER running the entire fragment shader.

**`gl_PointSize` clamping:**
`GL_MAX_POINT_SIZE` is typically 256 or 1024. Large foreground splats get clipped to the maximum, losing visual quality. Worse, the 6σ point size is `6.0 * sqrt(eigMax)`, which for large world-scale Gaussians can easily exceed the max → splats truncate.

### 2.3 No Tile-Based or Occlusion Culling

Every splat is rendered. Even splats behind walls, behind the camera (filtered by frustum), or fully occluded are processed by the vertex shader and contribute to fragment overdraw. supersplat-viewer uses a **dual-pass** approach:

- **Pass 1:** Render a low-resolution depth pyramid (Z-buffer)
- **Pass 2:** In the vertex shader, test each splat against the depth pyramid. Cull fully-occluded splats before rasterization.

Without this, scenes like the Living Room (enclosed geometry) waste enormous fill rate on occluded Gaussians.

### 2.4 No View-Dependent Color (SH Evaluation)

Our current shader uses only the DC component of spherical harmonics:

```
color = SH_C0 * f_dc + 0.5  (constant, no view dependence)
```

Real 3DGS includes SH coefficients up to degree 3 (48 coefficients per color channel). supersplat-viewer evaluates the full SH in the vertex shader, computing the view direction from the camera position to the splat mean, then reconstructing view-dependent specular highlights and color shifts.

Without this: scenes look flat, metallic surfaces lose their specular "gleam" as you orbit.

### 2.5 Single Mesh, No LOD

All splats are loaded into one `THREE.Points` mesh. No hierarchical LOD means:
- Distant splats (sub-pixel size) are still individually rendered
- No ability to swap in lower-detail representations
- Memory is maxed at load time with no streaming

---

## 3. How supersplat-viewer Solves These Problems

supersplat-viewer's architecture from [playcanvas/supersplat-viewer](https://github.com/playcanvas/supersplat-viewer) relies on these key techniques:

### 3.1 GPU Radix Sort via WebGL 2.0 Transform Feedback

**Core insight:** Don't sort on CPU at all. Upload splats once. Sort indices on GPU every frame.

**Pipeline:**
1. **Compute view-space depths** — vertex shader pass that outputs `(depth, index)` pairs into a transform feedback buffer. This is a simple pass over all vertices with no rasterization.
2. **GPU Radix Sort** — sort the `(depth, index)` pairs by depth using a series of counting-sort passes. Each pass sorts on 4–8 bits of the depth key, using:
   - A histogram pass (count keys per bucket via additive blending or atomic counters)
   - A prefix-sum pass (turn histogram into offsets)
   - A scatter pass (write sorted pairs to output buffer)
3. **Indirect Draw** — use the sorted indices with `glDrawElements` or indirect draw to render splats in correct depth order.

**Why this eliminates flickering:**
- Sort runs EVERY frame, not every 6–30 frames
- Sort runs on GPU (parallel, O(N) with radix sort, no JS GC)
- Same buffer reused every frame (no allocation)
- No geometry attribute reordering — just an index buffer that maps draw order

**Performance:** Radix sort on GPU is extremely fast. For 1M items with 32-bit keys: 8 passes × (histogram + scatter) ≈ sub-millisecond on modern GPUs.

### 3.2 WebGPU Compute Shader Path (Newer)

For browsers with WebGPU support, supersplat-viewer can use compute shaders for even faster sorting:
- **Bitonic sort** or **radix sort** on `(depth, index)` pairs in a single compute dispatch
- Shared memory (workgroup memory) for local sorting passes
- Direct buffer access without transform feedback overhead

### 3.3 Instanced Quad Rendering (Alternative to gl_PointSize)

Some versions of supersplat-viewer render each splat as an **instanced quad** (two triangles forming a screen-aligned rectangle) rather than using `gl_POINTS`:

**Advantages over `gl_PointSize`:**
- No `GL_MAX_POINT_SIZE` limitation — arbitrarily large splats
- Tighter fragment coverage — the quad can be sized to exactly cover 3σ
- Better for mobile GPUs that optimize triangle rasterization
- Works with indirect multidraw for GPU-driven rendering

**Implementation:**
- Single quad geometry (4 vertices) instanced N times
- Instance attributes: splat position, scale, rotation, color, opacity
- Vertex shader expands the quad to cover the projected ellipse
- Fragment shader same as before (Mahalanobis distance)

### 3.4 Dual-Pass Depth Pyramid Occlusion Culling

**Pass 1 — Depth Pre-pass:**
- Render splats with simplified shader (no color, just depth)
- Build a depth pyramid from the resulting depth buffer (mipmap chain of min-depths)

**Pass 2 — Main Render:**
- In the vertex shader of each splat: compute bounding box in screen space
- Test against coarsest level of depth pyramid first
- If the splat's nearest depth is behind all pixels in the tile, cull the entire splat
- This eliminates 3–10× overdraw for enclosed scenes

### 3.5 SH Evaluation up to Degree 3

superset-viewer evaluates the full spherical harmonic expansion in the vertex shader:

```
viewDir = normalize(cameraPos - splatPos)
color = SH_DC + SH_1 * viewDir + SH_2 * (viewDir⊗viewDir) + SH_3 * ...
```

This gives proper view-dependent specular highlights, making metallic and glossy surfaces look correct as the camera moves.

### 3.6 Chunked/Hierarchical LOD

Large scenes are split into spatial chunks (octree or grid). Each chunk has multiple LOD levels. The viewer dynamically selects which chunks and LODs to render based on:
- Distance to camera
- Screen-space projection size
- Available splat budget

Distant chunks use fewer splats (random subsampling or pre-computed reduced sets).

---

## 4. Redesign Plan — Phase by Phase

### Phase 1: GPU Sort Pipeline (WebGL 2.0 Transform Feedback)

**Goal:** Replace CPU depth sort with GPU radix sort. Eliminate geometry reallocation entirely.

**Architecture:**

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Splat Data      │    │ GPU Radix Sort   │    │ Indirect Draw   │
│ (uploaded once) │───▶│ (every frame)    │───▶│ (sorted order)  │
│                 │    │                  │    │                 │
│ positions       │    │ depth→key        │    │ drawElements    │
│ scales          │    │ histogram        │    │ with index buf  │
│ colors          │    │ prefix scan      │    │                 │
│ opacity         │    │ scatter          │    │                 │
│ rotation        │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

**Implementation steps:**

1. **Upload splat data once** into interleaved or separate VBOs. Never re-upload.
2. **Compute view-space depth per splat** using a simple VS→TF pass:
   ```
   vertex shader: depth = -(modelViewMatrix * position).z
   transform feedback: output (uint(depth_as_float_bits), uint(splatIndex))
   ```
3. **Radix sort** the (key, index) pairs on GPU:
   - 8 passes of radix-256 sort
   - Use two alternating transform feedback buffers (ping-pong)
   - Histogram via `glBlendEquation(GL_FUNC_ADD)` with additive blending into a 256-element buffer
   - Prefix sum via a separate shader pass
   - Scatter pass writes sorted pairs
4. **Draw with sorted indices** — create an `ELEMENT_ARRAY_BUFFER` from the sorted index portion of the output buffer. Use `glDrawElements` with `GL_POINTS`.
5. **Eliminate `sortByDepth()`**, `sortedIndices`, geometry attribute swapping, and the `sortNeeded`/`sortInterval` logic entirely.

**Expected outcome:**
- Sort runs every frame at GPU speed (< 1ms for 1M splats)
- Zero CPU memory allocation per frame
- Zero GC pressure
- No visible "popping" — continuous smooth sort

### Phase 2: Instanced Quad Rendering

**Goal:** Replace `gl_POINTS` with instanced quads for unbounded splat sizes and better fill rate.

**Implementation:**
1. Create a single 4-vertex quad geometry (unit square in local coords)
2. Use `THREE.InstancedMesh` or raw `gl.drawElementsInstanced` with instance count = N
3. Instance attributes: position (vec3), scale (vec3), rotation (vec4), color (vec3), opacity (float)
4. Vertex shader per-instance:
   - Same covariance projection as before
   - Instead of `gl_PointSize`, expand the quad vertices to cover the ellipse bounding box
   - Transform quad vertex from unit rect [0,1]² → screen-space ellipse coverage
5. Fragment shader unchanged (Mahalanobis evaluation)

**Advantage:**
- No `GL_MAX_POINT_SIZE` limit
- Tighter triangle coverage vs. full point sprite square
- Compatible with GPU-driven indirect multidraw

### Phase 3: Depth Pyramid Occlusion Culling

**Goal:** Cull occluded splats before fragment shading.

**Implementation:**
1. **Depth pre-pass:** Low-resolution render (e.g., 1/4 of final resolution) of all splats with a minimal depth-only shader
2. **Build depth pyramid:** Generate mipmap chain from depth buffer, each level storing the MAX depth (farthest) of the corresponding 2×2 tile
3. **Culling in vertex shader (Phase 2 instanced rendering):**
   ```
   compute screen-space bounding box of splat
   start at coarsest mip level that covers the bbox
   if bbox.minDepth > depthPyramid[tile]: cull (set all quad vertices outside clip space)
   ```
4. Alternative: use `gl_ClipDistance` or set position to NaN to cull

**Expected outcome:**
- 3–10× reduction in fragment shader invocations for enclosed scenes
- Significant FPS improvement in the Living Room scene

### Phase 4: Full SH Evaluation

**Goal:** View-dependent color via spherical harmonics up to degree 3.

**Implementation:**
1. Parse remaining SH coefficients from PLY (f_rest_0 through f_rest_44 = degrees 1–3 × 3 channels × 15 coefficients)
2. Store additional SH coefficients as vertex attributes (currently we only store f_dc_0..2)
3. Vertex shader: reconstruct view direction from camera position, evaluate SH basis functions
4. Add evaluated SH color to DC color for view-dependent specular

**Tradeoff:** Adds ~45 extra floats per vertex to GPU memory (for degree 1–3 SH). For 1M splats this is ~180 MB additional attribute data. Mitigate by:
- Only enabling for high/ultra quality
- Interleaving into a single buffer with optimized layout

### Phase 5: Chunked LOD Streaming

**Goal:** Handle arbitrarily large scenes within splat budget.

**Implementation:**
1. **Spatial partition:** Split splats into octree cells (e.g., 256³ or 512³ grid)
2. **Per-cell LOD:** Pre-compute subsampled versions (100%, 25%, 6%, 1.5%)
3. **Runtime selection:** Per frame, determine which cells are visible, select LOD based on screen-space size
4. **Streaming:** Load cell data from object storage asynchronously (`.sog` format chunks)
5. **Budget enforcement:** Track total rendered splats, drop to lower LOD for distant cells to stay within budget

### Phase 6: WebGPU Compute Pipeline

**Goal:** Use WebGPU compute shaders for sort and culling when available.

**Implementation:**
1. Detect WebGPU support (already have `isWebGPUAvailable()`)
2. Implement compute-shader radix/bitonic sort as alternative to WebGL transform feedback
3. Use compute shaders for depth pyramid generation
4. Fall back to WebGL 2.0 path when WebGPU unavailable

---

## 5. Detailed Implementation Spec: Phase 1 GPU Sort

### 5.1 Buffer Layout

**Splat Data Buffer** (uploaded once, never modified):
```
Interleaved: [pos.xyz | scale.xyz | rot.xyzw | SH_DC.rgb | SH_rest[45] | opacity] × N
Each vertex: 3+3+4+3+45+1 = 59 floats = 236 bytes
For 1M splats: ~236 MB
```

**Sort Key Buffer** (transform feedback, ping-pong A/B):
```
[packedDepth:uint32 | splatIndex:uint32] × N
8 bytes per entry, 8 MB for 1M splats × 2 buffers = 16 MB
```

**Histogram Buffer** (256 × 4 bytes = 1 KB per radix pass)

**Prefix Sum Buffer** (256 × 4 bytes = 1 KB)

### 5.2 Radix Sort Shader Pipeline

```
Frame Start:
1. Depth Compute Pass (VS: output packed depth + index → TF)
   - depth = uint(bits(float(dot(camDir, splatPos - camPos))))
   - index = gl_VertexID

2. For each radix digit (0..3 for 32-bit sort, processing 8 bits each):
   a. Histogram Pass:
      - Draw 256×1 point grid, each point reads sort buffer
      - For point at (x,0): count entries where (key >> (digit*8)) & 0xFF == x
      - Output: histogram[x] = count
   
   b. Prefix Sum Pass:
      - Single pass: scan(histogram) → offsets
      - output[x] = sum(input[0..x-1])

   c. Scatter Pass:
      - TF pass: read unsorted buffer, write to ping-pong buffer
      - For each (key, index): target = offsets[(key >> shift) & 0xFF]++
      - Output: partially sorted (key, index) pairs

3. Indirect Draw Pass:
   - Use sorted indices as ELEMENT_ARRAY_BUFFER
   - Draw with glDrawElements(GL_POINTS, N, GL_UNSIGNED_INT, 0)
```

### 5.3 WebGL 2.0 Compatibility

Transform feedback is supported in WebGL 2.0 (which is universally available). The main constraint:
- TF varyings must be `float`, `vec2`, `vec3`, `vec4` — we work around the uint need by packing as float (bit-cast with `uintBitsToFloat`/`floatBitsToUint`)

### 5.4 Fallback Path

When WebGL 2.0 TF is unavailable (extremely rare), fall back to the current CPU sort but with optimizations:
- Reuse buffers instead of allocating new ones
- Use `TypedArray.prototype.sort()` with pre-computed keys (faster than comparator sort)
- Sort only when camera has moved significantly (angular threshold)

---

## 6. Performance Targets

| Metric | Current | Phase 1 Target | Phase 3 Target | Full Overhaul |
|--------|---------|----------------|----------------|---------------|
| Sort time (1M splats) | ~80ms CPU | <1ms GPU | <1ms GPU | <0.5ms GPU |
| Frame time (Living Room) | ~45ms (22 fps) | ~10ms (60+ fps) | ~6ms (60+ fps) | ~4ms (60+ fps) |
| GC per frame | ~24 MB | 0 | 0 | 0 |
| Fragment invocations | ~600M | ~600M | ~60M | ~60M |
| Splat budget | CPU-bound at ~200k | ~1M | ~2M | ~5M+ |
| View-dependent color | No | No | No | Yes (SH deg 3) |

---

## 7. Migration Strategy

**Step-by-step, non-breaking:**

1. Create `GpuSorter` class in `packages/viewer-core/src/sort/GpuSorter.ts` — standalone, testable
2. Create `GpuGaussianRenderer` extending the current approach but with instanced quads
3. Keep `GsplatViewer` as the orchestrator, swap internal rendering backend
4. Feature-flag: `useGpuSort: boolean` in `ViewerOptions`, default `true` with auto-fallback
5. Keep existing shader/CPU sort as fallback path
6. Add comprehensive GPU capability detection (WebGL 2.0, TF support, max buffer size)

---

## 8. What We Keep

- Three.js as the WebGL abstraction layer (scenes, cameras, controls, markers)
- OrbitControls for navigation
- PLY parser (add SH degree 1–3 parsing)
- Marker/annotation system
- Quality presets and auto-quality
- Debug overlay
- VR support (WebXR API via Three.js)
- `.sog` detection (add ZIP decompression for actual loading)

---

## 9. Open Questions

1. **WebGPU priority:** Should Phase 6 (WebGPU compute) be accelerated to Phase 2, or is WebGL 2.0 TF sufficient for the diploma demo?
2. **SH evaluation:** Do any of the current demo scenes have SH degree > 0 data? If not, Phase 4 can be deferred.
3. **`.sog` format:** Should we implement `.sog` decompression (ZIP) as part of this overhaul, or keep it as a placeholder?
4. **LOD chunk pre-computation:** Should the worker handle chunking during the `splat.convert` job, or defer to a future milestone?
