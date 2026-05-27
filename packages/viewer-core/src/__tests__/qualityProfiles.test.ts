import { describe, it, expect } from 'vitest';
import { qualityProfiles, type QualityPreset, type QualityProfile, type QualityProfileName } from '../types.js';

export function detectBestQuality(
  preset: QualityPreset,
  isMobile: boolean,
  isVr: boolean,
  deviceMemory?: number,
): QualityProfileName {
  if (isVr) {
    return 'vrQuest';
  }

  if (preset !== 'auto') {
    if (preset === 'low') return 'phoneLow';
    if (preset === 'medium') return 'phoneHigh';
    if (preset === 'high') return 'desktopMedium';
    if (preset === 'ultra') return 'desktopHigh';
  }

  if (isMobile) {
    const memory = deviceMemory ?? 4;
    if (memory < 2) return 'phoneUltraLow';
    return memory >= 6 ? 'phoneHigh' : 'phoneLow';
  }

  const memory = deviceMemory ?? 8;
  return memory >= 8 ? 'desktopHigh' : 'desktopMedium';
}

export function getQualityProfile(name: QualityProfileName): QualityProfile {
  return qualityProfiles[name];
}

describe('qualityProfiles', () => {
  it('has aggressive production budget values', () => {
    expect(qualityProfiles.phoneUltraLow.splatBudget).toBe(40_000);
    expect(qualityProfiles.phoneLow.splatBudget).toBe(75_000);
    expect(qualityProfiles.phoneHigh.splatBudget).toBe(250_000);
    expect(qualityProfiles.desktopMedium.splatBudget).toBe(900_000);
    expect(qualityProfiles.desktopHigh.splatBudget).toBe(3_000_000);
    expect(qualityProfiles.vrQuest.splatBudget).toBe(120_000);
  });

  it('phone profiles have no post processing', () => {
    expect(qualityProfiles.phoneUltraLow.enablePostFx).toBe(false);
    expect(qualityProfiles.phoneLow.enablePostFx).toBe(false);
    expect(qualityProfiles.phoneHigh.enablePostFx).toBe(false);
  });

  it('desktop high has post processing', () => {
    expect(qualityProfiles.desktopMedium.enablePostFx).toBe(true);
    expect(qualityProfiles.desktopHigh.enablePostFx).toBe(true);
  });

  it('VR profile has no post processing', () => {
    expect(qualityProfiles.vrQuest.enablePostFx).toBe(false);
  });

  it('marker distance limits increase with quality', () => {
    const limits = [
      qualityProfiles.phoneUltraLow.markerDistanceLimit,
      qualityProfiles.phoneLow.markerDistanceLimit,
      qualityProfiles.phoneHigh.markerDistanceLimit,
      qualityProfiles.desktopMedium.markerDistanceLimit,
      qualityProfiles.desktopHigh.markerDistanceLimit,
    ];
    for (let i = 1; i < limits.length; i++) {
      expect(limits[i]!).toBeGreaterThanOrEqual(limits[i - 1]!);
    }
  });

  it('maps antialiasing only to the highest quality profile', () => {
    expect(qualityProfiles.phoneUltraLow.antialias).toBe(false);
    expect(qualityProfiles.phoneLow.antialias).toBe(false);
    expect(qualityProfiles.phoneHigh.antialias).toBe(false);
    expect(qualityProfiles.desktopMedium.antialias).toBe(false);
    expect(qualityProfiles.desktopHigh.antialias).toBe(true);
  });

  it('low profiles use aggressive PlayCanvas culling knobs', () => {
    expect(qualityProfiles.phoneUltraLow.minPixelSize).toBe(4);
    expect(qualityProfiles.phoneLow.minPixelSize).toBe(3.25);
    expect(qualityProfiles.phoneUltraLow.minContribution).toBe(12);
    expect(qualityProfiles.phoneLow.minContribution).toBe(8);
    expect(qualityProfiles.phoneUltraLow.alphaClip).toBeCloseTo(1 / 48);
    expect(qualityProfiles.phoneLow.alphaClip).toBeCloseTo(1 / 64);
  });

  it('desktop profiles retain higher quality culling thresholds', () => {
    expect(qualityProfiles.desktopMedium.minPixelSize).toBe(1.25);
    expect(qualityProfiles.desktopHigh.minPixelSize).toBe(0.75);
    expect(qualityProfiles.desktopMedium.minContribution).toBe(2);
    expect(qualityProfiles.desktopHigh.minContribution).toBe(1);
    expect(qualityProfiles.desktopMedium.alphaClip).toBeCloseTo(1 / 255);
    expect(qualityProfiles.desktopHigh.alphaClip).toBeCloseTo(1 / 255);
  });

  it('low profiles bias toward coarse LOD levels early', () => {
    expect(qualityProfiles.phoneUltraLow.lodBaseDistanceScale).toBe(0.12);
    expect(qualityProfiles.phoneUltraLow.lodMultiplier).toBe(2.25);
    expect(qualityProfiles.phoneUltraLow.lodRange).toEqual([3, 3]);
    expect(qualityProfiles.phoneLow.lodBaseDistanceScale).toBe(0.15);
    expect(qualityProfiles.phoneLow.lodMultiplier).toBe(2.5);
    expect(qualityProfiles.phoneLow.lodRange).toEqual([2, 3]);
  });

  it('high profiles allow full LOD range and high quality SH', () => {
    expect(qualityProfiles.phoneHigh.lodRange).toEqual([1, 3]);
    expect(qualityProfiles.desktopMedium.lodRange).toEqual([0, 3]);
    expect(qualityProfiles.desktopHigh.lodRange).toEqual([0, 3]);
    expect(qualityProfiles.desktopMedium.highQualitySH).toBe(true);
    expect(qualityProfiles.desktopHigh.highQualitySH).toBe(true);
  });

  it('adaptive quality is enabled across presets', () => {
    expect(qualityProfiles.phoneUltraLow.adaptiveQualityEnabled).toBe(true);
    expect(qualityProfiles.phoneLow.adaptiveQualityEnabled).toBe(true);
    expect(qualityProfiles.phoneHigh.adaptiveQualityEnabled).toBe(true);
    expect(qualityProfiles.desktopMedium.adaptiveQualityEnabled).toBe(true);
    expect(qualityProfiles.desktopHigh.adaptiveQualityEnabled).toBe(true);
    expect(qualityProfiles.vrQuest.adaptiveQualityEnabled).toBe(true);
  });

  it('target FPS matches expected values', () => {
    expect(qualityProfiles.phoneUltraLow.targetFps).toBe(30);
    expect(qualityProfiles.phoneLow.targetFps).toBe(30);
    expect(qualityProfiles.phoneHigh.targetFps).toBe(45);
    expect(qualityProfiles.desktopMedium.targetFps).toBe(60);
    expect(qualityProfiles.desktopHigh.targetFps).toBe(60);
    expect(qualityProfiles.vrQuest.targetFps).toBe(72);
  });

  it('uses render-on-demand outside VR and prefers WebGPU on desktop', () => {
    expect(qualityProfiles.phoneUltraLow.renderOnDemand).toBe(true);
    expect(qualityProfiles.phoneLow.renderOnDemand).toBe(true);
    expect(qualityProfiles.desktopMedium.renderOnDemand).toBe(true);
    expect(qualityProfiles.desktopHigh.renderOnDemand).toBe(true);
    expect(qualityProfiles.vrQuest.renderOnDemand).toBe(false);
    expect(qualityProfiles.desktopMedium.preferredRenderer).toBe('webgpu');
    expect(qualityProfiles.desktopHigh.preferredRenderer).toBe('webgpu');
    expect(qualityProfiles.vrQuest.preferredRenderer).toBe('webgl2');
  });
});

