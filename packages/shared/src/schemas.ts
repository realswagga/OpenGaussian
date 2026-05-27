import { z } from 'zod';

// ============================================================
// Auth schemas
// ============================================================

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ============================================================
// Splat schemas
// ============================================================

export const createSplatSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens'),
  description: z.string().max(2000).optional(),
});

export const defaultCameraSchema = z.object({
  position: z.tuple([z.number(), z.number(), z.number()]),
  target: z.tuple([z.number(), z.number(), z.number()]),
  fov: z.number().min(1).max(180).optional(),
});

export const updateSplatSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  description: z.string().max(2000).optional().nullable(),
  status: z.enum(['DRAFT', 'READY', 'PUBLISHED', 'ARCHIVED']).optional(),
  defaultCameraJson: defaultCameraSchema.optional().nullable(),
});

// ============================================================
// Marker schemas
// ============================================================

export const createMarkerSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(5000).optional(),
  kind: z.string().default('info'),
  positionX: z.number(),
  positionY: z.number(),
  positionZ: z.number(),
  rotationX: z.number().default(0),
  rotationY: z.number().default(0),
  rotationZ: z.number().default(0),
  scale: z.number().default(1),
  icon: z.string().optional(),
  color: z.string().optional(),
});

export const updateMarkerSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(5000).optional().nullable(),
  kind: z.string().optional(),
  positionX: z.number().optional(),
  positionY: z.number().optional(),
  positionZ: z.number().optional(),
  rotationX: z.number().optional(),
  rotationY: z.number().optional(),
  rotationZ: z.number().optional(),
  scale: z.number().optional(),
  icon: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
});

/** @deprecated Use createMarkerSchema. */
export const createAnnotationSchema = createMarkerSchema;

/** @deprecated Use updateMarkerSchema. */
export const updateAnnotationSchema = updateMarkerSchema;

// ============================================================
// Upload schemas
// ============================================================

export const allowedExtensions = ['.ply', '.spz', '.sog', '.meta.json', '.lod-meta.json', '.compressed.ply'];
export const allowedMimeTypes = [
  'application/octet-stream',
  'application/x-ply',
  'model/ply',
  'application/json',
];

// ============================================================
// Viewer schemas
// ============================================================

export const viewerPresetSchema = z.object({
  name: z.string().min(1).max(100),
  cameraMode: z.enum(['orbit', 'fly', 'locked']).default('orbit'),
  lodBudget: z.number().int().positive().default(900000),
  mobileLodBudget: z.number().int().positive().default(250000),
  vrLodBudget: z.number().int().positive().default(120000),
  enableVr: z.boolean().default(true),
  enableWebGpu: z.boolean().default(true),
  enableMarkers: z.boolean().default(true),
  lockScene: z.boolean().default(false),
  allowFly: z.boolean().default(true),
  allowOrbit: z.boolean().default(true),
});

// ============================================================
// Pretransform schemas
// ============================================================

export const pretransformSchema = z.object({
  position: z.tuple([z.number(), z.number(), z.number()]),
  rotation: z.tuple([z.number(), z.number(), z.number()]),
  scale: z.tuple([z.number(), z.number(), z.number()]),
});

export const pretransformUpdateSchema = z.object({
  position: z.tuple([z.number(), z.number(), z.number()]).optional(),
  rotation: z.tuple([z.number(), z.number(), z.number()]).optional(),
  scale: z.tuple([z.number(), z.number(), z.number()]).optional(),
});
