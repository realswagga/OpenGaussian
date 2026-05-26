import { describe, it, expect } from 'vitest';
import { chooseRendererMode } from '../types.js';

describe('chooseRendererMode', () => {
  it('returns webgl2 when VR is requested regardless of WebGPU support', () => {
    expect(chooseRendererMode({ requested: 'auto', isVrRequested: true, webgpuSupported: true })).toBe('webgl2');
    expect(chooseRendererMode({ requested: 'webgpu', isVrRequested: true, webgpuSupported: true })).toBe('webgl2');
    expect(chooseRendererMode({ requested: 'webgl2', isVrRequested: true, webgpuSupported: true })).toBe('webgl2');
  });

  it('returns webgpu when explicitly requested and supported', () => {
    expect(chooseRendererMode({ requested: 'webgpu', isVrRequested: false, webgpuSupported: true })).toBe('webgpu');
  });

  it('prefers webgl2 in auto mode for visual stability', () => {
    expect(chooseRendererMode({ requested: 'auto', isVrRequested: false, webgpuSupported: true })).toBe('webgl2');
    expect(chooseRendererMode({ requested: 'auto', isVrRequested: false, webgpuSupported: false })).toBe('webgl2');
  });

  it('falls back to webgl2 when webgpu is not supported', () => {
    expect(chooseRendererMode({ requested: 'webgpu', isVrRequested: false, webgpuSupported: false })).toBe('webgl2');
  });

  it('returns webgl2 when explicitly requested', () => {
    expect(chooseRendererMode({ requested: 'webgl2', isVrRequested: false, webgpuSupported: true })).toBe('webgl2');
    expect(chooseRendererMode({ requested: 'webgl2', isVrRequested: false, webgpuSupported: false })).toBe('webgl2');
  });

  it('VR takes priority over all other options', () => {
    expect(chooseRendererMode({ requested: 'webgpu', isVrRequested: true, webgpuSupported: true })).toBe('webgl2');
    expect(chooseRendererMode({ requested: 'auto', isVrRequested: true, webgpuSupported: false })).toBe('webgl2');
  });
});