describe('detectBestQuality', () => {
  it('returns vrQuest for VR regardless of other flags', () => {
    expect(detectBestQuality('auto', false, true, 8)).toBe('vrQuest');
    expect(detectBestQuality('ultra', false, true, 16)).toBe('vrQuest');
    expect(detectBestQuality('auto', true, true, 2)).toBe('vrQuest');
  });

  it('returns phoneUltraLow for auto mobile with very low memory', () => {
    expect(detectBestQuality('auto', true, false, 1)).toBe('phoneUltraLow');
  });

  it('returns phoneLow for auto mobile with low memory', () => {
    expect(detectBestQuality('auto', true, false, 2)).toBe('phoneLow');
    expect(detectBestQuality('auto', true, false, 4)).toBe('phoneLow');
  });

  it('returns phoneHigh for auto mobile with high memory', () => {
    expect(detectBestQuality('auto', true, false, 6)).toBe('phoneHigh');
    expect(detectBestQuality('auto', true, false, 8)).toBe('phoneHigh');
  });

  it('returns desktopHigh for auto desktop with high memory', () => {
    expect(detectBestQuality('auto', false, false, 8)).toBe('desktopHigh');
    expect(detectBestQuality('auto', false, false, 16)).toBe('desktopHigh');
  });

  it('returns desktopMedium for auto desktop with low memory', () => {
    expect(detectBestQuality('auto', false, false, 4)).toBe('desktopMedium');
  });

  it('maps explicit presets correctly', () => {
    expect(detectBestQuality('low', false, false)).toBe('phoneLow');
    expect(detectBestQuality('medium', false, false)).toBe('phoneHigh');
    expect(detectBestQuality('high', false, false)).toBe('desktopMedium');
    expect(detectBestQuality('ultra', false, false)).toBe('desktopHigh');
  });
});

describe('getQualityProfile', () => {
  it('returns correct profile for each name', () => {
    expect(getQualityProfile('phoneUltraLow')).toEqual(qualityProfiles.phoneUltraLow);
    expect(getQualityProfile('phoneLow')).toEqual(qualityProfiles.phoneLow);
    expect(getQualityProfile('desktopHigh')).toEqual(qualityProfiles.desktopHigh);
    expect(getQualityProfile('vrQuest')).toEqual(qualityProfiles.vrQuest);
  });
});
