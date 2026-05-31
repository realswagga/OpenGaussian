import * as THREE from 'three';

// Minimal OrbitControls implementation for the viewer.
// Based on the standard Three.js OrbitControls pattern.

const _changeEvent = { type: 'change' } as const;

enum STATE {
  NONE = -1,
  ROTATE = 0,
  DOLLY = 1,
  PAN = 2,
}

export class OrbitControls {
  object: THREE.Camera;
  domElement: HTMLElement;

  enableDamping = false;
  dampingFactor = 0.1;
  enableRotate = true;
  enableZoom = true;
  enablePan = true;
  minDistance = 0.5;
  maxDistance = Infinity;
  maxPolarAngle = Math.PI;
  minPolarAngle = 0;

  private target = new THREE.Vector3();
  private state = STATE.NONE;
  private spherical = new THREE.Spherical();
  private sphericalDelta = new THREE.Spherical();
  private scale = 1;
  private panOffset = new THREE.Vector3();
  private isMouseDown = false;
  private pointers: PointerEvent[] = [];
  private pointerPos = new THREE.Vector2();
  private prevPointerPos = new THREE.Vector2();

  private listeners: Array<(event: { type: string }) => void> = [];

  constructor(camera: THREE.Camera, domElement: HTMLElement) {
    this.object = camera;
    this.domElement = domElement;

    // Set initial spherical from camera position
    const offset = new THREE.Vector3().copy(camera.position).sub(this.target);
    this.spherical.setFromVector3(offset);

    this.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.domElement.addEventListener('pointermove', this.onPointerMove);
    this.domElement.addEventListener('pointerup', this.onPointerUp);
    this.domElement.addEventListener('wheel', this.onWheel, { passive: false });
    this.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  addEventListener(_type: string, listener: (event: { type: string }) => void): void {
    this.listeners.push(listener);
  }

  removeEventListener(_type: string, listener: (event: { type: string }) => void): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  private dispatchChange(): void {
    for (const l of this.listeners) {
      l(_changeEvent);
    }
  }

  update(): boolean {
    const offset = new THREE.Vector3();
    const quat = new THREE.Quaternion().setFromUnitVectors(
      this.object.up,
      new THREE.Vector3(0, 1, 0),
    );
    const quatInverse = quat.clone().invert();

    const lastPosition = new THREE.Vector3().copy(this.object.position);
    const lastQuaternion = new THREE.Quaternion().copy(this.object.quaternion);

    // Apply rotation
    if (this.sphericalDelta.theta !== 0 || this.sphericalDelta.phi !== 0) {
      this.spherical.theta += this.sphericalDelta.theta;
      this.spherical.phi += this.sphericalDelta.phi;

      // Clamp polar angle
      this.spherical.phi = Math.max(
        this.minPolarAngle,
        Math.min(this.maxPolarAngle, this.spherical.phi),
      );

      this.spherical.makeSafe();
    }

    // Apply zoom
    if (this.scale !== 1) {
      this.spherical.radius *= this.scale;
      this.spherical.radius = Math.max(
        this.minDistance,
        Math.min(this.maxDistance, this.spherical.radius),
      );
      this.scale = 1;
    }

    // Apply pan
    this.target.add(this.panOffset);

    // Calculate new position
    offset.setFromSpherical(this.spherical);
    offset.applyQuaternion(quatInverse);
    this.object.position.copy(this.target).add(offset);
    this.object.lookAt(this.target);

    // Apply damping
    if (this.enableDamping) {
      this.sphericalDelta.theta *= 1 - this.dampingFactor;
      this.sphericalDelta.phi *= 1 - this.dampingFactor;
      this.panOffset.multiplyScalar(1 - this.dampingFactor);
    } else {
      this.sphericalDelta.set(0, 0, 0);
      this.panOffset.set(0, 0, 0);
    }

    if (
      !lastPosition.equals(this.object.position) ||
      !lastQuaternion.equals(this.object.quaternion)
    ) {
      this.dispatchChange();
      return true;
    }

    return false;
  }

  dispose(): void {
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.domElement.removeEventListener('wheel', this.onWheel);
    this.listeners = [];
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.isMouseDown && event.isPrimary) {
      this.isMouseDown = true;
      this.pointers = [event];
      this.prevPointerPos.copy({ x: event.clientX, y: event.clientY } as THREE.Vector2);
      this.state = STATE.ROTATE;
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.isMouseDown) return;

    const prevPos = this.prevPointerPos;
    const currPos = { x: event.clientX, y: event.clientY };

    const deltaX = currPos.x - prevPos.x;
    const deltaY = currPos.y - prevPos.y;

    this.prevPointerPos.copy(currPos as THREE.Vector2);

    if (this.state === STATE.ROTATE && this.enableRotate) {
      this.sphericalDelta.theta -= (1.6 * Math.PI * deltaX) / this.domElement.clientHeight;
      this.sphericalDelta.phi -= (1.6 * Math.PI * deltaY) / this.domElement.clientHeight;
    } else if (this.state === STATE.PAN && this.enablePan) {
      const panSpeed = 0.001;
      const offset = new THREE.Vector3();
      offset.copy(this.object.position).sub(this.target);
      const targetDistance = offset.length();

      const right = new THREE.Vector3();
      right.setFromMatrixColumn(this.object.matrix, 0);
      right.normalize();
      right.multiplyScalar(-deltaX * panSpeed * targetDistance);

      const up = new THREE.Vector3();
      up.setFromMatrixColumn(this.object.matrix, 1);
      up.normalize();
      up.multiplyScalar(deltaY * panSpeed * targetDistance);

      this.panOffset.add(right).add(up);
    }
  };

  private onPointerUp = (): void => {
    this.isMouseDown = false;
    this.state = STATE.NONE;
    this.pointers = [];
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (!this.enableZoom) return;

    const delta = event.deltaY > 0 ? 1.1 : 0.9;
    this.scale *= delta;
  };
}