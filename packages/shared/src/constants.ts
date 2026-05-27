import type { QualityProfile, QualityProfileName } from './types.js';

export const qualityProfiles: Record<QualityProfileName, QualityProfile> = {
  phoneUltraLow: {
    splatBudget: 75_000,
    maxDevicePixelRatio: 0.75,
    enablePostFx: false,
    markerDistanceLimit: 10,
    antialias: false,
    targetFps: 30,
    adaptiveBudgetEnabled: true,
    sigmaScale: 2.0,
    shaderPrecision: 'mediump',
  },
  phoneLow: {
    splatBudget: 150_000,
    maxDevicePixelRatio: 1,
    enablePostFx: false,
    markerDistanceLimit: 20,
    antialias: false,
    targetFps: 30,
    adaptiveBudgetEnabled: true,
    sigmaScale: 2.0,
    shaderPrecision: 'mediump',
  },
  phoneHigh: {
    splatBudget: 300_000,
    maxDevicePixelRatio: 1.25,
    enablePostFx: false,
    markerDistanceLimit: 30,
    antialias: false,
    targetFps: 45,
    adaptiveBudgetEnabled: true,
    sigmaScale: 2.5,
    shaderPrecision: 'mediump',
  },
  desktopMedium: {
    splatBudget: 1_500_000,
    maxDevicePixelRatio: 1.5,
    enablePostFx: true,
    markerDistanceLimit: 60,
    antialias: false,
    targetFps: 60,
    adaptiveBudgetEnabled: false,
    sigmaScale: 3.0,
    shaderPrecision: 'highp',
  },
  desktopHigh: {
    splatBudget: 3_000_000,
    maxDevicePixelRatio: 2,
    enablePostFx: true,
    markerDistanceLimit: 100,
    antialias: true,
    targetFps: 60,
    adaptiveBudgetEnabled: false,
    sigmaScale: 3.0,
    shaderPrecision: 'highp',
  },
  vrQuest: {
    splatBudget: 200_000,
    maxDevicePixelRatio: 1,
    enablePostFx: false,
    markerDistanceLimit: 40,
    antialias: false,
    targetFps: 72,
    adaptiveBudgetEnabled: true,
    sigmaScale: 2.0,
    shaderPrecision: 'mediump',
  },
};

export const qualityPresetLabels: Record<string, string> = {
  auto: 'Auto',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  ultra: 'Ultra',
};

export const acceptedExtensions = ['.ply', '.spz', '.sog', '.meta.json', '.lod-meta.json', '.compressed.ply'];

export const defaultLodBudget = 1_500_000;
export const defaultMobileLodBudget = 300_000;
export const defaultVrLodBudget = 200_000;