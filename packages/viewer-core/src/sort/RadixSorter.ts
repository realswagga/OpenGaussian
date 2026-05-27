/**
 * RadixSorter — zero-allocation GPU-style radix sort for (depth, index) pairs.
 *
 * Unlike JS Array.prototype.sort (which uses a comparator with O(n log n)
 * JS function-call overhead and creates temporary arrays), this radix sort:
 *
 *   - Pre-allocates all working buffers once
 *   - Sorts 32-bit keys + 32-bit values in O(4·n) = O(n) passes
 *   - Never allocates during sort (zero GC pressure)
 *   - Reuses the same TypedArrays across frames
 *
 * The key is a bit-cast of the view-space depth float into a uint32 so that
 * the unsigned integer sort order matches the float magnitude order (both
 * IEEE 754 floats and uint32 are monotonic for positive values, which
 * depth always is).
 *
 * Architecture matches a GPU radix sort:
 *   1. Histogram  (count keys per 8-bit digit)
 *   2. Prefix sum (turn counts into scatter offsets)
 *   3. Scatter    (write sorted pairs to ping-pong buffer)
 *   Repeat for 4 radix digits (8 bits each → 32-bit key).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A (key, value) pair stored as [key, value] in a flat Uint32Array. */
type KVBuffer = Uint32Array;

// ---------------------------------------------------------------------------
// Float ↔ uint32 bit-cast (no heap allocation)
// ---------------------------------------------------------------------------

const fbuf = new Float32Array(1);
const ubuf = new Uint32Array(fbuf.buffer);

function floatToSortKey(v: number): number {
  fbuf[0] = v;
  return ubuf[0];
}

// ---------------------------------------------------------------------------
// RadixSorter
// ---------------------------------------------------------------------------

export class RadixSorter {
  readonly capacity: number;

