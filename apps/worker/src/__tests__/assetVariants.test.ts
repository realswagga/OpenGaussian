import { describe, expect, it } from 'vitest';
import { SPLAT_VARIANT_CONFIGS, computeVariantTargets } from '../assetVariants.js';

describe('computeVariantTargets', () => {
  it('caps Quest VR variants at the production VR budget', () => {
    const targets = computeVariantTargets(2_000_000, SPLAT_VARIANT_CONFIGS.vr);

    expect(targets[0]).toBe(60_000);
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
