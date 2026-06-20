import { describe, it, expect } from 'vitest';
import { chooseRendererMode } from '../types.js';

describe('chooseRendererMode', () => {
  it('forces webgl2 only while a VR session is active', () => {
    expect(chooseRendererMode({ requested: 'auto', isVrActive: true, webgpuSupported: true, preferred: 'webgpu' })).toBe('webgl2');
    expect(chooseRendererMode({ requested: 'webgpu', isVrActive: true, webgpuSupported: true })).toBe('webgl2');
    expect(chooseRendererMode({ requested: 'webgl2', isVrActive: true, webgpuSupported: true })).toBe('webgl2');
  });

  it('returns webgpu when explicitly requested and supported', () => {
    expect(chooseRendererMode({ requested: 'webgpu', isVrActive: false, webgpuSupported: true })).toBe('webgpu');
  });

  it('uses preferred renderer in auto mode', () => {
    expect(chooseRendererMode({ requested: 'auto', isVrActive: false, webgpuSupported: true, preferred: 'webgpu' })).toBe('webgpu');
    expect(chooseRendererMode({ requested: 'auto', isVrActive: false, webgpuSupported: true, preferred: 'webgl2' })).toBe('webgl2');
    expect(chooseRendererMode({ requested: 'auto', isVrActive: false, webgpuSupported: false, preferred: 'webgpu' })).toBe('webgl2');
  });

  it('falls back to webgl2 when webgpu is not supported', () => {
    expect(chooseRendererMode({ requested: 'webgpu', isVrActive: false, webgpuSupported: false })).toBe('webgl2');
  });

  it('returns webgl2 when explicitly requested', () => {
    expect(chooseRendererMode({ requested: 'webgl2', isVrActive: false, webgpuSupported: true })).toBe('webgl2');
    expect(chooseRendererMode({ requested: 'webgl2', isVrActive: false, webgpuSupported: false })).toBe('webgl2');
  });

  it('defaults to WebGPU in auto mode when supported', () => {
    expect(chooseRendererMode({ requested: 'auto', isVrActive: false, webgpuSupported: true })).toBe('webgpu');
    expect(chooseRendererMode({ requested: 'auto', isVrActive: false, webgpuSupported: false })).toBe('webgl2');
  });

  it('does not let inactive VR availability block WebGPU when explicitly requested', () => {
    expect(chooseRendererMode({ requested: 'auto', isVrActive: false, webgpuSupported: true, preferred: 'webgpu' })).toBe('webgpu');
    expect(chooseRendererMode({ requested: 'webgpu', isVrActive: false, webgpuSupported: true })).toBe('webgpu');
  });
});