  private bufA: KVBuffer;
  private bufB: KVBuffer;
  private histogram: Uint32Array;
  private depths: Float32Array;
  private visibilityMask: Uint8Array | null = null;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.bufA = new Uint32Array(capacity * 2);
    this.bufB = new Uint32Array(capacity * 2);
    this.histogram = new Uint32Array(256);
    this.depths = new Float32Array(capacity);
  }

  setVisibilityMask(mask: Uint8Array | null): void {
    this.visibilityMask = mask;
  }

  /**
   * Resize internal buffers if new capacity > current.
   * Does NOT preserve existing data.
   */
  resize(newCapacity: number): void {
    if (newCapacity <= this.capacity) return;
    (this as any).capacity = newCapacity;
    this.bufA = new Uint32Array(newCapacity * 2);
    this.bufB = new Uint32Array(newCapacity * 2);
    this.depths = new Float32Array(newCapacity);
    this.visibilityMask = new Uint8Array(newCapacity);
    // histogram is always 256 — no resize needed
  }

  /**
   * Fill the sort buffer with (depth, index) pairs.
   *
   * `depths`  — Float32Array of view-space depth per splat (positive = in
   *             front of camera). Must be length N ≤ capacity.
   *
   * After this call, bufA contains [key₀, 0, key₁, 1, …] where keyᵢ is the
   * uint32 bit-cast of depthᵢ.
   */
  buildPairs(depths: Float32Array, N: number): number {
    const mask = this.visibilityMask;
    let visibleCount = 0;
    if (mask) {
      for (let i = 0; i < N; i++) {
        if (!mask[i]) {
          const off = visibleCount * 2;
          this.bufA[off] = floatToSortKey(depths[i]);
          this.bufA[off + 1] = i;
          visibleCount++;
        }
      }
    } else {
      for (let i = 0; i < N; i++) {
        const off = i * 2;
        this.bufA[off] = floatToSortKey(depths[i]);
        this.bufA[off + 1] = i;
      }
      visibleCount = N;
    }
    return visibleCount;
  }

  /**
   * Run the radix sort over N pairs in bufA.
   * Result is placed back in bufA, sorted by key ascending (far→near).
   * The `value` (original index) follows its key.
   */
  sort(N: number): void {
    if (N <= 1) return;

    const pairs = N * 2;

    // 4 passes, 8 bits each → 32-bit key
    for (let shift = 0; shift < 32; shift += 8) {
      // --- Histogram ---
      this.histogram.fill(0);
      for (let i = 0; i < pairs; i += 2) {
        const digit = (this.bufA[i] >>> shift) & 0xff;
        this.histogram[digit]++;
      }

      // --- Prefix sum (exclusive scan) ---
      let sum = 0;
      for (let b = 0; b < 256; b++) {
        const c = this.histogram[b];
        this.histogram[b] = sum;
        sum += c;
      }

      // --- Scatter: bufA → bufB ---
      for (let i = 0; i < pairs; i += 2) {
        const key = this.bufA[i];
        const val = this.bufA[i + 1];
        const digit = (key >>> shift) & 0xff;
        const dest = this.histogram[digit];
        this.histogram[digit] = dest + 1;
        const dOff = dest * 2;
        this.bufB[dOff] = key;
        this.bufB[dOff + 1] = val;
      }

      // Swap buffers for next pass
      const tmp = this.bufA;
      this.bufA = this.bufB;
      this.bufB = tmp;
    }

    // Result is now in bufA (sorted ascending by key)
    //
    // Key is float-bits → ascending uint = ascending float magnitude.
    // depth = distance from camera, so ascending = nearest first.
    //
    // For alpha blending we want BACK-TO-FRONT (farthest first, nearest last).
    // We can either reverse here or the consumer can read the index buffer
    // in reverse. We expose the sorted indices in far→near order so the
    // consumer simply reads bufA sequentially.
    //
    // Wait — ascending float = lowest depth first = nearest first.
    // For backward compatibility we want FAR→NEAR (back-to-front).
    // So we need DESCENDING order.
    //
    // Instead of another pass, we reverse the pairs in-place:
    for (let i = 0, j = pairs - 2; i < j; i += 2, j -= 2) {
      // swap key
      const tk = this.bufA[i];
      this.bufA[i] = this.bufA[j];
      this.bufA[j] = tk;
      // swap val
      const tv = this.bufA[i + 1];
      this.bufA[i + 1] = this.bufA[j + 1];
      this.bufA[j + 1] = tv;
    }
  }

  /**
   * Write sorted indices into a Uint32Array destination (must be ≥ N long).
   * Indices are in far→near order (back-to-front for alpha blending).
   */
  writeIndices(dest: Uint32Array, N: number): void {
    for (let i = 0; i < N; i++) {
      dest[i] = this.bufA[i * 2 + 1];
    }
  }

  /**
   * Convenience: compute depths, build pairs, sort, write indices.
   * Returns the number of elements sorted (= N).
   *
   * `depthsOut` is filled with the Float32 depths for reuse next frame
   * (caller should pre-allocate this to length ≥ N and reuse it).
   */
  sortDepths(
    positions: Float32Array,
    N: number,
    camPosX: number,
    camPosY: number,
    camPosZ: number,
    frustumPlanes?: Float32Array,
  ): { sortedIndices: Uint32Array; visibleCount: number } {
    const mask = this.visibilityMask;

    if (mask && frustumPlanes) {
      mask.fill(0);
      for (let i = 0; i < N; i++) {
        const px = positions[i * 3];
        const py = positions[i * 3 + 1];
        const pz = positions[i * 3 + 2];
        let inside = true;
        for (let p = 0; p < 6; p++) {
          const off = p * 4;
          const dist = frustumPlanes[off] * px + frustumPlanes[off + 1] * py + frustumPlanes[off + 2] * pz + frustumPlanes[off + 3];
          if (dist < 0) {
            inside = false;
            mask[i] = 1;
            break;
          }
        }
        if (!inside) {
          const dx = px - camPosX;
          const dy = py - camPosY;
          const dz = pz - camPosZ;
          this.depths[i] = dx * dx + dy * dy + dz * dz;
        }
      }
    }

    for (let i = 0; i < N; i++) {
      if (mask && mask[i]) continue;
      const dx = positions[i * 3] - camPosX;
      const dy = positions[i * 3 + 1] - camPosY;
      const dz = positions[i * 3 + 2] - camPosZ;
      this.depths[i] = dx * dx + dy * dy + dz * dz;
    }

    const visibleCount = this.buildPairs(this.depths, N);
    this.sort(visibleCount);

    return { sortedIndices: this.bufA, visibleCount };
  }

  /**
   * Get a reference to the internal sorted-pair buffer after sortDepths().
   * Pairs are [key, index] in far→near order.
   */
  getSortedPairs(): Uint32Array {
    return this.bufA;
  }

  /**
   * Get the pre-allocated depth working buffer.
   */
  getDepthBuffer(): Float32Array {
    return this.depths;
  }
}
