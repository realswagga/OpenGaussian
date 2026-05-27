export class FrustumCuller {
  private planes = new Float32Array(24);

  extractFromMatrices(projection: Float32Array, viewInverse: Float32Array): Float32Array {
    const vp = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += projection[i * 4 + k]! * viewInverse[k * 4 + j]!;
        }
        vp[i * 4 + j] = sum;
      }
    }

    const p = this.planes;
    p[0]  = vp[3]! - vp[0]!;
    p[1]  = vp[7]! - vp[4]!;
    p[2]  = vp[11]! - vp[8]!;
    p[3]  = vp[15]! - vp[12]!;

    p[4]  = vp[3]! + vp[0]!;
    p[5]  = vp[7]! + vp[4]!;
    p[6]  = vp[11]! + vp[8]!;
    p[7]  = vp[15]! + vp[12]!;

    p[8]  = vp[3]! + vp[1]!;
    p[9]  = vp[7]! + vp[5]!;
    p[10] = vp[11]! + vp[9]!;
    p[11] = vp[15]! + vp[13]!;

    p[12] = vp[3]! - vp[1]!;
    p[13] = vp[7]! - vp[5]!;
    p[14] = vp[11]! - vp[9]!;
    p[15] = vp[15]! - vp[13]!;

    p[16] = vp[3]! - vp[2]!;
    p[17] = vp[7]! - vp[6]!;
    p[18] = vp[11]! - vp[10]!;
    p[19] = vp[15]! - vp[14]!;

    p[20] = vp[3]! + vp[2]!;
    p[21] = vp[7]! + vp[6]!;
    p[22] = vp[11]! + vp[10]!;
    p[23] = vp[15]! + vp[14]!;

    for (let i = 0; i < 6; i++) {
      const off = i * 4;
      const len = Math.sqrt(p[off]! * p[off]! + p[off + 1]! * p[off + 1]! + p[off + 2]! * p[off + 2]!);
      if (len > 0) {
        p[off] = p[off]! / len;
        p[off + 1] = p[off + 1]! / len;
        p[off + 2] = p[off + 2]! / len;
        p[off + 3] = p[off + 3]! / len;
      }
    }

    return this.planes;
  }

  isPointVisible(x: number, y: number, z: number): boolean {
    const p = this.planes;
    for (let i = 0; i < 6; i++) {
      const off = i * 4;
      if (p[off]! * x + p[off + 1]! * y + p[off + 2]! * z + p[off + 3]! < 0) {
        return false;
      }
    }
    return true;
  }

  computeVisibilityMask(positions: Float32Array, N: number, mask: Uint8Array): number {
    let visibleCount = 0;
    for (let i = 0; i < N; i++) {
      const px = positions[i * 3]!;
      const py = positions[i * 3 + 1]!;
      const pz = positions[i * 3 + 2]!;
      mask[i] = this.isPointVisible(px, py, pz) ? 0 : 1;
      if (mask[i] === 0) visibleCount++;
    }
    return visibleCount;
  }
}