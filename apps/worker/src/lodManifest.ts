export interface LodSourceVertex {
  x: number;
  y: number;
  z: number;
  offset: number;
  importance: number;
}

export interface LodCellBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface LodCellManifestInput {
  bound: LodCellBounds;
  lods: Array<{
    file: number;
    offset: number;
    count: number;
  }>;
}

export interface PlayCanvasLodManifestInput {
  bounds: LodCellBounds;
  filenames: string[];
  cells: LodCellManifestInput[];
}

export interface PlayCanvasLodManifest {
  version: number;
  lodLevels: number;
  filenames: string[];
  tree: {
    bound: LodCellBounds;
    children: Array<{
      bound: LodCellBounds;
      lods: Record<string, { file: number; offset: number; count: number }>;
    }>;
  };
}

export function sampleLodVertices(vertices: LodSourceVertex[], requestedCount: number): LodSourceVertex[] {
  const targetCount = Math.max(1, Math.min(vertices.length, requestedCount));
  if (targetCount >= vertices.length) {
    return vertices.slice();
  }

  const selected = new Set<number>();
  const byImportance = vertices
    .map((vertex, index) => ({ vertex, index }))
    .sort((a, b) => b.vertex.importance - a.vertex.importance);

  const importantCount = Math.max(1, Math.floor(targetCount * 0.65));
  for (let i = 0; i < importantCount && selected.size < targetCount; i++) {
    selected.add(byImportance[i]!.index);
  }

  const spatialCount = targetCount - selected.size;
  if (spatialCount > 0) {
    const stride = vertices.length / spatialCount;
    for (let i = 0; i < spatialCount && selected.size < targetCount; i++) {
      selected.add(Math.min(vertices.length - 1, Math.floor((i + 0.5) * stride)));
    }
  }

  for (const entry of byImportance) {
    if (selected.size >= targetCount) break;
    selected.add(entry.index);
  }

  return Array.from(selected)
    .sort((a, b) => a - b)
    .map((index) => vertices[index]!);
}

export function createPlayCanvasLodManifest(input: PlayCanvasLodManifestInput): PlayCanvasLodManifest {
  const lodLevels = input.filenames.length;
  return {
    version: 1,
    lodLevels,
    filenames: input.filenames,
    tree: {
      bound: input.bounds,
      children: input.cells.map((cell) => {
        const lods: Record<string, { file: number; offset: number; count: number }> = {};
        for (let i = 0; i < lodLevels; i++) {
          const lod = cell.lods[i];
          if (lod && lod.count > 0) {
            lods[String(i)] = lod;
          }
        }
        return {
          bound: cell.bound,
          lods,
        };
      }),
    },
  };
}
