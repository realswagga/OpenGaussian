import type { QualityProfile, QualityProfileName } from './types.js';

// Quality profiles
export const qualityProfiles: Record<QualityProfileName, QualityProfile> = {
  phoneLow: {
    splatBudget: 400_000,
    maxDevicePixelRatio: 1,
    enablePostFx: false,
    markerDistanceLimit: 20,
    antialias: false,
  },
  phoneHigh: {
    splatBudget: 800_000,
    maxDevicePixelRatio: 1.25,
    enablePostFx: false,
    markerDistanceLimit: 30,
    antialias: false,
  },
  desktopMedium: {
    splatBudget: 1_500_000,
    maxDevicePixelRatio: 1.5,
    enablePostFx: true,
    markerDistanceLimit: 60,
    antialias: false,
  },
  desktopHigh: {
    splatBudget: 3_000_000,
    maxDevicePixelRatio: 2,
    enablePostFx: true,
    markerDistanceLimit: 100,
    antialias: true,
  },
  vrQuest: {
    splatBudget: 700_000,
    maxDevicePixelRatio: 1,
    enablePostFx: false,
    markerDistanceLimit: 40,
    antialias: false,
  },
};

// Quality labels per preset
export const qualityPresetLabels: Record<string, string> = {
  auto: 'Auto',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  ultra: 'Ultra',
};

// Accepted upload formats
export const acceptedExtensions = ['.ply', '.spz', '.sog', '.meta.json', '.lod-meta.json', '.compressed.ply'];

// Default LOD budgets
export const defaultLodBudget = 1_500_000;
export const defaultMobileLodBudget = 500_000;
export const defaultVrLodBudget = 700_000;
