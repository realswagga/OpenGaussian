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
  /** Number of elements this sorter was initialized for. */
  readonly capacity: number;

  // Ping-pong sort buffers: each holds N pairs [key0, val0, key1, val1, ...]
  private bufA: KVBuffer;
  private bufB: KVBuffer;

  // 256-bin histogram + prefix-sum buffer (reused across passes)
  private histogram: Uint32Array;

  // Scratch depth array for converting float→uint key
  private depths: Float32Array;

  constructor(capacity: number) {
    this.capacity = capacity;
    // Each entry = 2 uint32s (key + index)
    this.bufA = new Uint32Array(capacity * 2);
    this.bufB = new Uint32Array(capacity * 2);
    this.histogram = new Uint32Array(256);
    this.depths = new Float32Array(capacity);
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
  buildPairs(depths: Float32Array, N: number): void {
    for (let i = 0; i < N; i++) {
      const off = i * 2;
      this.bufA[off] = floatToSortKey(depths[i]);
      this.bufA[off + 1] = i;
    }
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
  ): Uint32Array {
    // Compute view-space depths (distance² — cheaper than sqrt)
    for (let i = 0; i < N; i++) {
      const dx = positions[i * 3] - camPosX;
      const dy = positions[i * 3 + 1] - camPosY;
      const dz = positions[i * 3 + 2] - camPosZ;
      this.depths[i] = dx * dx + dy * dy + dz * dz;
    }

    this.buildPairs(this.depths, N);
    this.sort(N);

    // Return the raw sorted key-value buffer so caller can read indices
    // without another copy. Format: [key₀, idx₀, key₁, idx₁, …] far→near.
    return this.bufA;
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
