import type * as THREE from 'three';

export interface FrozenGizmoCameraPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  orbitTarget: THREE.Vector3;
}

export function captureGizmoCameraPose(
  camera: THREE.Camera,
  orbitTarget: THREE.Vector3,
): FrozenGizmoCameraPose {
  return {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    orbitTarget: orbitTarget.clone(),
  };
}

export function restoreGizmoCameraPose(
  camera: THREE.Camera,
  orbitTarget: THREE.Vector3,
  pose: FrozenGizmoCameraPose,
) {
  camera.position.copy(pose.position);
  camera.quaternion.copy(pose.quaternion);
  orbitTarget.copy(pose.orbitTarget);
}
