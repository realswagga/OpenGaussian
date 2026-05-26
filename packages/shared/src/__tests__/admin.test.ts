import { describe, it, expect } from 'vitest';
import { pretransformSchema, pretransformUpdateSchema } from '../schemas.js';

describe('pretransformSchema', () => {
  it('accepts valid full pretransform', () => {
    const result = pretransformSchema.safeParse({
      position: [1, 2, 3],
      rotation: [0, 90, 0],
      scale: [1, 1, 1],
    });
    expect(result.success).toBe(true);
  });

  it('accepts identity pretransform', () => {
    const result = pretransformSchema.safeParse({
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing fields', () => {
    const result = pretransformSchema.safeParse({
      position: [0, 0, 0],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-tuple arrays', () => {
    const result = pretransformSchema.safeParse({
      position: [0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-number values', () => {
    const result = pretransformSchema.safeParse({
      position: ['a', 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    });
    expect(result.success).toBe(false);
  });
});

describe('pretransformUpdateSchema', () => {
  it('accepts partial update (position only)', () => {
    const result = pretransformUpdateSchema.safeParse({
      position: [5, 0, -2],
    });
    expect(result.success).toBe(true);
  });

  it('accepts partial update (scale only)', () => {
    const result = pretransformUpdateSchema.safeParse({
      scale: [2, 2, 2],
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object', () => {
    const result = pretransformUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts full update', () => {
    const result = pretransformUpdateSchema.safeParse({
      position: [1, 1, 1],
      rotation: [45, 45, 45],
      scale: [1.5, 1.5, 1.5],
    });
    expect(result.success).toBe(true);
  });
});
