import { useEffect, useRef, useState, useCallback, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Card, Badge, Button, Spinner, Tabs } from '@gsplat/ui';
import {
  applyDeadzone,
  clamp,
  clampDollyStepToDepth,
  computeDepthAwareDollyStep,
  computeFrontDepthConsensus,
  extractGsplatPointCenters,
  pickMarkerPoint,
  type SplatAssetFormat,
  type ViewerManifest,
} from '@gsplat/viewer-core';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const ASSET_BASE = import.meta.env.VITE_ASSET_BASE_URL || '/assets';

interface Annotation {
  id: string;
  title: string;
  body?: string;
  kind: string;
  positionX: number;
  positionY: number;
  positionZ: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scale: number;
  icon?: string;
  color?: string;
}

interface SplatInfo {
  id: string;
  title: string;
  slug: string;
  status: string;
  productionObjectKey?: string;
  productionFormat?: string;
  boundingBoxJson?: { min: [number, number, number]; max: [number, number, number] };
  defaultCameraJson?: { position: [number, number, number]; target: [number, number, number]; fov?: number };
  pretransformJson?: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] } | null;
}

interface VersionItem {
  id: string;
  version: number;
  processingStatus: string;
  isServed?: boolean;
}

interface MarkerObj {
  annotationId: string;
  group: THREE.Group;
  sphere: THREE.Mesh;
  label: THREE.Sprite;
  title: string;
}

type GizmoMode = 'translate' | 'rotate' | 'scale';
type EditorTransform = NonNullable<SplatInfo['pretransformJson']>;

interface PretransformFormState {
  posX: number;
  posY: number;
  posZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  sclX: number;
  sclY: number;
  sclZ: number;
}

const COLOR_PRESETS = ['#ffffff', '#ef4444', '#22c55e', '#3b82f6', '#eab308', '#a855f7', '#06b6d4', '#f97316', '#ec4899', '#8b5cf6'];

const ICON_OPTIONS = [
  { value: 'dot', label: '●' },
  { value: 'info', label: 'ℹ' },
  { value: 'warning', label: '⚠' },
  { value: 'landmark', label: '✦' },
  { value: 'pin', label: '📍' },
  { value: 'star', label: '★' },
];

const KIND_OPTIONS = ['info', 'warning', 'landmark', 'custom'];

type EditorCameraPose = NonNullable<SplatInfo['defaultCameraJson']>;

function formToEditorTransform(pretransform: PretransformFormState): EditorTransform {
  return {
    position: [pretransform.posX, pretransform.posY, pretransform.posZ],
    rotation: [pretransform.rotX, pretransform.rotY, pretransform.rotZ],
    scale: [pretransform.sclX, pretransform.sclY, pretransform.sclZ],
  };
}

function adminMinOrbitDistanceForRadius(radius: number) {
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 1;
  return clamp(safeRadius * 0.00002, 0.005, 0.05);
}

function adminNearPlaneForRadius(radius: number) {
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 1;
  return clamp(safeRadius * 0.00001, 0.001, 0.05);
}

function finiteTuple3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function applyEditorCameraPose(
  camera: THREE.PerspectiveCamera,
  orbit: OrbitControls,
  pose: EditorCameraPose | null | undefined,
) {
  if (!pose || !finiteTuple3(pose.position) || !finiteTuple3(pose.target)) return false;
  const position = new THREE.Vector3(...pose.position);
  const target = new THREE.Vector3(...pose.target);
  const distance = position.distanceTo(target);
  if (!Number.isFinite(distance) || distance <= 0.001) return false;

  if (typeof pose.fov === 'number' && Number.isFinite(pose.fov)) {
    camera.fov = clamp(pose.fov, 1, 180);
  }
  orbit.target.copy(target);
  camera.position.copy(position);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  orbit.update();
  return true;
}

// ── Safe number input helper ──
// Allows intermediate states like "-", ".", "-." so user can type freely
function safeNumParse(val: string, fallback: number): number {
  // Allow empty, single minus, single/minus dot
  if (val === '' || val === '-' || val === '.' || val === '-.') return 0;
  const n = parseFloat(val);
  return Number.isNaN(n) ? fallback : n;
}

interface NumInputProps {
  value: number;
  onChange: (v: number) => void;
  step?: string;
  style?: React.CSSProperties;
  placeholder?: string;
}

function NumInput({ value, onChange, step, style, placeholder }: NumInputProps) {
  // Use a string representation that preserves the user's typing intent
  const [textVal, setTextVal] = useState(String(value));

  // Sync external value changes
  useEffect(() => {
    // Only update if the parsed value differs, preserving user's typing
    const parsed = safeNumParse(textVal, 0);
    if (Math.abs(parsed - value) > 0.000001) {
      setTextVal(String(value));
    }
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={textVal}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        setTextVal(raw);
        onChange(safeNumParse(raw, 0));
      }}
      onBlur={() => {
        // Normalize on blur
        const n = safeNumParse(textVal, 0);
        setTextVal(String(n));
        onChange(n);
      }}
      style={style}
    />
  );
}

function normalizeProductionFormat(format?: string): SplatAssetFormat {
  switch (format) {
    case 'sog':
    case 'sog-meta':
    case 'lod-meta':
    case 'compressed-ply':
    case 'spz':
      return format;
    case 'ply':
    default:
      return 'ply';
  }
}

function buildEditorManifest(splat: SplatInfo): ViewerManifest | null {
  if (!splat.productionObjectKey) return null;

  const format = normalizeProductionFormat(splat.productionFormat);
  const assetUrl = `${ASSET_BASE}/${splat.productionObjectKey}`;

  return {
    id: splat.id,
    slug: splat.slug,
    title: splat.title,
    assets: {
      format,
      sceneUrl: assetUrl,
      metaUrl: format === 'sog-meta' ? assetUrl : undefined,
      lodManifestUrl: format === 'lod-meta' ? assetUrl : undefined,
    },
    viewer: {
      defaultCamera: splat.defaultCameraJson,
      enableVr: false,
      enableWebGpu: false,
      quality: 'auto',
      budgets: {
        desktop: 900_000,
        mobile: 250_000,
        vr: 60_000,
      },
      pretransform: splat.pretransformJson || null,
    },
  };
}

function loadPlyPositions(_buffer: ArrayBuffer): Float32Array {
  throw new Error('Legacy point-cloud parser is disabled');
}

function loadSogJsonPositions(_json: unknown): Float32Array {
  throw new Error('Legacy point-cloud parser is disabled');
}

function loadSogBinPositions(_buffer: ArrayBuffer): Float32Array {
  throw new Error('Legacy point-cloud parser is disabled');
}

// ── Component ──

