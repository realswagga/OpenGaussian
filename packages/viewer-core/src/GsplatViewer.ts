import { PlayCanvasGsplatRuntime } from './PlayCanvasGsplatRuntime.js';
import type { MarkerPoint, CameraMode, QualityPreset, ViewerOptions, ViewerQuestPerfRuntimeOverrides, ViewerRuntime } from './types.js';

/**
 * Stable public viewer facade.
 *
 * The implementation is now PlayCanvas GSplat based so that runtime behavior
 * follows the SuperSplat pipeline: PlayCanvas `gsplat` assets, unified
 * rendering, SOG/LOD-compatible loading, and WebGL/WebGPU fallback.
 */
export class GsplatViewer {
  private runtime: ViewerRuntime;

  constructor(options: ViewerOptions) {
    this.runtime = new PlayCanvasGsplatRuntime(options);
  }

  start(): Promise<void> {
    return this.runtime.start();
  }

  destroy(): void {
    this.runtime.destroy();
  }

  setQuality(quality: QualityPreset): void {
    this.runtime.setQuality(quality);
  }

  setCameraMode(mode: CameraMode): void {
    this.runtime.setCameraMode(mode);
  }

  setMarkers(points: MarkerPoint[]): void {
    this.runtime.setMarkers(points);
  }

  /** @deprecated Use setMarkers. */
  setAnnotations(points: MarkerPoint[]): void {
    this.runtime.setAnnotations(points);
  }

  setQuestPerfEnabled(enabled: boolean): void {
    this.runtime.setQuestPerfEnabled(enabled);
  }

  setQuestPerfOverrides(overrides: ViewerQuestPerfRuntimeOverrides): void {
    this.runtime.setQuestPerfOverrides(overrides);
  }

  enterVr(): Promise<void> {
    return this.runtime.enterVr();
  }

  exitVr(): Promise<void> {
    return this.runtime.exitVr();
  }
}
