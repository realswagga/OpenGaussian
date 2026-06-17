import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { captureGizmoCameraPose, restoreGizmoCameraPose } from '../markerGizmoCamera.js';

describe('marker gizmo camera lock', () => {
  it('restores the camera and orbit target after drag-time control updates', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(4, 3, 6);
    camera.lookAt(1, 0.5, -2);
    const orbitTarget = new THREE.Vector3(1, 0.5, -2);
    const pose = captureGizmoCameraPose(camera, orbitTarget);

    camera.position.set(4_000, -3_000, 6_000);
    camera.rotateY(Math.PI / 2);
    orbitTarget.set(2_000, 1_000, -4_000);

    restoreGizmoCameraPose(camera, orbitTarget, pose);

    assert.deepEqual(camera.position.toArray(), pose.position.toArray());
    assert.deepEqual(camera.quaternion.toArray(), pose.quaternion.toArray());
    assert.deepEqual(orbitTarget.toArray(), pose.orbitTarget.toArray());
  });

  it('captures independent values that marker movement cannot mutate', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(2, 4, 8);
    const orbitTarget = new THREE.Vector3(0, 1, 0);
    const pose = captureGizmoCameraPose(camera, orbitTarget);

    camera.position.multiplyScalar(1_000);
    orbitTarget.multiplyScalar(1_000);

    assert.deepEqual(pose.position.toArray(), [2, 4, 8]);
    assert.deepEqual(pose.orbitTarget.toArray(), [0, 1, 0]);
  });
});