export default function Annotation3DEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);

  const [splat, setSplat] = useState<SplatInfo | null>(null);
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(() => searchParams.get('versionId'));
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [splatLoading, setSplatLoading] = useState(false);
  const [splatError, setSplatError] = useState('');
  const [splatVertexCount, setSplatVertexCount] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [editForm, setEditForm] = useState({
    title: '', body: '', kind: 'info',
    positionX: 0, positionY: 0, positionZ: 0,
    rotationX: 0, rotationY: 0, rotationZ: 0,
    scale: 1, icon: 'dot', color: '#ffffff',
  });

  // Gizmo state
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [snapValue, setSnapValue] = useState(0.1);

  // Place marker mode
  const [placeMode, setPlaceMode] = useState(false);
  const placeModeRef = useRef(false);

  // Fly mode
  const [flyMode, setFlyMode] = useState(false);
  const flyMoveSpeedRef = useRef(4.0);
  const flyModeRef = useRef(false);
  const flyYawRef = useRef(0);
  const flyPitchRef = useRef(0);
  const keysRef = useRef<Set<string>>(new Set());
  const flyMoveStickRef = useRef({ pointerId: null as number | null, x: 0, y: 0 });
  const flyLookStickRef = useRef({ pointerId: null as number | null, x: 0, y: 0 });
  const canvasPointerRef = useRef({ x: 0, y: 0, moved: false });
  const [coarsePointer, setCoarsePointer] = useState(false);
  // Sync ref for the animation loop closure
  useEffect(() => { flyModeRef.current = flyMode; }, [flyMode]);
  useEffect(() => { placeModeRef.current = placeMode; }, [placeMode]);

  useEffect(() => {
    const media = window.matchMedia?.('(pointer: coarse)');
    if (!media) return;
    const update = () => setCoarsePointer(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  // Pretransform state (live-editable, applied to the rendered point cloud)
  const [pretransform, setPretransform] = useState<PretransformFormState>({
    posX: 0, posY: 0, posZ: 0,
    rotX: 0, rotY: 0, rotZ: 0,
    sclX: 1, sclY: 1, sclZ: 1,
  });
  const pretransformRef = useRef(pretransform);
  const [ptSaving, setPtSaving] = useState(false);
  const [ptMessage, setPtMessage] = useState('');

  const [cameraSaving, setCameraSaving] = useState(false);
  const [cameraMessage, setCameraMessage] = useState('');

  // Track if initial pretransform load is done
  const ptLoadedRef = useRef(false);

  // 3D refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const markersRef = useRef<Map<string, MarkerObj>>(new Map());
  const splatCloudRef = useRef<THREE.Points | null>(null);
  const selectedMarkerObjRef = useRef<THREE.Group | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const groundRef = useRef<THREE.Mesh | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const animFrameRef = useRef<number>(0);
  const pointerRef = useRef<THREE.Vector2>(new THREE.Vector2());
  // Cache the untransformed vertex positions so we can re-apply pretransform in-place
  const originalPositionsRef = useRef<Float32Array | null>(null);
  const sceneRadiusRef = useRef(1);
  const splatLoadSeqRef = useRef(0);
  const activeSplatLoadRef = useRef<{ key: string; seq: number } | null>(null);
  const loadedSplatKeyRef = useRef<string | null>(null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    pretransformRef.current = pretransform;
  }, [pretransform]);

  // Apply pretransform to the cached original positions without re-fetching
  const applyPretransformInPlace = useCallback((pt: EditorTransform) => {
    const cloud = splatCloudRef.current;
    const orig = originalPositionsRef.current;
    if (!cloud || !orig || !sceneRef.current) return;

    const geo = cloud.geometry;
    const posArr = (geo.attributes.position as THREE.BufferAttribute).array as Float32Array;

    // Reset to original positions
    posArr.set(orig);

    // Apply transform
    const pos = pt.position;
    const rot = pt.rotation;
    const scl = pt.scale;
    const rotRad = rot.map((r) => THREE.MathUtils.degToRad(r)) as [number, number, number];
    const euler = new THREE.Euler(rotRad[0]!, rotRad[1]!, rotRad[2]!, 'ZYX');

    for (let i = 0; i < posArr.length; i += 3) {
      const v = new THREE.Vector3(posArr[i]! * scl[0]!, posArr[i + 1]! * scl[1]!, posArr[i + 2]! * scl[2]!);
      v.applyEuler(euler);
      v.x += pos[0]!;
      v.y += pos[1]!;
      v.z += pos[2]!;
      posArr[i] = v.x;
      posArr[i + 1] = v.y;
      posArr[i + 2] = v.z;
    }
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    geo.computeBoundingSphere();

    // Update ground plane height for placement
    if (groundRef.current && geo.boundingSphere) {
      const baseY = geo.boundingSphere.center.y - geo.boundingSphere.radius;
      groundRef.current.position.y = baseY;
      if (gridRef.current) {
        gridRef.current.position.set(0, 0, 0);
      }
    }
  }, []);

  const fetchData = useCallback(() => {
    if (!id) return;
    setLoading(true);
    ptLoadedRef.current = false;
    fetch(`${API_BASE}/admin/splats/${id}/versions`, { credentials: 'include' })
      .then((r) => r.json())
      .then(async (versionData) => {
        const items: VersionItem[] = versionData.items || [];
        setVersions(items);
        const activeVersionId = selectedVersionId || items.find((v) => v.isServed)?.id || items[0]?.id || null;
        if (activeVersionId && activeVersionId !== selectedVersionId) {
          setSelectedVersionId(activeVersionId);
          setSearchParams({ versionId: activeVersionId }, { replace: true });
        }

        if (activeVersionId) {
          return fetch(`${API_BASE}/admin/splats/${id}/versions/${activeVersionId}/editor-state`, { credentials: 'include' })
            .then((r) => {
              if (!r.ok) throw new Error(`Editor state failed (${r.status})`);
              return r.json();
            });
        }

        const [splatData, annData] = await Promise.all([
          fetch(`${API_BASE}/admin/splats/${id}`, { credentials: 'include' }).then((r) => r.json()),
          fetch(`${API_BASE}/admin/splats/${id}/markers`, { credentials: 'include' }).then((r) => r.json()),
        ]);
        return { splat: splatData.splat || splatData, markers: annData.items || [] };
      })
      .then((state) => {
        const s = state.splat || state;
        setSplat(s as SplatInfo);
        setAnnotations(state.markers || []);
        if (s.pretransformJson) {
          setPretransform({
            posX: s.pretransformJson.position[0]!, posY: s.pretransformJson.position[1]!, posZ: s.pretransformJson.position[2]!,
            rotX: s.pretransformJson.rotation[0]!, rotY: s.pretransformJson.rotation[1]!, rotZ: s.pretransformJson.rotation[2]!,
            sclX: s.pretransformJson.scale[0]!, sclY: s.pretransformJson.scale[1]!, sclZ: s.pretransformJson.scale[2]!,
          });
        } else {
          setPretransform({ posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, sclX: 1, sclY: 1, sclZ: 1 });
        }
        ptLoadedRef.current = true;
        setLoading(false);
      })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, [id, selectedVersionId, setSearchParams]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Build pretransform object for the point-cloud preview
  const buildTransform = useCallback(() => {
    return formToEditorTransform(pretransform);
  }, [pretransform]);

  // Helper to build the Three.js Points mesh from raw positions
  const buildCloudFromPositions = useCallback((rawPositions: Float32Array, pt: EditorTransform, initialCamera?: EditorCameraPose | null) => {
    if (!sceneRef.current) return;

    if (splatCloudRef.current) {
      sceneRef.current.remove(splatCloudRef.current);
      splatCloudRef.current.geometry.dispose();
      (splatCloudRef.current.material as THREE.Material).dispose();
    }

    // Clone so we don't mutate the original stored in originalPositionsRef
    const positions = new Float32Array(rawPositions);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Apply pretransform
    const pos = pt.position;
    const rot = pt.rotation;
    const scl = pt.scale;
    const rotRad = rot.map((r) => THREE.MathUtils.degToRad(r)) as [number, number, number];
    const euler = new THREE.Euler(rotRad[0]!, rotRad[1]!, rotRad[2]!, 'ZYX');

    const posArr = (geometry.attributes.position as THREE.BufferAttribute).array;
    for (let i = 0; i < posArr.length; i += 3) {
      const v = new THREE.Vector3(posArr[i]! * scl[0]!, posArr[i + 1]! * scl[1]!, posArr[i + 2]! * scl[2]!);
      v.applyEuler(euler);
      v.x += pos[0]!;
      v.y += pos[1]!;
      v.z += pos[2]!;
      posArr[i] = v.x;
      posArr[i + 1] = v.y;
      posArr[i + 2] = v.z;
    }
    (geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    geometry.computeBoundingSphere();

    const material = new THREE.PointsMaterial({
      size: 0.02,
      color: '#88aacc',
      sizeAttenuation: true,
      blending: THREE.NormalBlending,
      depthWrite: true,
    });

    const cloud = new THREE.Points(geometry, material);
    sceneRef.current.add(cloud);
    splatCloudRef.current = cloud;

    if (geometry.boundingSphere) {
      const center = geometry.boundingSphere.center;
      const rawRadius = geometry.boundingSphere.radius;
      const radius = Number.isFinite(rawRadius) && rawRadius > 0 ? rawRadius : 1;
      const safeRadius = Math.min(Math.max(radius, 1), 5000);
      sceneRadiusRef.current = safeRadius;
      const baseY = center.y - safeRadius;
      const gridOrigin = new THREE.Vector3(0, 0, 0);
      const lookTarget = new THREE.Vector3(0, Math.max(safeRadius * 0.35, 0.75), 0);
      const cameraOffset = new THREE.Vector3(1, 0.6, 1).normalize().multiplyScalar(Math.max(safeRadius * 2.1, 6));

      cameraRef.current!.near = adminNearPlaneForRadius(safeRadius);
      cameraRef.current!.far = Math.max(200, safeRadius * 20);
      cameraRef.current!.updateProjectionMatrix();
      orbitRef.current!.minDistance = adminMinOrbitDistanceForRadius(safeRadius);
      orbitRef.current!.maxDistance = Math.max(50, safeRadius * 12);
      const restoredInitialCamera = applyEditorCameraPose(cameraRef.current!, orbitRef.current!, initialCamera);
      if (!restoredInitialCamera) {
        cameraRef.current!.position.copy(gridOrigin).add(cameraOffset);
        cameraRef.current!.lookAt(lookTarget);
        orbitRef.current!.target.copy(lookTarget);
      }
      orbitRef.current!.update();

      if (sceneRef.current.fog instanceof THREE.Fog) {
        sceneRef.current.fog.near = safeRadius * 2;
        sceneRef.current.fog.far = safeRadius * 12;
      }

      if (groundRef.current) {
        groundRef.current.position.y = baseY;
      }
      if (gridRef.current) {
        gridRef.current.position.copy(gridOrigin);
      }
    }
  }, []);

  // Load point cloud once per selected asset; stale async results are ignored.
  const loadSplatCloud = useCallback(async (sceneSplat: SplatInfo, pt: EditorTransform, loadKey: string, loadSeq: number) => {
    const isCurrentLoad = () =>
      activeSplatLoadRef.current?.key === loadKey &&
      activeSplatLoadRef.current.seq === loadSeq &&
      sceneRef.current !== null;

    if (!isCurrentLoad()) return;
    setSplatLoading(true);
    setSplatError('');

    const manifest = buildEditorManifest(sceneSplat);
    let errorContext = '';

    try {
      if (manifest) {
        const assetUrl = manifest.assets.lodManifestUrl || manifest.assets.metaUrl || manifest.assets.sceneUrl;
        errorContext = `${manifest.assets.format} @ ${assetUrl}`;
        const positions = await extractGsplatPointCenters(manifest);
        if (!isCurrentLoad()) return;
        setSplatVertexCount(positions.length / 3);
        originalPositionsRef.current = new Float32Array(positions);
        buildCloudFromPositions(positions, pt, sceneSplat.defaultCameraJson);
        loadedSplatKeyRef.current = loadKey;
        return;
      }

      const objectKey = sceneSplat.productionObjectKey || '';
      if (!objectKey) throw new Error('No production asset is available for this version.');

      const fetchAssetBuffer = async () => {
        const response = await fetch(`${ASSET_BASE}/${objectKey}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      };

      const fetchAssetJson = async () => {
        const response = await fetch(`${ASSET_BASE}/${objectKey}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      };

      // Binary SOG: .sog extension = packed PlayCanvas Float32 binary.
      // JSON SOG: .meta.json / .lod-meta.json = SuperSplat-style JSON manifests.
      const isSogBinary = objectKey.endsWith('.sog') &&
        sceneSplat.productionFormat !== 'sog-meta' &&
        sceneSplat.productionFormat !== 'lod-meta';
      const isSogJson = objectKey.endsWith('.meta.json') ||
        objectKey.endsWith('.lod-meta.json') ||
        sceneSplat.productionFormat === 'sog-meta' ||
        sceneSplat.productionFormat === 'lod-meta';

      let positions: Float32Array;
      if (isSogBinary) {
        errorContext = `sog @ ${objectKey}`;
        positions = loadSogBinPositions(await fetchAssetBuffer());
      } else if (isSogJson) {
        errorContext = `sog-meta @ ${objectKey}`;
        positions = loadSogJsonPositions(await fetchAssetJson());
      } else {
        errorContext = `ply @ ${objectKey}`;
        positions = loadPlyPositions(await fetchAssetBuffer());
      }

      if (!isCurrentLoad()) return;
      setSplatVertexCount(positions.length / 3);
      originalPositionsRef.current = new Float32Array(positions);
      buildCloudFromPositions(positions, pt, sceneSplat.defaultCameraJson);
      loadedSplatKeyRef.current = loadKey;
    } catch (err) {
      if (!isCurrentLoad()) return;
      const message = err instanceof Error ? err.message : String(err);
      loadedSplatKeyRef.current = null;
      setSplatError(errorContext ? `${errorContext}: ${message}` : message);
    } finally {
      if (isCurrentLoad()) {
        activeSplatLoadRef.current = null;
        setSplatLoading(false);
      }
    }
  }, [buildCloudFromPositions]);

  function resetFlyInputState() {
    keysRef.current.clear();
    flyMoveStickRef.current = { pointerId: null, x: 0, y: 0 };
    flyLookStickRef.current = { pointerId: null, x: 0, y: 0 };
  }

  function syncOrbitFromCameraPose() {
    const cam = cameraRef.current;
    const orbit = orbitRef.current;
    if (!cam || !orbit) return;

    const pos = cam.position.clone();
    const forward = new THREE.Vector3();
    cam.getWorldDirection(forward);
    if (forward.lengthSq() <= 1e-8) return;

    const maxDist = Math.max(sceneRadiusRef.current * 20, 200);
    const orbitDist = clamp(
      pos.distanceTo(orbit.target) || sceneRadiusRef.current * 1.5 || 4,
      adminMinOrbitDistanceForRadius(sceneRadiusRef.current),
      maxDist,
    );
    orbit.target.copy(pos.clone().add(forward.normalize().multiplyScalar(orbitDist)));
    orbit.enabled = true;
    orbit.update();
    cam.position.copy(pos);
    cam.lookAt(orbit.target);
    orbit.update();
  }

  function enterFlyModeFromCamera() {
    const cam = cameraRef.current;
    if (!cam) return;
    setFlyMode(true);
    flyModeRef.current = true;
    resetFlyInputState();
    if (orbitRef.current) orbitRef.current.enabled = false;
    const forward = new THREE.Vector3();
    cam.getWorldDirection(forward);
    flyYawRef.current = Math.atan2(forward.x, forward.z);
    const horizontalLen = Math.sqrt(forward.x * forward.x + forward.z * forward.z);
    flyPitchRef.current = Math.atan2(forward.y, horizontalLen);
    flyMoveSpeedRef.current = 4.0;
    if (!coarsePointer) {
      containerRef.current?.querySelector('canvas')?.requestPointerLock();
    }
  }

  function exitFlyModePreservingCamera() {
    setFlyMode(false);
    flyModeRef.current = false;
    resetFlyInputState();
    document.exitPointerLock();
    syncOrbitFromCameraPose();
  }

  function setOrbitTargetToPoint(point: THREE.Vector3, reorientCamera = false) {
    const orbit = orbitRef.current;
    const camera = cameraRef.current;
    if (!orbit || !camera) return;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return;
    orbit.target.copy(point);
    if (reorientCamera) {
      camera.lookAt(orbit.target);
      orbit.update();
    }
  }

  // ── 3D Scene Setup ──
  useEffect(() => {
    if (!containerRef.current || loading) return;
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#050505');
    scene.fog = new THREE.Fog('#050505', 5, 50);
    sceneRef.current = scene;

    const aspect = width / Math.max(height, 1);
    const camera = new THREE.PerspectiveCamera(60, aspect, 0.01, 200);
    camera.position.set(4, 3, 6);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.target.set(0, 0, 0);
    orbit.minDistance = adminMinOrbitDistanceForRadius(1);
    orbit.maxDistance = 50;
    // Right-click for pan, left-click for orbit
    (orbit as unknown as { mouseButtons: Record<string, number> }).mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    orbitRef.current = orbit;
    orbit.enableZoom = true;
    orbit.zoomToCursor = false;
    orbit.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

    const orbitAnchorEl = document.createElement('div');
    orbitAnchorEl.setAttribute('aria-hidden', 'true');
    orbitAnchorEl.style.position = 'absolute';
    orbitAnchorEl.style.width = '14px';
    orbitAnchorEl.style.height = '14px';
    orbitAnchorEl.style.borderRadius = '50%';
    orbitAnchorEl.style.border = '1px solid rgba(255,255,255,0.9)';
    orbitAnchorEl.style.background = 'rgba(255,255,255,0.24)';
    orbitAnchorEl.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.28), 0 4px 14px rgba(0,0,0,0.28)';
    orbitAnchorEl.style.pointerEvents = 'none';
    orbitAnchorEl.style.transform = 'translate(-50%, -50%)';
    orbitAnchorEl.style.zIndex = '12';
    orbitAnchorEl.style.display = 'none';
    container.appendChild(orbitAnchorEl);

    const depthRayOffsets: readonly (readonly [number, number])[] = [
      [0, 0],
      [5, 0],
      [-5, 0],
      [0, 5],
      [0, -5],
      [4, 4],
      [-4, 4],
      [4, -4],
      [-4, -4],
    ];

    function setPointerFromClient(clientX: number, clientY: number, offsetX = 0, offsetY = 0) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerRef.current.x = ((clientX - rect.left + offsetX) / rect.width) * 2 - 1;
      pointerRef.current.y = -((clientY - rect.top + offsetY) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(pointerRef.current, camera);
      return raycasterRef.current.ray.clone();
    }

    function clampDepth(depth: number) {
      const radius = Math.max(sceneRadiusRef.current, 0.5);
      const minDepth = Math.max(radius * 0.035, 0.05);
      const maxDepth = Math.max(radius * 8, camera.position.distanceTo(orbit.target) * 3, 2);
      const fallback = Math.max(camera.position.distanceTo(orbit.target), radius, 0.25);
      return clamp(Number.isFinite(depth) && depth > 0 ? depth : fallback, minDepth, maxDepth);
    }

    function getNearSurfaceStopDistance() {
      return adminMinOrbitDistanceForRadius(sceneRadiusRef.current);
    }

    function getMinimumOrbitDistance() {
      return Math.max(0.005, getNearSurfaceStopDistance());
    }

    function getOrbitDollyDepth() {
      const distance = camera.position.distanceTo(orbit.target);
      return Number.isFinite(distance) && distance > 0 ? distance : getMinimumOrbitDistance();
    }

    function getAnchorProximityMoveScale() {
      const distance = getOrbitDollyDepth();
      const minDistance = getMinimumOrbitDistance();
      const slowRange = Math.max(minDistance * 12, sceneRadiusRef.current * 0.03, 0.6);
      const t = clamp((distance - minDistance) / Math.max(1e-6, slowRange - minDistance), 0, 1);
      const eased = t * t * (3 - 2 * t);
      return clamp(0.18 + eased * 0.82, 0.18, 1);
    }

    function dollyAlongOrbitAnchor(step: number) {
      if (!Number.isFinite(step) || Math.abs(step) < 1e-8) return;
      const anchorDirection = orbit.target.clone().sub(camera.position);
      const anchorDistance = anchorDirection.length();
      if (!Number.isFinite(anchorDistance) || anchorDistance <= 1e-6) return;

      const minDistance = getMinimumOrbitDistance();
      const forwardLimit = Math.max(0, anchorDistance - minDistance);
      const clampedStep = step > 0
        ? Math.min(step, forwardLimit, anchorDistance * 0.35)
        : step;
      if (Math.abs(clampedStep) < 1e-8) return;

      camera.position.add(anchorDirection.normalize().multiplyScalar(clampedStep));
      const nextDistance = camera.position.distanceTo(orbit.target);
      if (nextDistance < minDistance) {
        const away = camera.position.clone().sub(orbit.target).normalize();
        camera.position.copy(orbit.target).add(away.multiplyScalar(minDistance));
      }
      camera.lookAt(orbit.target);
      orbit.update();
    }

    function intersectSceneDepth(ray: THREE.Ray) {
      const cloudPositions = splatCloudRef.current?.geometry.attributes.position as THREE.BufferAttribute | undefined;
      const pointHit = cloudPositions
        ? pickMarkerPoint({
            positions: cloudPositions.array,
            rayOrigin: [ray.origin.x, ray.origin.y, ray.origin.z],
            rayDirection: [ray.direction.x, ray.direction.y, ray.direction.z],
            sceneRadius: sceneRadiusRef.current,
          })
        : null;
      if (pointHit) return pointHit.distanceAlongRay;

      const sphere = splatCloudRef.current?.geometry.boundingSphere?.clone();
      if (sphere && splatCloudRef.current) {
        sphere.applyMatrix4(splatCloudRef.current.matrixWorld);
        const hitPoint = new THREE.Vector3();
        if (ray.intersectSphere(sphere, hitPoint)) {
          return hitPoint.distanceTo(ray.origin);
        }
      }
      return null;
    }

    function intersectTargetPlane(ray: THREE.Ray) {
      const normal = new THREE.Vector3();
      camera.getWorldDirection(normal);
      const denom = ray.direction.dot(normal);
      if (Math.abs(denom) <= 1e-5) return null;
      const distance = orbit.target.clone().sub(ray.origin).dot(normal) / denom;
      if (!Number.isFinite(distance) || distance <= 0.01) return null;
      return distance;
    }

    function getDepthPickAtClientPoint(clientX: number, clientY: number) {
      const centerRay = setPointerFromClient(clientX, clientY);
      const fallbackDepth = clampDepth(Math.max(camera.position.distanceTo(orbit.target), sceneRadiusRef.current, 0.25));
      const samples: number[] = [];

      for (const [offsetX, offsetY] of depthRayOffsets) {
        const ray = setPointerFromClient(clientX, clientY, offsetX, offsetY);
        const depth = intersectSceneDepth(ray);
        if (depth) samples.push(clampDepth(depth));
      }

      const consensus = computeFrontDepthConsensus({
        samples,
        fallbackDepth,
        minSamples: 4,
        minClusterSamples: 2,
        maxClusterRelativeSpread: 0.35,
      });

      if (consensus.sampleCount >= 2 && consensus.confidence >= 0.25) {
        const distance = clampDepth(consensus.distance);
        return {
          point: centerRay.origin.clone().add(centerRay.direction.clone().multiplyScalar(distance)),
          distance,
          confidence: consensus.confidence,
          source: 'scene' as const,
        };
      }

      const planeDistance = intersectTargetPlane(centerRay);
      if (planeDistance) {
        const distance = clampDepth(planeDistance);
        return {
          point: centerRay.origin.clone().add(centerRay.direction.clone().multiplyScalar(distance)),
          distance,
          confidence: 0.25,
          source: 'target-plane' as const,
        };
      }

      return {
        point: centerRay.origin.clone().add(centerRay.direction.clone().multiplyScalar(fallbackDepth)),
        distance: fallbackDepth,
        confidence: 0,
        source: 'fallback' as const,
      };
    }

    let orbitAnchorTransition: {
      from: THREE.Vector3;
      to: THREE.Vector3;
      cameraPosition: THREE.Vector3;
      startTime: number;
      durationMs: number;
    } | null = null;
    orbit.addEventListener('start', () => { orbitAnchorTransition = null; });

    function applyOrbitPoseFromCameraAndTarget(cameraPosition: THREE.Vector3, target: THREE.Vector3) {
      const distance = cameraPosition.distanceTo(target);
      if (!Number.isFinite(distance) || distance <= 0.05) return;
      orbit.target.copy(target);
      camera.position.copy(cameraPosition);
      camera.lookAt(orbit.target);
      orbit.update();
    }

    function updateOrbitAnchorTransition() {
      if (!orbitAnchorTransition) return;
      const t = clamp((performance.now() - orbitAnchorTransition.startTime) / orbitAnchorTransition.durationMs, 0, 1);
      const eased = 1 - (1 - t) * (1 - t) * (1 - t);
      const target = orbitAnchorTransition.from.clone().lerp(orbitAnchorTransition.to, eased);
      applyOrbitPoseFromCameraAndTarget(orbitAnchorTransition.cameraPosition, target);
      if (t >= 1) orbitAnchorTransition = null;
    }

    function setOrbitTargetFromClientPoint(clientX: number, clientY: number) {
      const pick = getDepthPickAtClientPoint(clientX, clientY);
      const pos = camera.position.clone();
      const distance = pos.distanceTo(pick.point);
      if (!Number.isFinite(distance) || distance <= 0.05) return;
      orbitAnchorTransition = {
        from: orbit.target.clone(),
        to: pick.point.clone(),
        cameraPosition: pos,
        startTime: performance.now(),
        durationMs: 180,
      };
    }

    function onCustomWheel(e: WheelEvent) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (flyModeRef.current) {
        const zoomIn = e.deltaY < 0;
        const speedFactor = zoomIn ? 1.15 : 0.85;
        flyMoveSpeedRef.current = Math.max(0.5, Math.min(50, flyMoveSpeedRef.current * speedFactor));
        return;
      }
      orbitAnchorTransition = null;
      const anchorDepth = getOrbitDollyDepth();
      const step = computeDepthAwareDollyStep({
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        hitDepth: anchorDepth,
        sceneRadius: sceneRadiusRef.current,
        maxStep: Math.max(sceneRadiusRef.current * 0.08, 0.2),
        nearSurfaceStop: getMinimumOrbitDistance(),
        forwardLimitRatio: 0.35,
      });
      dollyAlongOrbitAnchor(step);
    }
    renderer.domElement.addEventListener('wheel', onCustomWheel, { passive: false, capture: true });
    function onOrbitAnchorDoubleClick(e: MouseEvent) {
      if (e.button !== 0 || flyModeRef.current || placeModeRef.current) return;
      if ((transformRef.current as unknown as { dragging?: boolean } | null)?.dragging) return;
      e.preventDefault();
      setOrbitTargetFromClientPoint(e.clientX, e.clientY);
    }
    renderer.domElement.addEventListener('dblclick', onOrbitAnchorDoubleClick, { capture: true });

    const activeTouchPointers = new Map<number, { x: number; y: number }>();
    let touchPinchState: { distance: number } | null = null;
    const setOrbitTouchSuppressed = (suppressed: boolean) => {
      if (suppressed) {
        orbit.enabled = false;
      } else if (!flyModeRef.current && !(transformRef.current as unknown as { dragging?: boolean } | null)?.dragging) {
        orbit.enabled = true;
      }
    };
    const readTouchPinchDistance = () => {
      const pointers = Array.from(activeTouchPointers.values());
      if (pointers.length < 2) return null;
      return Math.hypot(pointers[0]!.x - pointers[1]!.x, pointers[0]!.y - pointers[1]!.y);
    };
    const onTouchPointerDownCapture = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      activeTouchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activeTouchPointers.size < 2) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOrbitTouchSuppressed(true);
      touchPinchState = { distance: readTouchPinchDistance() ?? 0 };
    };
    const onTouchPointerMoveCapture = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !activeTouchPointers.has(e.pointerId)) return;
      activeTouchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activeTouchPointers.size < 2) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOrbitTouchSuppressed(true);

      const distance = readTouchPinchDistance();
      if (!distance || distance <= 1) return;
      if (!touchPinchState) {
        touchPinchState = { distance };
        return;
      }

      const factor = clamp(distance / Math.max(1, touchPinchState.distance), 0.88, 1.14);
      const anchorDepth = getOrbitDollyDepth();
      const maxStep = Math.max(sceneRadiusRef.current * 0.035, 0.08);
      const rawStep = clamp(Math.log(factor) * anchorDepth * 0.75, -maxStep, maxStep);
      const step = clampDollyStepToDepth({
        step: rawStep,
        hitDepth: anchorDepth,
        sceneRadius: sceneRadiusRef.current,
        nearSurfaceStop: getMinimumOrbitDistance(),
        forwardLimitRatio: 0.35,
      });
      dollyAlongOrbitAnchor(step);
      touchPinchState = { distance };
    };
    const onTouchPointerEndCapture = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      activeTouchPointers.delete(e.pointerId);
      if (activeTouchPointers.size >= 2) {
        e.preventDefault();
        e.stopImmediatePropagation();
        touchPinchState = { distance: readTouchPinchDistance() ?? 0 };
        return;
      }
      touchPinchState = null;
      setOrbitTouchSuppressed(false);
    };
    renderer.domElement.addEventListener('pointerdown', onTouchPointerDownCapture, { capture: true });
    renderer.domElement.addEventListener('pointermove', onTouchPointerMoveCapture, { capture: true });
    renderer.domElement.addEventListener('pointerup', onTouchPointerEndCapture, { capture: true });
    renderer.domElement.addEventListener('pointercancel', onTouchPointerEndCapture, { capture: true });

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setMode('translate');
    transform.setSize(1.5);
    transform.addEventListener('dragging-changed', (event) => {
      orbit.enabled = !event.value && !flyModeRef.current;
    });
    transform.addEventListener('objectChange', () => {
      const obj = transform.object;
      const selectedMarkerId = selectedIdRef.current;
      if (obj && selectedMarkerId) {
        const position = obj.position;
        if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return;
        const next = {
          positionX: Math.round(position.x * 100) / 100,
          positionY: Math.round(position.y * 100) / 100,
          positionZ: Math.round(position.z * 100) / 100,
          rotationX: Math.round(THREE.MathUtils.radToDeg(obj.rotation.x) * 100) / 100,
          rotationY: Math.round(THREE.MathUtils.radToDeg(obj.rotation.y) * 100) / 100,
          rotationZ: Math.round(THREE.MathUtils.radToDeg(obj.rotation.z) * 100) / 100,
          scale: Math.max(0.01, Math.round(obj.scale.x * 100) / 100),
        };
        setOrbitTargetToPoint(position);
        setEditForm((prev) => ({
          ...prev,
          ...next,
        }));
        setAnnotations((prev) => prev.map((ann) => (
          ann.id === selectedMarkerId
            ? {
                ...ann,
                positionX: next.positionX,
                positionY: next.positionY,
                positionZ: next.positionZ,
                rotationX: next.rotationX,
                rotationY: next.rotationY,
                rotationZ: next.rotationZ,
                scale: next.scale,
              }
            : ann
        )));
      }
    });
    const transformHelper = transform.getHelper();
    scene.add(transformHelper);
    transformHelper.traverse((child) => {
      child.renderOrder = 10000;
      const material = (child as THREE.Mesh).material;
      const materials = Array.isArray(material) ? material : material ? [material] : [];
      materials.forEach((m) => {
        m.depthTest = false;
        m.depthWrite = false;
        m.needsUpdate = true;
      });
    });
    transformRef.current = transform;

    scene.add(new THREE.AmbientLight('#404060', 1.5));
    const dirLight = new THREE.DirectionalLight('#ffffff', 2);
    dirLight.position.set(5, 8, 5);
    scene.add(dirLight);

    const gridHelper = new THREE.GridHelper(10, 20, '#2a2a2a', '#1a1a1a');
    scene.add(gridHelper);
    gridRef.current = gridHelper;
    scene.add(new THREE.AxesHelper(2));

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.name = 'ground';
    scene.add(ground);
    groundRef.current = ground;

    if (splat?.boundingBoxJson) {
      const bb = splat.boundingBoxJson;
      const size: [number, number, number] = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
      const center: [number, number, number] = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2];
      const boxGeo = new THREE.BoxGeometry(size[0], size[1], size[2]);
      const boxLine = new THREE.LineSegments(
        new THREE.EdgesGeometry(boxGeo),
        new THREE.LineBasicMaterial({ color: '#404040' }),
      );
      boxLine.position.set(center[0], center[1], center[2]);
      scene.add(boxLine);
    }

    // ── Fly camera helpers ──
    function updateFlyCamera(dt: number) {
      const k = keysRef.current;
      const speed = k.has('shift') ? flyMoveSpeedRef.current * 2 : flyMoveSpeedRef.current;
      const cam = camera;
      const forward = new THREE.Vector3();
      cam.getWorldDirection(forward);
      const right = new THREE.Vector3();
      right.crossVectors(forward, cam.up).normalize();
      const worldUp = new THREE.Vector3(0, 1, 0);

      const move = new THREE.Vector3();
      if (k.has('w')) move.add(forward);
      if (k.has('s')) move.sub(forward);
      if (k.has('d')) move.add(right);
      if (k.has('a')) move.sub(right);
      if (k.has('q')) move.sub(worldUp);
      if (k.has('e')) move.add(worldUp);
      const moveStick = flyMoveStickRef.current;
      if (moveStick.x !== 0 || moveStick.y !== 0) {
        move.add(right.clone().multiplyScalar(moveStick.x * 0.78));
        move.add(forward.clone().multiplyScalar(-moveStick.y * 0.78));
      }

      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(speed * dt);
        cam.position.add(move);
      }

      const lookStick = flyLookStickRef.current;
      if (lookStick.x !== 0 || lookStick.y !== 0) {
        flyYawRef.current -= lookStick.x * dt * 1.9;
        flyPitchRef.current = Math.max(-1.5, Math.min(1.5, flyPitchRef.current - lookStick.y * dt * 1.65));
      }

      const cosP = Math.cos(flyPitchRef.current);
      const lookDir = new THREE.Vector3(
        Math.sin(flyYawRef.current) * cosP,
        Math.sin(flyPitchRef.current),
        Math.cos(flyYawRef.current) * cosP,
      );
      cam.lookAt(cam.position.clone().add(lookDir));
    }

    function onPointerLockChange() {
      if (document.pointerLockElement === renderer.domElement) {
        document.addEventListener('mousemove', onFlyMouseMove);
      } else {
        document.removeEventListener('mousemove', onFlyMouseMove);
        if (flyModeRef.current && !coarsePointer) {
          exitFlyModePreservingCamera();
        }
      }
    }

    function onFlyMouseMove(e: MouseEvent) {
      flyYawRef.current -= e.movementX * 0.003;
      flyPitchRef.current = Math.max(-1.5, Math.min(1.5, flyPitchRef.current - e.movementY * 0.003));
    }

    function onFlyKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const key = e.key.toLowerCase();
      if (flyModeRef.current && ['w', 'a', 's', 'd', 'q', 'e', 'shift'].includes(key)) {
        e.preventDefault();
      }
      keysRef.current.add(key);
    }
    function onFlyKeyUp(e: KeyboardEvent) {
      keysRef.current.delete(e.key.toLowerCase());
    }

    document.addEventListener('pointerlockchange', onPointerLockChange);
    window.addEventListener('keydown', onFlyKeyDown);
    window.addEventListener('keyup', onFlyKeyUp);

    function updateOrbitAnchorGizmo() {
      if (flyModeRef.current) {
        orbitAnchorEl.style.display = 'none';
        return;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      const projected = orbit.target.clone().project(camera);
      const visible = projected.z >= -1 &&
        projected.z <= 1 &&
        projected.x >= -1.05 &&
        projected.x <= 1.05 &&
        projected.y >= -1.05 &&
        projected.y <= 1.05;
      orbitAnchorEl.style.display = visible ? 'block' : 'none';
      if (visible) {
        orbitAnchorEl.style.left = `${(projected.x * 0.5 + 0.5) * rect.width}px`;
        orbitAnchorEl.style.top = `${(-projected.y * 0.5 + 0.5) * rect.height}px`;
      }
    }

    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);
      if (flyModeRef.current) {
        updateFlyCamera(0.016);
      } else {
        updateOrbitAnchorTransition();
        updateOrbitPan(0.016);
        orbit.update();
      }
      (transform as unknown as { update?: () => void }).update?.();
      updateOrbitAnchorGizmo();
      renderer.render(scene, camera);
    }

    function updateOrbitPan(dt: number) {
      const k = keysRef.current;
      if (!k.has('w') && !k.has('s') && !k.has('a') && !k.has('d') && !k.has('q') && !k.has('e')) return;
      const baseSpeed = k.has('shift') ? 8 : 4;
      const speed = baseSpeed * getAnchorProximityMoveScale();
      const cam = camera;
      const rawForward = new THREE.Vector3();
      cam.getWorldDirection(rawForward);
      rawForward.y = 0;
      const forward = new THREE.Vector3();
      if (rawForward.lengthSq() > 0.01) {
        forward.copy(rawForward.normalize());
      } else {
        const offset = cam.position.clone().sub(orbit.target);
        offset.y = 0;
        if (offset.lengthSq() > 0.01) {
          forward.copy(offset.normalize());
        } else {
          forward.set(0, 0, -1);
        }
      }
      const strafe = new THREE.Vector3();
      strafe.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

      const move = new THREE.Vector3();
      if (k.has('w')) move.add(forward);
      if (k.has('s')) move.sub(forward);
      if (k.has('d')) move.add(strafe);
      if (k.has('a')) move.sub(strafe);
      if (k.has('q')) move.y -= 1;
      if (k.has('e')) move.y += 1;
      if (move.lengthSq() > 0) {
        orbitAnchorTransition = null;
        move.normalize().multiplyScalar(speed * dt);
        const t = orbit.target;
        t.set(t.x + move.x, t.y + move.y, t.z + move.z);
      }
    }
    animate();

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    return () => {
      splatLoadSeqRef.current += 1;
      activeSplatLoadRef.current = null;
      loadedSplatKeyRef.current = null;
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('mousemove', onFlyMouseMove);
      window.removeEventListener('keydown', onFlyKeyDown);
      window.removeEventListener('keyup', onFlyKeyUp);
      renderer.domElement.removeEventListener('wheel', onCustomWheel, { capture: true });
      renderer.domElement.removeEventListener('dblclick', onOrbitAnchorDoubleClick, { capture: true });
      renderer.domElement.removeEventListener('pointerdown', onTouchPointerDownCapture, { capture: true });
      renderer.domElement.removeEventListener('pointermove', onTouchPointerMoveCapture, { capture: true });
      renderer.domElement.removeEventListener('pointerup', onTouchPointerEndCapture, { capture: true });
      renderer.domElement.removeEventListener('pointercancel', onTouchPointerEndCapture, { capture: true });
      document.exitPointerLock();
      renderer.dispose();
      orbitAnchorEl.remove();
      if (splatCloudRef.current) {
        splatCloudRef.current.geometry.dispose();
        (splatCloudRef.current.material as THREE.Material).dispose();
        splatCloudRef.current = null;
      }
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      orbitRef.current = null;
      transformRef.current = null;
      groundRef.current = null;
      gridRef.current = null;
    };
  }, [loading]);

  const splatLoadKey = splat?.productionObjectKey
    ? [
        selectedVersionId || 'legacy',
        splat.id,
        splat.productionFormat || 'ply',
        splat.productionObjectKey,
      ].join('|')
    : null;

  useEffect(() => {
    if (loading || !sceneRef.current) return;
    if (!splat?.productionObjectKey || !splatLoadKey) {
      activeSplatLoadRef.current = null;
      loadedSplatKeyRef.current = null;
      setSplatLoading(false);
      setSplatVertexCount(0);
      return;
    }
    if (loadedSplatKeyRef.current === splatLoadKey || activeSplatLoadRef.current?.key === splatLoadKey) return;

    const loadSeq = splatLoadSeqRef.current + 1;
    splatLoadSeqRef.current = loadSeq;
    activeSplatLoadRef.current = { key: splatLoadKey, seq: loadSeq };
    setSelectedId(null);
    transformRef.current?.detach();
    void loadSplatCloud(splat, formToEditorTransform(pretransformRef.current), splatLoadKey, loadSeq);
  }, [loading, splat, splatLoadKey, loadSplatCloud]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      switch (e.key.toLowerCase()) {
        case '1': if (!placeMode && !flyModeRef.current) { setGizmoMode('translate'); transformRef.current?.setMode('translate'); } break;
        case '2': if (!placeMode && !flyModeRef.current) { setGizmoMode('rotate'); transformRef.current?.setMode('rotate'); } break;
        case '3': if (!placeMode && !flyModeRef.current) { setGizmoMode('scale'); transformRef.current?.setMode('scale'); } break;
        case 'g': setSnapEnabled((p) => !p); break;
        case 'p': setPlaceMode((p) => !p); break;
        case 'delete': if (selectedId) handleDelete(); break;
        case 'escape':
          if (flyModeRef.current) {
            exitFlyModePreservingCamera();
          }
          setSelectedId(null);
          setPlaceMode(false);
          transformRef.current?.detach();
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedId, placeMode]);

  // Sync markers with the 3D scene
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const liveIds = new Set(annotations.map((ann) => ann.id));
    markersRef.current.forEach((marker, id) => {
      if (!liveIds.has(id)) {
        scene.remove(marker.group);
        marker.sphere.geometry.dispose();
        (marker.sphere.material as THREE.Material).dispose();
        (marker.label.material as THREE.Material).dispose();
        markersRef.current.delete(id);
      }
    });

    annotations.forEach((ann) => {
      const position = new THREE.Vector3(ann.positionX, ann.positionY, ann.positionZ);
      const color = ann.color || '#ffffff';
      let marker = markersRef.current.get(ann.id);
      if (!marker) {
        const group = new THREE.Group();
        group.name = `marker-group-${ann.id}`;
        group.userData = { annotationId: ann.id };
        group.renderOrder = 9000;

        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(0.15, 16, 16),
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(color),
            emissive: new THREE.Color(color),
            emissiveIntensity: 0.6,
            roughness: 0.3,
            metalness: 0.1,
            depthTest: false,
            depthWrite: false,
          }),
        );
        sphere.name = `marker-${ann.id}`;
        sphere.userData = { annotationId: ann.id };
        sphere.renderOrder = 9001;
        group.add(sphere);

        const sprite = createTextSprite(ann.title, color);
        sprite.position.set(0, 0.2, 0);
        sprite.scale.set(0.6, 0.15, 1);
        sprite.renderOrder = 9002;
        group.add(sprite);

        scene.add(group);
        marker = { annotationId: ann.id, group, sphere, label: sprite, title: ann.title };
        markersRef.current.set(ann.id, marker);
      }

      marker.group.position.copy(position);
      marker.group.rotation.set(
        THREE.MathUtils.degToRad(ann.rotationX),
        THREE.MathUtils.degToRad(ann.rotationY),
        THREE.MathUtils.degToRad(ann.rotationZ),
      );
      marker.group.scale.setScalar(Math.max(0.01, ann.scale || 1));
      marker.group.userData = { annotationId: ann.id };
      marker.sphere.userData = { annotationId: ann.id };

      const material = marker.sphere.material as THREE.MeshStandardMaterial;
      material.color.set(color);
      material.emissive.set(color);
      material.depthTest = false;
      material.depthWrite = false;
      material.needsUpdate = true;

      if (marker.title !== ann.title) {
        marker.group.remove(marker.label);
        (marker.label.material as THREE.Material).dispose();
        marker.label = createTextSprite(ann.title, color);
        marker.label.position.set(0, 0.2, 0);
        marker.label.scale.set(0.6, 0.15, 1);
        marker.label.renderOrder = 9002;
        marker.group.add(marker.label);
        marker.title = ann.title;
      }

      if (ann.id === selectedId) {
        transformRef.current?.attach(marker.group);
        selectedMarkerObjRef.current = marker.group;
      }
    });

    if (!selectedId) {
      transformRef.current?.detach();
      selectedMarkerObjRef.current = null;
    }
  }, [annotations, selectedId]);

  useEffect(() => {
    const tc = transformRef.current;
    if (!tc) return;
    tc.setMode(gizmoMode);
    tc.setTranslationSnap(snapEnabled ? snapValue : null);
    tc.setRotationSnap(snapEnabled ? THREE.MathUtils.degToRad(snapValue * 10) : null);
    tc.setScaleSnap(snapEnabled ? snapValue : null);
  }, [gizmoMode, snapEnabled, snapValue]);

  function createTextSprite(text: string, color: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '24px sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, 128, 40);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
  }

  // Canvas click — select markers or place new ones with immediate gizmo
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const ground = groundRef.current;
      if (!renderer || !scene || !camera || !ground || !splat) return;
      if (flyModeRef.current) return;
      if ((transformRef.current as unknown as { dragging?: boolean } | null)?.dragging) return;
      if (canvasPointerRef.current.moved) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      const raycaster = raycasterRef.current;
      raycaster.setFromCamera(pointerRef.current, camera);

      const markerMeshes = Array.from(markersRef.current.values()).map((m) => m.sphere);
      const intersects = raycaster.intersectObjects(markerMeshes, false);

      if (intersects.length > 0 && intersects[0]) {
        const obj = intersects[0].object as THREE.Mesh;
        const annId = obj.userData.annotationId as string | undefined;
        if (annId) {
          const ann = annotations.find((a) => a.id === annId);
          if (ann) { selectAnnotation(ann); return; }
        }
      }

      const cloudPositions = splatCloudRef.current?.geometry.attributes.position as THREE.BufferAttribute | undefined;
      const pointHit = cloudPositions
        ? pickMarkerPoint({
            positions: cloudPositions.array,
            rayOrigin: [raycaster.ray.origin.x, raycaster.ray.origin.y, raycaster.ray.origin.z],
            rayDirection: [raycaster.ray.direction.x, raycaster.ray.direction.y, raycaster.ray.direction.z],
            sceneRadius: sceneRadiusRef.current,
            snapValue: snapEnabled ? snapValue : null,
          })
        : null;

      if (!placeMode) {
        return;
      }

      const groundHits = pointHit ? [] : raycaster.intersectObject(ground);
      const position = pointHit?.position || (groundHits[0]
        ? [groundHits[0].point.x, groundHits[0].point.y, groundHits[0].point.z] as [number, number, number]
        : null);

      if (position) {
        const px = Math.round((snapEnabled && !pointHit ? Math.round(position[0] / snapValue) * snapValue : position[0]) * 100) / 100;
        const py = Math.round((snapEnabled && !pointHit ? Math.round(position[1] / snapValue) * snapValue : position[1]) * 100) / 100;
        const pz = Math.round((snapEnabled && !pointHit ? Math.round(position[2] / snapValue) * snapValue : position[2]) * 100) / 100;
        if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return;
        // Create a temporary preview annotation so the XYZ gizmo appears immediately
        const tempId = 'preview-' + Math.random().toString(36).slice(2);
        const preview: Annotation = {
          id: tempId,
          title: '', body: '', kind: 'info',
          positionX: px, positionY: py, positionZ: pz,
          rotationX: 0, rotationY: 0, rotationZ: 0,
          scale: 1, icon: 'dot', color: '#ffffff',
        };
        setEditForm({
          title: '', body: '', kind: 'info',
          positionX: px, positionY: py, positionZ: pz,
          rotationX: 0, rotationY: 0, rotationZ: 0,
          scale: 1, icon: 'dot', color: '#ffffff',
        });
        // Remove old previews and add the new one — triggers marker sync + gizmo attach
        setAnnotations((prev) => {
          const cleaned = prev.filter((a) => !a.id.startsWith('preview-'));
          return [...cleaned, preview];
        });
        setOrbitTargetToPoint(new THREE.Vector3(px, py, pz), true);
        setSelectedId(tempId);
        setPlaceMode(false);
      }
    },
    [splat, annotations, snapEnabled, snapValue, placeMode],
  );

  function updateSelectedMarkerForm(patch: Partial<typeof editForm>) {
    setEditForm((prev) => ({ ...prev, ...patch }));
    const markerId = selectedIdRef.current;
    if (markerId) {
      setAnnotations((current) => current.map((ann) => (
        ann.id === markerId ? { ...ann, ...patch } : ann
      )));
    }
  }

  function selectAnnotation(ann: Annotation) {
    setSelectedId(ann.id);
    setEditForm({
      title: ann.title, body: ann.body || '', kind: ann.kind,
      positionX: ann.positionX, positionY: ann.positionY, positionZ: ann.positionZ,
      rotationX: ann.rotationX, rotationY: ann.rotationY, rotationZ: ann.rotationZ,
      scale: ann.scale, icon: ann.icon || 'dot', color: ann.color || '#ffffff',
    });
    const marker = markersRef.current.get(ann.id);
    if (marker && transformRef.current) {
      transformRef.current.attach(marker.group);
      selectedMarkerObjRef.current = marker.group;
      setOrbitTargetToPoint(marker.group.position, true);
    }
  }

  // Save/Create/Delete annotation — optimistic, gizmo stays active after save
  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    const isNew = !selectedId || selectedId.startsWith('preview-') || selectedId.startsWith('temp-');
    try {
      if (isNew) {
        // Create — replace any preview/temp marker
        const tempId = selectedId || 'temp-' + Math.random().toString(36).slice(2);
        const newAnn: Annotation = {
          id: tempId,
          title: editForm.title,
          body: editForm.body,
          kind: editForm.kind,
          positionX: editForm.positionX, positionY: editForm.positionY, positionZ: editForm.positionZ,
          rotationX: editForm.rotationX, rotationY: editForm.rotationY, rotationZ: editForm.rotationZ,
          scale: editForm.scale, icon: editForm.icon, color: editForm.color,
        };
        setAnnotations((prev) => {
          const cleaned = prev.filter((a) => !a.id.startsWith('preview-') && !a.id.startsWith('temp-'));
          return [...cleaned, newAnn];
        });

        const res = await fetch(versionedSplatEndpoint('/markers'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify(editForm),
        });
        if (!res.ok) throw new Error('Failed to create');
        const data = await res.json();
        const realId: string = data.marker?.id || data.annotation?.id || data.id || tempId;
        setAnnotations((prev) => prev.map((a) => (a.id === tempId ? { ...a, id: realId } : a)));
        setSelectedId(realId); // Keep selected so gizmo stays active
      } else {
        // Update existing annotation — gizmo stays active
        const updated: Annotation = {
          id: selectedId,
          title: editForm.title,
          body: editForm.body,
          kind: editForm.kind,
          positionX: editForm.positionX, positionY: editForm.positionY, positionZ: editForm.positionZ,
          rotationX: editForm.rotationX, rotationY: editForm.rotationY, rotationZ: editForm.rotationZ,
          scale: editForm.scale, icon: editForm.icon, color: editForm.color,
        };
        setAnnotations((prev) => prev.map((a) => (a.id === selectedId ? updated : a)));

        const res = await fetch(`${API_BASE}/admin/markers/${selectedId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify(editForm),
        });
        if (!res.ok) throw new Error('Failed to update');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error');
      fetchData();
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    if (!confirm('Delete this marker?')) return;
    const deletedId = selectedId;
    // Optimistic: remove from local state immediately
    setAnnotations((prev) => prev.filter((a) => a.id !== deletedId));
    setSelectedId(null);
    transformRef.current?.detach();
    setEditForm({ title: '', body: '', kind: 'info', positionX: 0, positionY: 0, positionZ: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1, icon: 'dot', color: '#ffffff' });
    try {
      await fetch(`${API_BASE}/admin/markers/${deletedId}`, { method: 'DELETE', credentials: 'include' });
    } catch {
      alert('Delete failed');
      fetchData();
    }
  };

  const handleCancel = () => {
    // Remove preview markers from state
    setAnnotations((prev) => prev.filter((a) => !a.id.startsWith('preview-') && !a.id.startsWith('temp-')));
    setSelectedId(null);
    setPlaceMode(false);
    transformRef.current?.detach();
    setEditForm({ title: '', body: '', kind: 'info', positionX: 0, positionY: 0, positionZ: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1, icon: 'dot', color: '#ffffff' });
  };

  // Save pretransform to server (Apply button transforms in-place; Save persists)
  const handlePtSave = async () => {
    setPtSaving(true);
    setPtMessage('');
    try {
      const r = await fetch(versionedSplatEndpoint('/transform'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          position: [pretransform.posX, pretransform.posY, pretransform.posZ],
          rotation: [pretransform.rotX, pretransform.rotY, pretransform.rotZ],
          scale: [pretransform.sclX, pretransform.sclY, pretransform.sclZ],
        }),
      });
      if (!r.ok) throw new Error('Save failed');
      setPtMessage('Saved ✓');
    } catch (err) {
      setPtMessage(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setPtSaving(false);
    }
  };

  // Apply pretransform live to the 3D view — in-place, no camera reset
  const handlePtApply = () => {
    const pt = buildTransform();
    applyPretransformInPlace(pt);
  };

  const handleCameraSave = async () => {
    setCameraSaving(true);
    setCameraMessage('');
    try {
      const cam = cameraRef.current!;
      const orbit = orbitRef.current!;
      const position: [number, number, number] = [
        Math.round(cam.position.x * 100) / 100,
        Math.round(cam.position.y * 100) / 100,
        Math.round(cam.position.z * 100) / 100,
      ];
      const target: [number, number, number] = [
        Math.round(orbit.target.x * 100) / 100,
        Math.round(orbit.target.y * 100) / 100,
        Math.round(orbit.target.z * 100) / 100,
      ];
      const fov = Math.round(cam.fov * 100) / 100;
      const r = await fetch(versionedSplatEndpoint('/camera'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ position, target, fov }),
      });
      if (!r.ok) throw new Error('Save failed');
      setCameraMessage('Camera saved ✓');
      setSplat((prev) => prev ? { ...prev, defaultCameraJson: { position, target, fov } } : prev);
    } catch (err) {
      setCameraMessage(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setCameraSaving(false);
    }
  };

  const handleCameraReset = async () => {
    setCameraSaving(true);
    setCameraMessage('');
    try {
      const r = await fetch(versionedSplatEndpoint('/camera'), {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!r.ok) throw new Error('Reset failed');
      setCameraMessage('Camera reset ✓');
      setSplat((prev) => prev ? { ...prev, defaultCameraJson: undefined } : prev);
    } catch (err) {
      setCameraMessage(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setCameraSaving(false);
    }
  };

  function updateFlyJoystick(ref: typeof flyMoveStickRef, element: HTMLDivElement, e: ReactPointerEvent<HTMLDivElement>) {
    const rect = element.getBoundingClientRect();
    const max = Math.max(1, rect.width * 0.34);
    const dx = Math.max(-max, Math.min(max, e.clientX - (rect.left + rect.width * 0.5)));
    const dy = Math.max(-max, Math.min(max, e.clientY - (rect.top + rect.height * 0.5)));
    ref.current.x = applyDeadzone(dx / max, 0.12);
    ref.current.y = applyDeadzone(dy / max, 0.12);
    element.style.setProperty('--jx', `${dx}px`);
    element.style.setProperty('--jy', `${dy}px`);
    element.style.opacity = '0.82';
  }

  function resetFlyJoystick(ref: typeof flyMoveStickRef, element: HTMLDivElement, pointerId: number) {
    if (ref.current.pointerId !== pointerId) return;
    ref.current = { pointerId: null, x: 0, y: 0 };
    element.style.setProperty('--jx', '0px');
    element.style.setProperty('--jy', '0px');
    element.style.opacity = '0.55';
  }

  function versionedSplatEndpoint(suffix: string) {
    if (!id) return '';
    return selectedVersionId
      ? `${API_BASE}/admin/splats/${id}/versions/${selectedVersionId}${suffix}`
      : `${API_BASE}/admin/splats/${id}${suffix}`;
  }

  const isNewMarker = !selectedId || selectedId.startsWith('preview-') || selectedId.startsWith('temp-');
  const isPreview = selectedId ? selectedId.startsWith('preview-') : false;
  const hasSelection = selectedId || (editForm.positionX !== 0 || editForm.positionY !== 0 || editForm.positionZ !== 0);
  const showFlyJoysticks = flyMode && coarsePointer;

  if (loading) {
    return <div style={{ padding: '4rem 0', display: 'flex', justifyContent: 'center' }}><Spinner size="md" /></div>;
  }

  if (error) {
    return <div style={{ padding: '2rem', color: '#ef4444' }}>Error: {error}</div>;
  }

  const numInputStyle: React.CSSProperties = {
    width: '100%', padding: '0.4rem 0.5rem', background: '#111', border: '1px solid #2a2a2a',
    borderRadius: 4, color: '#f5f5f5', fontSize: '0.75rem', outline: 'none', boxSizing: 'border-box',
    fontFamily: 'inherit',
  };

  const inputStyle: React.CSSProperties = {
    padding: '0.4rem 0.5rem', background: '#111', border: '1px solid #2a2a2a',
    borderRadius: 4, color: '#f5f5f5', fontSize: '0.8125rem', outline: 'none', width: '100%', boxSizing: 'border-box',
    fontFamily: 'inherit',
  };

  return (
    <div style={layoutStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Link to={`/splats/${id}`} style={backLinkStyle}>← Splat</Link>
          <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{splat?.title || 'Scene'} — 3D Editor</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.6875rem', color: '#737373' }}>
          {versions.length > 0 && (
            <select
              value={selectedVersionId || ''}
              onChange={(event) => {
                const next = event.target.value || null;
                setSelectedVersionId(next);
                if (next) setSearchParams({ versionId: next }, { replace: true });
              }}
              title="Version"
              style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 4, color: '#f5f5f5', fontSize: '0.6875rem', padding: '0.25rem 0.5rem' }}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>v{v.version}{v.isServed ? ' served' : ''}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setPlaceMode(!placeMode)}
            title="Place Marker mode (P) — click ground to place, XYZ gizmo appears immediately"
            style={{
              padding: '0.25rem 0.625rem', fontSize: '0.6875rem', borderRadius: 4,
              background: placeMode ? '#22c55e' : '#171717',
              border: placeMode ? '1px solid #22c55e' : '1px solid #2a2a2a',
              color: placeMode ? '#050505' : '#a3a3a3', cursor: 'pointer',
              fontWeight: placeMode ? 600 : 400,
            }}
          >
            {placeMode ? '▸ Placing...' : '+ Place Marker'}
          </button>

          {/* Fly mode toggle */}
          <button
            onClick={() => {
              if (flyModeRef.current) {
                exitFlyModePreservingCamera();
              } else {
                enterFlyModeFromCamera();
              }
            }}
            title="Fly mode — WASD + mouse look, Shift=boost, Q/E=up/down"
            style={{
              padding: '0.25rem 0.625rem', fontSize: '0.6875rem', borderRadius: 4,
              background: flyMode ? '#3b82f6' : '#171717',
              border: flyMode ? '1px solid #3b82f6' : '1px solid #2a2a2a',
              color: flyMode ? '#ffffff' : '#a3a3a3', cursor: 'pointer',
              fontWeight: flyMode ? 600 : 400,
            }}
          >
            {flyMode ? '◈ Flying' : '☁ Fly'}
          </button>

          <button
            onClick={handleCameraSave}
            title="Set initial camera position — saves current camera view as the default for client viewers"
            disabled={cameraSaving}
            style={{
              padding: '0.25rem 0.625rem', fontSize: '0.6875rem', borderRadius: 4,
              background: splat?.defaultCameraJson ? '#0a2a0a' : '#171717',
              border: splat?.defaultCameraJson ? '1px solid #22c55e' : '1px solid #2a2a2a',
              color: splat?.defaultCameraJson ? '#22c55e' : '#a3a3a3', cursor: 'pointer',
              fontWeight: splat?.defaultCameraJson ? 600 : 400,
            }}
          >
            {cameraSaving ? '...' : '📷 Set Camera'}
          </button>

          {hasSelection && (
            <div style={{ display: 'flex', gap: 2, background: '#111', borderRadius: 4, border: '1px solid #2a2a2a', overflow: 'hidden' }}>
              {(['translate', 'rotate', 'scale'] as GizmoMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setGizmoMode(m)}
                  title={`${m} (${m[0]!.toUpperCase()}) — drag the colored arrows/rings`}
                  style={{
                    padding: '0.25rem 0.5rem', fontSize: '0.625rem', border: 'none', cursor: 'pointer',
                    background: gizmoMode === m ? '#f5f5f5' : 'transparent',
                    color: gizmoMode === m ? '#050505' : '#737373',
                    fontWeight: gizmoMode === m ? 600 : 400,
                  }}
                >
                  {m[0]!.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} style={{ accentColor: '#f5f5f5' }} />
            Snap
          </label>
          {snapEnabled && (
            <select
              value={snapValue}
              onChange={(e) => setSnapValue(parseFloat(e.target.value))}
              style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 4, color: '#f5f5f5', fontSize: '0.625rem', padding: '0.125rem 0.25rem' }}
            >
              <option value={0.01}>0.01</option>
              <option value={0.1}>0.1</option>
              <option value={0.5}>0.5</option>
              <option value={1}>1.0</option>
              <option value={5}>5.0</option>
            </select>
          )}
          <span style={{ marginLeft: 'auto' }}>
            {splatVertexCount > 0 && `${splatVertexCount.toLocaleString()} splats · `}
            {annotations.length} markers · 1/2/3=gizmo · G=snap · P=place · Del=delete
          </span>
        </div>
      </div>

      <div style={editorContainerStyle}>
        {/* 3D Scene */}
        <div
          ref={containerRef}
          style={viewerPaneStyle}
          onPointerDownCapture={(e) => {
            canvasPointerRef.current = { x: e.clientX, y: e.clientY, moved: false };
          }}
          onPointerMoveCapture={(e) => {
            const start = canvasPointerRef.current;
            if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) {
              start.moved = true;
            }
          }}
          onClick={handleCanvasClick}
        >
          {splatLoading && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', padding: '0.5rem 1rem', background: 'rgba(13,13,13,0.85)', border: '1px solid #2a2a2a', borderRadius: 8, color: '#a3a3a3', fontSize: '0.75rem', zIndex: 20 }}>
              Loading point cloud...
            </div>
          )}
          {splatError && (
            <div style={{ position: 'absolute', top: '1rem', left: '50%', transform: 'translateX(-50%)', padding: '0.5rem 1rem', background: 'rgba(20,5,5,0.9)', border: '1px solid #ef4444', borderRadius: 8, color: '#ef4444', fontSize: '0.75rem', zIndex: 20 }}>
              Failed to load splat: {splatError}
            </div>
          )}
          {!splat?.productionObjectKey && !splatLoading && (
            <div style={hintOverlayStyle}>
              <span>No splat data available. Upload and process a file first.</span>
            </div>
          )}
          {splat?.productionObjectKey && !splatLoading && !splatError && (
            <div style={hintOverlayStyle}>
              <span>
                {placeMode
                  ? 'Click on the ground plane to place a new marker (XYZ gizmo appears)'
                  : 'Click "Place Marker" to add markers · Click existing markers to edit · Drag XYZ handles'}
              </span>
            </div>
          )}
          {showFlyJoysticks && (
            <div style={flyJoystickLayerStyle}>
              {[
                { key: 'move', side: 'left' as const, ref: flyMoveStickRef },
                { key: 'look', side: 'right' as const, ref: flyLookStickRef },
              ].map((joy) => (
                <div
                  key={joy.key}
                  aria-label={`${joy.key} joystick`}
                  style={{ ...flyJoystickBaseStyle, [joy.side]: 18 }}
                  onPointerDown={(e) => {
                    joy.ref.current.pointerId = e.pointerId;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    updateFlyJoystick(joy.ref, e.currentTarget, e);
                  }}
                  onPointerMove={(e) => {
                    if (joy.ref.current.pointerId === e.pointerId) {
                      updateFlyJoystick(joy.ref, e.currentTarget, e);
                    }
                  }}
                  onPointerUp={(e) => resetFlyJoystick(joy.ref, e.currentTarget, e.pointerId)}
                  onPointerCancel={(e) => resetFlyJoystick(joy.ref, e.currentTarget, e.pointerId)}
                >
                  <div style={flyJoystickKnobStyle} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right panel */}
        <div style={panelStyle}>
          {/* Marker list */}
          <div style={{ padding: '0.875rem', borderBottom: '1px solid #2a2a2a' }}>
            <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, margin: '0 0 0.5rem 0' }}>Markers ({annotations.length})</h3>
            {annotations.length === 0 && (
              <p style={{ color: '#737373', fontSize: '0.75rem', margin: 0 }}>No markers. Click "Place Marker" to add.</p>
            )}
            <div style={{ maxHeight: 180, overflowY: 'auto' }}>
              {annotations.map((ann) => (
                <button
                  key={ann.id}
                  onClick={() => { setPlaceMode(false); selectAnnotation(ann); }}
                  style={{
                    display: 'flex', alignItems: 'center', width: '100%', padding: '0.375rem 0.5rem',
                    border: `1px solid ${selectedId === ann.id ? '#f5f5f5' : '#2a2a2a'}`,
                    borderRadius: 4, background: selectedId === ann.id ? '#171717' : '#0d0d0d',
                    color: '#f5f5f5', cursor: 'pointer', marginBottom: '0.25rem', fontSize: '0.75rem',
                    textAlign: 'left',
                  }}
                >
                  <span style={{
                    display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                    background: ann.color || '#ffffff', marginRight: '0.5rem', flexShrink: 0,
                  }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ann.title || (ann.id.startsWith('preview-') ? '(new marker)' : '(untitled)')}
                  </span>
                  <span style={{ fontSize: '0.625rem', color: '#737373', marginLeft: 'auto', flexShrink: 0 }}>
                    [{ann.positionX.toFixed(1)},{ann.positionY.toFixed(1)},{ann.positionZ.toFixed(1)}]
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Edit form */}
          <div style={{ padding: '0.875rem', borderBottom: '1px solid #2a2a2a' }}>
            <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, margin: '0 0 0.75rem 0' }}>
              {isPreview ? 'New Marker (drag XYZ gizmo to position)' : isNewMarker ? 'New Marker' : 'Edit Marker'}
            </h3>

            {!hasSelection && (
              <p style={{ color: '#737373', fontSize: '0.75rem', margin: 0 }}>
                Select a marker from the list above, or click "Place Marker" and click on the scene to create one.
              </p>
            )}

            {hasSelection && (
              <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem' }}>
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>Title *</span>
                    <input type="text" value={editForm.title} onChange={(e) => updateSelectedMarkerForm({ title: e.target.value })} required placeholder="Name..." style={inputStyle} />
                  </label>
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>Kind</span>
                    <select value={editForm.kind} onChange={(e) => updateSelectedMarkerForm({ kind: e.target.value })} style={inputStyle}>
                      {KIND_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </label>
                </div>

                <label style={labelStyle}>
                  <span style={labelTextStyle}>Body</span>
                  <input type="text" value={editForm.body} onChange={(e) => updateSelectedMarkerForm({ body: e.target.value })} placeholder="Description..." style={inputStyle} />
                </label>

                <div>
                  <span style={labelTextStyle}>Color</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.25rem' }}>
                    {COLOR_PRESETS.map((c) => (
                      <button key={c} type="button" onClick={() => updateSelectedMarkerForm({ color: c })}
                        style={{
                          width: 22, height: 22, borderRadius: 4, background: c,
                          border: editForm.color === c ? '2px solid #f5f5f5' : '1px solid #2a2a2a',
                          cursor: 'pointer', transition: 'border-color 150ms',
                        }} title={c}
                      />
                    ))}
                    <input type="color" value={editForm.color} onChange={(e) => updateSelectedMarkerForm({ color: e.target.value })}
                      style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid #2a2a2a', cursor: 'pointer', padding: 0, background: 'none' }}
                    />
                  </div>
                </div>

                <div>
                  <span style={labelTextStyle}>Icon</span>
                  <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem' }}>
                    {ICON_OPTIONS.map((opt) => (
                      <button key={opt.value} type="button" onClick={() => updateSelectedMarkerForm({ icon: opt.value })}
                        style={{
                          width: 28, height: 28, borderRadius: 4, fontSize: '0.875rem',
                          background: editForm.icon === opt.value ? '#171717' : '#0d0d0d',
                          border: editForm.icon === opt.value ? '1px solid #f5f5f5' : '1px solid #2a2a2a',
                          cursor: 'pointer', color: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }} title={opt.value}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Annotation Position */}
                <div>
                  <span style={labelTextStyle}>Position (drag XYZ gizmo arrows in 3D view)</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.375rem', marginTop: '0.25rem' }}>
                    {['X', 'Y', 'Z'].map((axis, i) => {
                      const keys = ['positionX', 'positionY', 'positionZ'] as const;
                      return (
                        <label key={axis} style={labelStyle}>
                          <span style={{ ...labelTextStyle, fontSize: '0.625rem' }}>{axis}</span>
                          <NumInput value={editForm[keys[i]!]} onChange={(v) => updateSelectedMarkerForm({ [keys[i]!]: v })} step="0.01" style={numInputStyle} />
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Annotation Rotation */}
                <div>
                  <span style={labelTextStyle}>Rotation (degrees)</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.375rem', marginTop: '0.25rem' }}>
                    {['X', 'Y', 'Z'].map((axis, i) => {
                      const keys = ['rotationX', 'rotationY', 'rotationZ'] as const;
                      return (
                        <label key={axis} style={labelStyle}>
                          <span style={{ ...labelTextStyle, fontSize: '0.625rem' }}>{axis}</span>
                          <NumInput value={editForm[keys[i]!]} onChange={(v) => updateSelectedMarkerForm({ [keys[i]!]: v })} step="0.1" style={numInputStyle} />
                        </label>
                      );
                    })}
                  </div>
                </div>

                <label style={labelStyle}>
                  <span style={labelTextStyle}>Scale ({editForm.scale.toFixed(2)})</span>
                  <input type="range" min="0.1" max="10" step="0.1" value={editForm.scale}
                    onChange={(e) => updateSelectedMarkerForm({ scale: parseFloat(e.target.value) || 1 })}
                    style={{ width: '100%', accentColor: '#f5f5f5' }}
                  />
                </label>

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <Button type="submit" variant="primary" size="sm">
                    {isNewMarker ? 'Create' : 'Update'}
                  </Button>
                  {!isNewMarker && (
                    <Button type="button" variant="danger" size="sm" onClick={handleDelete}>Delete</Button>
                  )}
                  <Button type="button" variant="secondary" size="sm" onClick={handleCancel}>Cancel</Button>
                </div>
              </form>
            )}
          </div>

          {/* ── Default Camera Panel ── */}
          <div style={{ padding: '0.875rem', borderBottom: '1px solid #2a2a2a' }}>
            <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, margin: '0 0 0.25rem 0' }}>Initial Camera</h3>
            <p style={{ fontSize: '0.625rem', color: '#737373', margin: '0 0 0.75rem 0' }}>
              Set the camera position that clients will see when first opening the splat. Navigate to your desired view in the 3D scene and click "Save Camera" below.
            </p>

            {splat?.defaultCameraJson && (
              <div style={{ marginBottom: '0.75rem', padding: '0.5rem', background: '#0a2a0a', border: '1px solid #22c55e', borderRadius: 4 }}>
                <div style={{ fontSize: '0.625rem', color: '#22c55e', fontWeight: 600, marginBottom: '0.25rem' }}>Current camera saved:</div>
                <div style={{ fontSize: '0.625rem', color: '#a3a3a3', fontFamily: 'monospace' }}>
                  pos: [{splat.defaultCameraJson.position.map((v: number) => v.toFixed(2)).join(', ')}]
                </div>
                <div style={{ fontSize: '0.625rem', color: '#a3a3a3', fontFamily: 'monospace' }}>
                  target: [{splat.defaultCameraJson.target.map((v: number) => v.toFixed(2)).join(', ')}]
                </div>
                {typeof splat.defaultCameraJson.fov === 'number' && (
                  <div style={{ fontSize: '0.625rem', color: '#a3a3a3', fontFamily: 'monospace' }}>
                    fov: {splat.defaultCameraJson.fov.toFixed(2)}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <Button variant="primary" size="sm" onClick={handleCameraSave} disabled={cameraSaving}>
                {cameraSaving ? 'Saving...' : 'Save Camera'}
              </Button>
              {splat?.defaultCameraJson && (
                <Button variant="secondary" size="sm" onClick={handleCameraReset} disabled={cameraSaving}>
                  Reset
                </Button>
              )}
              {cameraMessage && (
                <span style={{ fontSize: '0.6875rem', color: cameraMessage.startsWith('Error') ? '#ef4444' : '#22c55e', flexBasis: '100%', marginTop: '0.25rem' }}>
                  {cameraMessage}
                </span>
              )}
            </div>
          </div>

          {/* ── Pretransform Panel ── */}
          <div style={{ padding: '0.875rem' }}>
            <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, margin: '0 0 0.25rem 0' }}>Pretransform</h3>
            <p style={{ fontSize: '0.625rem', color: '#737373', margin: '0 0 0.75rem 0' }}>
              Adjust the splat's position, rotation, and scale. Save to persist; Apply reloads the 3D view.
            </p>

            {/* Position */}
            <div style={{ marginBottom: '0.625rem' }}>
              <span style={labelTextStyle}>Position</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.25rem', marginTop: '0.125rem' }}>
                {[
                  { label: 'X', val: pretransform.posX, set: (v: number) => setPretransform((p) => ({ ...p, posX: v })) },
                  { label: 'Y', val: pretransform.posY, set: (v: number) => setPretransform((p) => ({ ...p, posY: v })) },
                  { label: 'Z', val: pretransform.posZ, set: (v: number) => setPretransform((p) => ({ ...p, posZ: v })) },
                ].map((a) => (
                  <label key={a.label} style={labelStyle}>
                    <span style={{ ...labelTextStyle, fontSize: '0.6rem' }}>{a.label}</span>
                    <NumInput value={a.val} onChange={a.set} step="0.01" style={numInputStyle} />
                  </label>
                ))}
              </div>
            </div>

            {/* Rotation */}
            <div style={{ marginBottom: '0.625rem' }}>
              <span style={labelTextStyle}>Rotation (degrees)</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.25rem', marginTop: '0.125rem' }}>
                {[
                  { label: 'X', val: pretransform.rotX, set: (v: number) => setPretransform((p) => ({ ...p, rotX: v })) },
                  { label: 'Y', val: pretransform.rotY, set: (v: number) => setPretransform((p) => ({ ...p, rotY: v })) },
                  { label: 'Z', val: pretransform.rotZ, set: (v: number) => setPretransform((p) => ({ ...p, rotZ: v })) },
                ].map((a) => (
                  <label key={a.label} style={labelStyle}>
                    <span style={{ ...labelTextStyle, fontSize: '0.6rem' }}>{a.label}</span>
                    <NumInput value={a.val} onChange={a.set} step="0.1" style={numInputStyle} />
                  </label>
                ))}
              </div>
            </div>

            {/* Scale */}
            <div style={{ marginBottom: '0.75rem' }}>
              <span style={labelTextStyle}>Scale</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.25rem', marginTop: '0.125rem' }}>
                {[
                  { label: 'X', val: pretransform.sclX, set: (v: number) => setPretransform((p) => ({ ...p, sclX: v })) },
                  { label: 'Y', val: pretransform.sclY, set: (v: number) => setPretransform((p) => ({ ...p, sclY: v })) },
                  { label: 'Z', val: pretransform.sclZ, set: (v: number) => setPretransform((p) => ({ ...p, sclZ: v })) },
                ].map((a) => (
                  <label key={a.label} style={labelStyle}>
                    <span style={{ ...labelTextStyle, fontSize: '0.6rem' }}>{a.label}</span>
                    <NumInput value={a.val} onChange={a.set} step="0.01" style={numInputStyle} />
                  </label>
                ))}
              </div>
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <Button variant="primary" size="sm" onClick={handlePtSave} disabled={ptSaving}>
                {ptSaving ? 'Saving...' : 'Save'}
              </Button>
              <Button variant="secondary" size="sm" onClick={handlePtApply} disabled={splatLoading}>
                Apply to View
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setPretransform({ posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, sclX: 1, sclY: 1, sclZ: 1 })}>
                Reset
              </Button>
              {ptMessage && (
                <span style={{ fontSize: '0.6875rem', color: ptMessage.startsWith('Error') ? '#ef4444' : '#22c55e', flexBasis: '100%', marginTop: '0.25rem' }}>
                  {ptMessage}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Styles ──
const layoutStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)', background: '#050505', color: '#f5f5f5', margin: '-0.5rem -2rem 0' };
const headerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 1rem', borderBottom: '1px solid #2a2a2a', background: '#0d0d0d', flexShrink: 0 };
const backLinkStyle: React.CSSProperties = { color: '#a3a3a3', textDecoration: 'underline', fontSize: '0.75rem' };
const editorContainerStyle: React.CSSProperties = { flex: 1, display: 'flex', minHeight: 0 };
const viewerPaneStyle: React.CSSProperties = { flex: 1, position: 'relative', cursor: 'crosshair', background: '#050505' };
const hintOverlayStyle: React.CSSProperties = { position: 'absolute', top: '1rem', left: '50%', transform: 'translateX(-50%)', padding: '0.5rem 1rem', background: 'rgba(13,13,13,0.85)', border: '1px solid #2a2a2a', borderRadius: 8, color: '#a3a3a3', fontSize: '0.75rem', pointerEvents: 'none', zIndex: 10 };
const flyJoystickLayerStyle: React.CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 30 };
const flyJoystickBaseStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 18,
  width: 104,
  height: 104,
  borderRadius: '50%',
  background: 'rgba(245,245,245,0.12)',
  border: '1px solid rgba(255,255,255,0.22)',
  backdropFilter: 'blur(8px)',
  opacity: 0.55,
  pointerEvents: 'auto',
  touchAction: 'none',
  ['--jx' as string]: '0px',
  ['--jy' as string]: '0px',
};
const flyJoystickKnobStyle: React.CSSProperties = {
  position: 'absolute',
  left: '50%',
  top: '50%',
  width: 42,
  height: 42,
  borderRadius: '50%',
  background: 'rgba(245,245,245,0.34)',
  border: '1px solid rgba(255,255,255,0.28)',
  transform: 'translate(calc(-50% + var(--jx)), calc(-50% + var(--jy)))',
  boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
};
const panelStyle: React.CSSProperties = { width: 340, background: '#0d0d0d', borderLeft: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' };
const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.125rem' };
const labelTextStyle: React.CSSProperties = { fontSize: '0.625rem', color: '#737373' };
