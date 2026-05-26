export interface MarkerPlacementInput {
  positions: ArrayLike<number>;
  rayOrigin: readonly [number, number, number];
  rayDirection: readonly [number, number, number];
  sceneRadius?: number;
  snapValue?: number | null;
  minSearchRadius?: number;
  maxSearchRadius?: number;
}

export interface MarkerPlacementHit {
  position: [number, number, number];
  pointIndex: number;
  distanceAlongRay: number;
  perpendicularDistance: number;
  searchRadius: number;
}

function isFiniteVec3(x: number | undefined, y: number | undefined, z: number | undefined): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}

function snap(value: number, snapValue: number | null | undefined): number {
  if (!snapValue || !Number.isFinite(snapValue) || snapValue <= 0) return value;
  return Math.round(value / snapValue) * snapValue;
}

export function pickMarkerPoint(input: MarkerPlacementInput): MarkerPlacementHit | null {
  const { positions, rayOrigin, rayDirection } = input;
  if (!positions || positions.length < 3) return null;

  const [ox, oy, oz] = rayOrigin;
  let [dx, dy, dz] = rayDirection;
  if (!isFiniteVec3(ox, oy, oz) || !isFiniteVec3(dx, dy, dz)) return null;

  const dirLength = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(dirLength) || dirLength <= 0) return null;
  dx /= dirLength;
  dy /= dirLength;
  dz /= dirLength;

  const sceneRadius = Number.isFinite(input.sceneRadius) && input.sceneRadius! > 0 ? input.sceneRadius! : 1;
  const minRadius = input.minSearchRadius ?? Math.max(sceneRadius * 0.0025, 0.015);
  const maxRadius = input.maxSearchRadius ?? Math.max(minRadius, Math.min(sceneRadius * 0.045, 0.75));
  const radiusSteps: number = 6;

  for (let step = 0; step < radiusSteps; step += 1) {
    const tStep = radiusSteps === 1 ? 1 : step / (radiusSteps - 1);
    const radius = minRadius + (maxRadius - minRadius) * tStep;
    const radiusSq = radius * radius;
    let best: Omit<MarkerPlacementHit, 'position'> & { rawPosition: [number, number, number] } | null = null;

    for (let i = 0; i < positions.length - 2; i += 3) {
      const px = positions[i]!;
      const py = positions[i + 1]!;
      const pz = positions[i + 2]!;
      if (!isFiniteVec3(px, py, pz)) continue;

      const vx = px - ox;
      const vy = py - oy;
      const vz = pz - oz;
      const distanceAlongRay = vx * dx + vy * dy + vz * dz;
      if (distanceAlongRay <= 0) continue;

      const distSq = vx * vx + vy * vy + vz * vz;
      const perpendicularSq = Math.max(0, distSq - distanceAlongRay * distanceAlongRay);
      if (perpendicularSq > radiusSq) continue;

      const perpendicularDistance = Math.sqrt(perpendicularSq);
      if (
        !best ||
        distanceAlongRay < best.distanceAlongRay - 1e-6 ||
        (Math.abs(distanceAlongRay - best.distanceAlongRay) <= 1e-6 && perpendicularDistance < best.perpendicularDistance)
      ) {
        best = {
          rawPosition: [px, py, pz],
          pointIndex: i / 3,
          distanceAlongRay,
          perpendicularDistance,
          searchRadius: radius,
        };
      }
    }

    if (best) {
      const [px, py, pz] = best.rawPosition;
      return {
        pointIndex: best.pointIndex,
        distanceAlongRay: best.distanceAlongRay,
        perpendicularDistance: best.perpendicularDistance,
        searchRadius: best.searchRadius,
        position: [
          snap(px, input.snapValue),
          snap(py, input.snapValue),
          snap(pz, input.snapValue),
        ],
      };
    }
  }

  return null;
}
