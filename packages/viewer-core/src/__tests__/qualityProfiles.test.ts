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
  it('has correct budget values', () => {
    expect(qualityProfiles.phoneLow.splatBudget).toBe(400_000);
    expect(qualityProfiles.phoneHigh.splatBudget).toBe(800_000);
    expect(qualityProfiles.desktopMedium.splatBudget).toBe(1_500_000);
    expect(qualityProfiles.desktopHigh.splatBudget).toBe(3_000_000);
    expect(qualityProfiles.vrQuest.splatBudget).toBe(700_000);
  });

  it('phone profiles have no post processing', () => {
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
    expect(qualityProfiles.phoneLow.antialias).toBe(false);
    expect(qualityProfiles.phoneHigh.antialias).toBe(false);
    expect(qualityProfiles.desktopMedium.antialias).toBe(false);
    expect(qualityProfiles.desktopHigh.antialias).toBe(true);
  });
});

describe('detectBestQuality', () => {
  it('returns vrQuest for VR regardless of other flags', () => {
    expect(detectBestQuality('auto', false, true, 8)).toBe('vrQuest');
    expect(detectBestQuality('ultra', false, true, 16)).toBe('vrQuest');
    expect(detectBestQuality('auto', true, true, 2)).toBe('vrQuest');
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
    expect(getQualityProfile('phoneLow')).toEqual(qualityProfiles.phoneLow);
    expect(getQualityProfile('desktopHigh')).toEqual(qualityProfiles.desktopHigh);
    expect(getQualityProfile('vrQuest')).toEqual(qualityProfiles.vrQuest);
  });
});
