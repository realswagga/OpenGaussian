export interface DepthAwareDollyInput {
  deltaY: number;
  deltaMode?: number;
  hitDepth: number;
  sceneRadius: number;
  minStep?: number;
  maxStep?: number;
}

export interface GesturePoint {
  x: number;
  y: number;
}

export interface DepthConsensusInput {
  samples: readonly number[];
  fallbackDepth: number;
  minSamples?: number;
  maxRelativeSpread?: number;
}

export interface DepthConsensus {
  distance: number;
  confidence: number;
  sampleCount: number;
  relativeSpread: number;
}

export interface TwoPointerGestureInput {
  previousDistance: number;
  currentDistance: number;
  previousCenter: GesturePoint;
  currentCenter: GesturePoint;
  scaleThresholdPx?: number;
  panThresholdPx?: number;
}

export type TwoPointerGesture = 'none' | 'dolly' | 'pan';

export interface GamepadStick {
  x: number;
  y: number;
  source: 'primary' | 'secondary';
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeWheelDeltaY(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY)) return 0;
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * 600;
  return deltaY;
}

export function computeDepthAwareDollyStep(input: DepthAwareDollyInput): number {
  const sceneRadius = Number.isFinite(input.sceneRadius) && input.sceneRadius > 0 ? input.sceneRadius : 1;
  const hitDepth = Number.isFinite(input.hitDepth) && input.hitDepth > 0 ? input.hitDepth : sceneRadius;
  const minStep = input.minStep ?? Math.max(sceneRadius * 0.002, 0.01);
  const maxStep = input.maxStep ?? Math.max(sceneRadius * 0.25, 0.5);
  const normalizedDelta = normalizeWheelDeltaY(input.deltaY, input.deltaMode);
  const wheelUnits = clamp(-normalizedDelta / 100, -4, 4);
  if (Math.abs(wheelUnits) < 1e-6) return 0;

  const magnitude = clamp(Math.abs(wheelUnits) * hitDepth * 0.1, minStep, maxStep);
  return Math.sign(wheelUnits) * magnitude;
}

function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) * 0.5
    : (sorted[mid] ?? 0);
}

export function computeDepthConsensus(input: DepthConsensusInput): DepthConsensus {
  const fallbackDepth = Number.isFinite(input.fallbackDepth) && input.fallbackDepth > 0 ? input.fallbackDepth : 1;
  const minSamples = input.minSamples ?? 3;
  const maxRelativeSpread = input.maxRelativeSpread ?? 0.65;
  const samples = input.samples
    .filter((sample) => Number.isFinite(sample) && sample > 0)
    .slice()
    .sort((a, b) => a - b);

  if (samples.length === 0) {
    return {
      distance: fallbackDepth,
      confidence: 0,
      sampleCount: 0,
      relativeSpread: Number.POSITIVE_INFINITY,
    };
  }

  const distance = median(samples);
  const q1 = samples[Math.floor((samples.length - 1) * 0.25)] ?? distance;
  const q3 = samples[Math.ceil((samples.length - 1) * 0.75)] ?? distance;
  const relativeSpread = distance > 0 ? Math.abs(q3 - q1) / distance : Number.POSITIVE_INFINITY;
  const coverage = clamp(samples.length / Math.max(1, minSamples), 0, 1);
  const stability = clamp(1 - relativeSpread / Math.max(0.01, maxRelativeSpread), 0, 1);

  return {
    distance,
    confidence: coverage * stability,
    sampleCount: samples.length,
    relativeSpread,
  };
}

export function distance2D(a: GesturePoint, b: GesturePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function center2D(a: GesturePoint, b: GesturePoint): GesturePoint {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}

export function classifyTwoPointerGesture(input: TwoPointerGestureInput): TwoPointerGesture {
  const scaleThreshold = input.scaleThresholdPx ?? 4;
  const panThreshold = input.panThresholdPx ?? 2;
  const distanceDelta = Math.abs(input.currentDistance - input.previousDistance);
  if (distanceDelta >= scaleThreshold) return 'dolly';

  const centerDelta = distance2D(input.previousCenter, input.currentCenter);
  if (centerDelta >= panThreshold) return 'pan';

  return 'none';
}

export function applyDeadzone(value: number, deadzone = 0.15): number {
  if (!Number.isFinite(value)) return 0;
  const abs = Math.abs(value);
  if (abs <= deadzone) return 0;
  return Math.sign(value) * ((abs - deadzone) / Math.max(1e-6, 1 - deadzone));
}

export function readGamepadStick(
  gamepad: Pick<Gamepad, 'axes'> | null | undefined,
  deadzone = 0.15,
): GamepadStick {
  const axes = gamepad?.axes;
  if (!axes || axes.length === 0) return { x: 0, y: 0, source: 'primary' };

  const secondaryX = axes.length >= 4 ? axes[2] ?? 0 : 0;
  const secondaryY = axes.length >= 4 ? axes[3] ?? 0 : 0;
  const primaryX = axes[0] ?? 0;
  const primaryY = axes[1] ?? 0;
  const useSecondary = axes.length >= 4 && (
    Math.abs(secondaryX) > deadzone ||
    Math.abs(secondaryY) > deadzone ||
    (Math.abs(primaryX) <= deadzone && Math.abs(primaryY) <= deadzone)
  );

  return {
    x: applyDeadzone(useSecondary ? secondaryX : primaryX, deadzone),
    y: applyDeadzone(useSecondary ? secondaryY : primaryY, deadzone),
    source: useSecondary ? 'secondary' : 'primary',
  };
}

export function computePinchScale(startDistance: number, currentDistance: number, minScale = 0.25, maxScale = 4): number {
  if (!Number.isFinite(startDistance) || !Number.isFinite(currentDistance) || startDistance <= 0 || currentDistance <= 0) {
    return 1;
  }
  return clamp(currentDistance / startDistance, minScale, maxScale);
}
