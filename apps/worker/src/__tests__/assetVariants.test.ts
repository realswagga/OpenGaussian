import { describe, expect, it } from 'vitest';
import { SPLAT_VARIANT_CONFIGS, computeVariantTargets } from '../assetVariants.js';

describe('computeVariantTargets', () => {
  it('retains enough Quest VR detail for the opt-in High profile', () => {
    const targets = computeVariantTargets(2_000_000, SPLAT_VARIANT_CONFIGS.vr);

    expect(targets[0]).toBe(600_000);
    expect(targets).toEqual([600_000, 300_000, 150_000, 60_000]);
    expect(targets).toEqual([...targets].sort((a, b) => b - a));
    expect(new Set(targets).size).toBe(targets.length);
  });

  it('keeps small scenes usable without producing zero-count LODs', () => {
    const targets = computeVariantTargets(4, SPLAT_VARIANT_CONFIGS.mobile);

    expect(targets).toEqual([4, 2, 1]);
  });

  it('returns no targets for invalid source counts', () => {
    expect(computeVariantTargets(0, SPLAT_VARIANT_CONFIGS.desktop)).toEqual([]);
    expect(computeVariantTargets(Number.NaN, SPLAT_VARIANT_CONFIGS.desktop)).toEqual([]);
  });
});
