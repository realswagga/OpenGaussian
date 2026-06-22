export interface VrVector3 {
  x: number;
  y: number;
  z: number;
}

export interface VrMarkerHitTarget {
  id: string;
  center: VrVector3;
  radius: number;
}

export interface VrMarkerRayHit {
  id: string;
  distance: number;
}

export function intersectRaySphereDistance(
  origin: VrVector3,
  direction: VrVector3,
  center: VrVector3,
  radius: number,
  maxDistance = Number.POSITIVE_INFINITY,
): number | null {
  const directionLength = Math.sqrt(direction.x ** 2 + direction.y ** 2 + direction.z ** 2);
  if (!Number.isFinite(directionLength) || directionLength <= 1e-8 || !Number.isFinite(radius) || radius <= 0) {
    return null;
  }

  const dx = direction.x / directionLength;
  const dy = direction.y / directionLength;
  const dz = direction.z / directionLength;
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const projection = ox * dx + oy * dy + oz * dz;
  const discriminant = projection * projection - (ox * ox + oy * oy + oz * oz - radius * radius);
  if (discriminant < 0) return null;

  const root = Math.sqrt(discriminant);
  const near = -projection - root;
  const far = -projection + root;
  const distance = near >= 0 ? near : far >= 0 ? far : null;
  if (distance === null || distance > maxDistance) return null;
  return distance;
}

export function pickVrMarkerByRay(
  origin: VrVector3,
  direction: VrVector3,
  targets: readonly VrMarkerHitTarget[],
  maxDistance = 8,
): VrMarkerRayHit | null {
  let nearest: VrMarkerRayHit | null = null;
  for (const target of targets) {
    const distance = intersectRaySphereDistance(origin, direction, target.center, target.radius, maxDistance);
    if (distance !== null && (!nearest || distance < nearest.distance)) {
      nearest = { id: target.id, distance };
    }
  }
  return nearest;
}

export function horizontalYawDeltaDegrees(currentForward: VrVector3, desiredForward: VrVector3): number {
  const currentLength = Math.hypot(currentForward.x, currentForward.z);
  const desiredLength = Math.hypot(desiredForward.x, desiredForward.z);
  if (currentLength <= 1e-8 || desiredLength <= 1e-8) return 0;
  const currentHeading = Math.atan2(currentForward.x / currentLength, currentForward.z / currentLength);
  const desiredHeading = Math.atan2(desiredForward.x / desiredLength, desiredForward.z / desiredLength);
  let delta = (desiredHeading - currentHeading) * 180 / Math.PI;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}
