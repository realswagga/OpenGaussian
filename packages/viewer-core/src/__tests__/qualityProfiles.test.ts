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

  // Auto detection
  if (isMobile) {
    const memory = deviceMemory ?? 4;
    if (memory < 2) return 'phoneUltraLow';
    return memory >= 6 ? 'phoneHigh' : 'phoneLow';
  }

  // Desktop auto
  const memory = deviceMemory ?? 8;
  return memory >= 8 ? 'desktopHigh' : 'desktopMedium';
}

export function getQualityProfile(name: QualityProfileName): QualityProfile {
  return qualityProfiles[name];
}

describe('qualityProfiles', () => {
  it('has correct recalibrated budget values', () => {
    expect(qualityProfiles.phoneUltraLow.splatBudget).toBe(75_000);
    expect(qualityProfiles.phoneLow.splatBudget).toBe(150_000);
    expect(qualityProfiles.phoneHigh.splatBudget).toBe(300_000);
    expect(qualityProfiles.desktopMedium.splatBudget).toBe(1_500_000);
    expect(qualityProfiles.desktopHigh.splatBudget).toBe(3_000_000);
    expect(qualityProfiles.vrQuest.splatBudget).toBe(200_000);
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

  it('mobile profiles use mediump shader precision', () => {
    expect(qualityProfiles.phoneUltraLow.shaderPrecision).toBe('mediump');
    expect(qualityProfiles.phoneLow.shaderPrecision).toBe('mediump');
    expect(qualityProfiles.phoneHigh.shaderPrecision).toBe('mediump');
    expect(qualityProfiles.vrQuest.shaderPrecision).toBe('mediump');
  });

  it('desktop profiles use highp shader precision', () => {
    expect(qualityProfiles.desktopMedium.shaderPrecision).toBe('highp');
    expect(qualityProfiles.desktopHigh.shaderPrecision).toBe('highp');
  });

  it('mobile and VR profiles use 2σ or 2.5σ quad expansion', () => {
    expect(qualityProfiles.phoneUltraLow.sigmaScale).toBe(2.0);
    expect(qualityProfiles.phoneLow.sigmaScale).toBe(2.0);
    expect(qualityProfiles.phoneHigh.sigmaScale).toBe(2.5);
    expect(qualityProfiles.vrQuest.sigmaScale).toBe(2.0);
  });

  it('desktop profiles use 3σ quad expansion', () => {
    expect(qualityProfiles.desktopMedium.sigmaScale).toBe(3.0);
    expect(qualityProfiles.desktopHigh.sigmaScale).toBe(3.0);
  });

  it('adaptive budget is enabled for constrained profiles', () => {
    expect(qualityProfiles.phoneUltraLow.adaptiveBudgetEnabled).toBe(true);
    expect(qualityProfiles.phoneLow.adaptiveBudgetEnabled).toBe(true);
    expect(qualityProfiles.phoneHigh.adaptiveBudgetEnabled).toBe(true);
    expect(qualityProfiles.vrQuest.adaptiveBudgetEnabled).toBe(true);
  });

  it('adaptive budget is disabled for desktop profiles', () => {
    expect(qualityProfiles.desktopMedium.adaptiveBudgetEnabled).toBe(false);
    expect(qualityProfiles.desktopHigh.adaptiveBudgetEnabled).toBe(false);
  });

  it('target FPS matches expected values', () => {
    expect(qualityProfiles.phoneUltraLow.targetFps).toBe(30);
    expect(qualityProfiles.phoneLow.targetFps).toBe(30);
    expect(qualityProfiles.phoneHigh.targetFps).toBe(45);
    expect(qualityProfiles.desktopMedium.targetFps).toBe(60);
    expect(qualityProfiles.desktopHigh.targetFps).toBe(60);
    expect(qualityProfiles.vrQuest.targetFps).toBe(72);
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